import { ApiError, NetworkError } from "../api/client";
import type { MealRecord, MealRecordStatus } from "../api/types";
import type { LocalMeal, MealView, SyncEvent, SyncEventKind } from "./types";

/* 這個檔案全部是純函式 (不碰 IndexedDB / 網路 / 畫面)，方便完整測試。 */

/**
 * 「可疑的 5xx」累計幾次、而且從第一次失敗起已經過了多久，兩個條件都滿足才把這筆暫停下來
 * 等人處理 (不再自動重試)。要求「過了一段時間」是為了避免伺服器只是短暫出問題 (重啟、部署中)，
 * 卻因為 App 在幾分鐘內被連續觸發同步，就把病人的照片卡在需要手動處理的狀態。
 */
export const MAX_SUSPECT_ATTEMPTS = 5;
export const STALL_AFTER_MS = 30 * 60_000;

export function hasPendingWork(m: LocalMeal): boolean {
  return (
    (m.pre !== null && !m.pre.synced) ||
    (m.post !== null && !m.post.synced) ||
    (m.abandon !== null && !m.abandon.synced) ||
    (m.remove !== null && !m.remove.synced)
  );
}

/** 本機這一筆目前應該處於什麼狀態 (不看伺服器) */
export function deriveStatus(m: LocalMeal): MealRecordStatus {
  if (m.abandon) return "ABANDONED";
  if (m.post) return "COMPLETED";
  return "AWAITING_POST_PHOTO";
}

const KIND_RANK: Record<SyncEventKind, number> = { PRE: 0, POST: 1, ABANDON: 2, DELETE: 3 };

/**
 * 把所有「還沒上傳」的動作，依「動作發生的時間」由早到晚排成一條佇列。
 *
 * 為什麼不是「一餐一餐」上傳，而是全部動作混在一起依時間排序：後端的連續天數是
 * 依「餐後照拍攝日」累加，而且不接受比上次更早的日期。例如第 1 天 23:50 拍了餐前照、
 * 第 3 天才補拍餐後照，同時第 2 天有另一餐完整紀錄；如果先上傳前者，第 3 天的餐後照會
 * 先把連續天數推到第 3 天，第 2 天那餐就再也算不進去。依事件時間排序就不會發生。
 *
 * 失敗 (failure) 或還在等待重試 (nextAttemptAt) 的整筆紀錄都不排進來，這樣它的餐後照
 * 不會在餐前照還沒上傳時就先被送出去。
 */
export function buildEvents(meals: LocalMeal[], nowMs: number): SyncEvent[] {
  const events: SyncEvent[] = [];
  for (const m of meals) {
    // 本機專屬的紀錄永遠不產生上傳事件。這是「試用資料不會進伺服器」的唯一守門處，
    // 拆掉它等於讓 IRB 尚未核准的照片上傳（見 types.ts 的 localOnly）。
    if (m.localOnly) continue;
    if (m.failure || m.nextAttemptAt > nowMs) continue;
    if (m.pre && !m.pre.synced) events.push({ mealId: m.id, kind: "PRE", at: m.pre.capturedAt });
    if (m.post && !m.post.synced) events.push({ mealId: m.id, kind: "POST", at: m.post.capturedAt });
    if (m.abandon && !m.abandon.synced) events.push({ mealId: m.id, kind: "ABANDON", at: m.abandon.requestedAt });
    if (m.remove && !m.remove.synced) events.push({ mealId: m.id, kind: "DELETE", at: m.remove.requestedAt });
  }
  return events.sort((a, b) => {
    const dt = Date.parse(a.at) - Date.parse(b.at);
    if (dt !== 0) return dt;
    const dk = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (dk !== 0) return dk;
    return a.mealId < b.mealId ? -1 : a.mealId > b.mealId ? 1 : 0;
  });
}

export type UploadOutcome =
  | { type: "moot" } // 伺服器說「這個動作已經沒意義了」，當成完成 (例如刪除一筆本來就不存在的紀錄)
  | { type: "network" } // 連不上：停下整條佇列，等網路回來
  | { type: "auth" } // 登入失效：停下整條佇列，等重新登入
  | { type: "transient"; message: string } // 伺服器忙碌 / 閘道錯誤：停下整條佇列，稍後重試
  | { type: "suspect"; message: string } // 一般 5xx：只把這一筆先跳過，累計幾次後暫停
  | { type: "permanent"; message: string }; // 伺服器明確拒絕，重送也不會成功

