import { api, ApiError } from "../api/client";
import type { GamificationSummary } from "../api/types";
import { backoffMs, buildEvents, classifyError, hasPendingWork, MAX_SUSPECT_ATTEMPTS, STALL_AFTER_MS } from "./logic";
import { deleteLocalMeal, listLocalMeals, mutateMeal } from "./mealStore";
import type { LocalMeal, SyncEvent } from "./types";

/**
 * 把本機佇列裡的動作依序送給伺服器。這個檔案只負責「跑一輪」，
 * 什麼時候跑、失敗後何時重試由 syncEngine.ts 決定。
 *
 * 後端的對應行為 (見 backend/src/routes/meals.routes.ts)：
 * - 用餐紀錄 id 由前端產生，同一個 id 重送是安全的 (回 200，不會重複發點數)。
 * - 2xx = 完成；400/409 = 永遠不會成功；404 = 找不到紀錄。
 */

const UPLOAD_TIMEOUT_MS = 120_000;

export interface SyncTransport {
  uploadPre(meal: LocalMeal, file: File, sentAtIso: string): Promise<unknown>;
  uploadPost(meal: LocalMeal, file: File, sentAtIso: string): Promise<{ gamification?: GamificationSummary } | undefined>;
  abandon(mealId: string): Promise<unknown>;
  remove(mealId: string): Promise<unknown>;
}

export const apiTransport: SyncTransport = {
  uploadPre(meal, file, sentAtIso) {
    const pre = meal.pre!;
    const form = new FormData();
    form.append("photo", file);
    form.append("id", meal.id);
    form.append("mealType", meal.mealType);
    form.append("capturedAt", pre.capturedAt);
    form.append("tzOffsetMinutes", String(pre.tzOffsetMinutes));
    if (meal.notes) form.append("notes", meal.notes);
    form.append("capturedOffline", String(pre.capturedOffline));
    form.append("clientSentAt", sentAtIso);
    return api.post("/meals/pre-meal", form, { timeoutMs: UPLOAD_TIMEOUT_MS });
  },
  uploadPost(meal, file, sentAtIso) {
    const post = meal.post!;
    const form = new FormData();
    form.append("photo", file);
    form.append("capturedAt", post.capturedAt);
    form.append("tzOffsetMinutes", String(post.tzOffsetMinutes));
    form.append("capturedOffline", String(post.capturedOffline));
    form.append("clientSentAt", sentAtIso);
    return api.post<{ gamification?: GamificationSummary }>(`/meals/${meal.id}/post-meal`, form, {
      timeoutMs: UPLOAD_TIMEOUT_MS,
    });
  },
  abandon: (mealId) => api.patch(`/meals/${mealId}/abandon`),
  remove: (mealId) => api.delete(`/meals/${mealId}`),
};

export type StopReason = "done" | "network" | "auth" | "transient";

export interface RunResult {
  /** 這一輪成功處理掉的動作數 */
  processed: number;
  postsCompleted: number;
  stopped: StopReason;
  /** 這一輪最後一次從伺服器拿到的點數/徽章摘要 */
  gamification: GamificationSummary | null;
}

function toFile(slot: NonNullable<LocalMeal["pre"]>): File {
  if (!slot.file) throw new ApiError(400, "本機找不到這張照片的檔案");
  return new File([slot.file.blob], slot.file.name, { type: slot.file.type });
}

async function send(event: SyncEvent, meal: LocalMeal, transport: SyncTransport) {
  const sentAt = new Date().toISOString();
  switch (event.kind) {
    case "PRE":
      return transport.uploadPre(meal, toFile(meal.pre!), sentAt);
    case "POST":
      return transport.uploadPost(meal, toFile(meal.post!), sentAt);
    case "ABANDON":
      return transport.abandon(meal.id);
    case "DELETE":
      return transport.remove(meal.id);
  }
}

async function markDone(event: SyncEvent): Promise<void> {
  const updated = await mutateMeal(event.mealId, (m) => {
    const reset = { attempts: 0, nextAttemptAt: 0, firstSuspectAt: undefined };
    if (event.kind === "PRE" && m.pre) return { ...m, ...reset, pre: { ...m.pre, synced: true, file: null } };
    if (event.kind === "POST" && m.post) return { ...m, ...reset, post: { ...m.post, synced: true, file: null } };
    if (event.kind === "ABANDON" && m.abandon) return { ...m, ...reset, abandon: { ...m.abandon, synced: true } };
    if (event.kind === "DELETE" && m.remove) return { ...m, remove: { ...m.remove, synced: true } };
    return null;
  });
  // 已經刪除、而且沒有任何還沒上傳的東西了，本機這筆就沒有存在的必要，整筆清掉
  if (event.kind === "DELETE" && updated && !hasPendingWork(updated)) {
    await deleteLocalMeal(event.mealId);
  }
}