// 520~527 / 530 是 Cloudflare 的「源站連不上/逾時」(例如 Cloudflare Tunnel 的電腦睡著了)，
// 跟 502/503 一樣是「伺服器暫時不可用」，不是這一筆資料的問題。
const TRANSIENT_STATUSES = new Set([408, 425, 429, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

export function classifyError(err: unknown, kind: SyncEventKind): UploadOutcome {
  if (err instanceof NetworkError) return { type: "network" };
  if (err instanceof ApiError) {
    const { status, message } = err;
    if (status === 401) return { type: "auth" };
    if (TRANSIENT_STATUSES.has(status)) return { type: "transient", message };
    if (status >= 500) return { type: "suspect", message };
    // 刪除：伺服器上已經找不到 = 目的已達成
    if (kind === "DELETE" && status === 404) return { type: "moot" };
    // 放棄：找不到，或已經不是「等待餐後照」(例如在別支手機完成了) = 放棄已經沒意義
    if (kind === "ABANDON" && (status === 404 || status === 409)) return { type: "moot" };
    return { type: "permanent", message };
  }
  // 其他未預期的例外 (程式錯誤等)：當成可疑，避免無限重試也避免直接丟掉資料
  return { type: "suspect", message: err instanceof Error ? err.message : "未知錯誤" };
}

/** 指數退避：5 秒、10 秒、20 秒…最多 5 分鐘，±20% 隨機抖動避免一堆裝置同時重試 */
export function backoffMs(consecutiveFailures: number, random: () => number = Math.random): number {
  const base = Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, consecutiveFailures - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}

/**
 * 把伺服器資料 (可能是快取、可能已過時) 與本機還沒上傳完的狀態合併成畫面用的資料。
 *
 * 規則：
 * - 使用者已要求刪除的，不論伺服器怎麼說都先藏起來。
 * - 本機沒有未完成的工作、且伺服器有這筆 → 以伺服器為準 (有照片 id 可以載入)，
 *   只借用本機縮圖。例外：快取的伺服器資料還停在「等待餐後照」，但本機已經比它新
 *   (已經完成或放棄) → 用本機的。
 * - 其他情況 (還沒上傳、上傳失敗、伺服器不認識) → 用本機推導出的狀態。
 */
export function mergeMeals(server: MealRecord[], locals: LocalMeal[]): MealView[] {
  const byId = new Map<string, MealView>();
  for (const s of server) {
    byId.set(s.id, { ...s, sync: "synced", failureMessage: null, preThumbDataUrl: null, postThumbDataUrl: null });
  }

  for (const l of locals) {
    if (l.remove) {
      byId.delete(l.id);
      continue;
    }
    const existing = byId.get(l.id);
    const pending = hasPendingWork(l);
    const failed = l.failure !== null;
    const derived = deriveStatus(l);
    const preThumb = l.pre?.thumbDataUrl ?? null;
    const postThumb = l.post?.thumbDataUrl ?? null;

    const serverIsAuthoritative =
      existing !== undefined && !pending && !failed && !(existing.status === "AWAITING_POST_PHOTO" && derived !== existing.status);
    if (serverIsAuthoritative) {
      existing.preThumbDataUrl = preThumb;
      existing.postThumbDataUrl = postThumb;
      continue;
    }

    const postAt = l.post?.capturedAt ?? existing?.postMealAt ?? null;
    const duration = l.post
      ? Math.max(0, Math.round((Date.parse(l.post.capturedAt) - Date.parse(l.preAt)) / 1000))
      : existing?.mealDurationSeconds ?? null;

    byId.set(l.id, {
      id: l.id,
      mealType: l.mealType,
      status: derived,
      preMealAt: l.preAt,
      postMealAt: postAt,
      mealDurationSeconds: duration,
      notes: l.notes ?? existing?.notes ?? null,
      photos: existing?.photos,
      createdAt: existing?.createdAt ?? l.createdAtLocal,
      sync: l.localOnly ? "local" : failed ? "failed" : pending ? "pending" : "synced",
      failureMessage: l.failure?.message ?? null,
      preThumbDataUrl: preThumb,
      postThumbDataUrl: postThumb,
    });
  }

  return [...byId.values()].sort((a, b) => Date.parse(b.preMealAt) - Date.parse(a.preMealAt));
}