/**
 * 連不上伺服器的當下，這位使用者所有「還沒上傳」的照片都沒能及時上傳，一併標記為離線拍攝，
 * 上傳時回報給後端 (研究分析時用來區分離線補傳的資料)。
 * 不能只標記「剛好失敗的那一筆」：佇列是依時間排序的，排在後面的照片 (例如離線期間才拍的
 * 餐後照) 根本還沒輪到嘗試，但它同樣是在沒網路的狀況下拍的。
 */
async function markUnsyncedAsOffline(userId: string): Promise<void> {
  const meals = await listLocalMeals(userId);
  for (const meal of meals) {
    const preNeeds = meal.pre !== null && !meal.pre.synced && !meal.pre.capturedOffline;
    const postNeeds = meal.post !== null && !meal.post.synced && !meal.post.capturedOffline;
    if (!preNeeds && !postNeeds) continue;
    await mutateMeal(meal.id, (m) => ({
      ...m,
      pre: m.pre && !m.pre.synced ? { ...m.pre, capturedOffline: true } : m.pre,
      post: m.post && !m.post.synced ? { ...m.post, capturedOffline: true } : m.post,
    }));
  }
}

async function recordSuspect(mealId: string, message: string, nowMs: number): Promise<void> {
  await mutateMeal(mealId, (m) => {
    const attempts = m.attempts + 1;
    const firstSuspectAt = m.firstSuspectAt ?? nowMs;
    if (attempts >= MAX_SUSPECT_ATTEMPTS && nowMs - firstSuspectAt >= STALL_AFTER_MS) {
      return {
        ...m,
        attempts,
        firstSuspectAt,
        failure: {
          kind: "stalled",
          message: `伺服器暫時無法處理這筆紀錄（${message}）。資料還安全存在手機裡，請稍後按「重試上傳」。`,
          at: new Date(nowMs).toISOString(),
        },
      };
    }
    return { ...m, attempts, firstSuspectAt, nextAttemptAt: nowMs + backoffMs(attempts) };
  });
}

async function recordPermanent(mealId: string, message: string, nowMs: number): Promise<void> {
  await mutateMeal(mealId, (m) => ({ ...m, failure: { kind: "permanent", message, at: new Date(nowMs).toISOString() } }));
}

export async function runSyncOnce(deps: {
  userId: string;
  transport: SyncTransport;
  now?: () => number;
  /** 使用者手動觸發 / 網路恢復時：略過「這一筆還在退避等待」的限制，立刻再試 */
  ignoreBackoff?: boolean;
}): Promise<RunResult> {
  const now = deps.now ?? Date.now;
  const result: RunResult = { processed: 0, postsCompleted: 0, stopped: "done", gamification: null };

  // 這一輪已經遇到「可疑 5xx」的紀錄：本輪不再碰它 (否則強制模式下會對同一筆連續重試好幾次)
  const skippedThisRun = new Set<string>();

  // 每一輪都重新讀取佇列：上傳期間使用者可能又新增了東西 (例如剛拍完餐後照)
  for (let guard = 0; guard < 2000; guard++) {
    const meals = await listLocalMeals(deps.userId);
    const event = buildEvents(meals, deps.ignoreBackoff ? Number.POSITIVE_INFINITY : now()).find(
      (e) => !skippedThisRun.has(e.mealId)
    );
    if (!event) return result;
    const meal = meals.find((m) => m.id === event.mealId)!;

    try {
      const response = await send(event, meal, deps.transport);
      await markDone(event);
      result.processed++;
      if (event.kind === "POST") {
        result.postsCompleted++;
        const g = (response as { gamification?: GamificationSummary } | undefined)?.gamification;
        if (g) result.gamification = g;
      }
    } catch (err) {
      const outcome = classifyError(err, event.kind);
      switch (outcome.type) {
        case "moot":
          await markDone(event);
          continue;
        case "suspect":
          skippedThisRun.add(meal.id);
          await recordSuspect(meal.id, outcome.message, now());
          continue;
        case "permanent":
          await recordPermanent(meal.id, outcome.message, now());
          continue;
        case "network":
          await markUnsyncedAsOffline(deps.userId);
          result.stopped = "network";
          return result;
        case "auth":
          result.stopped = "auth";
          return result;
        case "transient":
          result.stopped = "transient";
          return result;
      }
    }
  }
  return result;
}
