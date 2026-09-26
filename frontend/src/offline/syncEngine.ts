import { isTrialMode, useAuthStore } from "../store/auth";
import { backoffMs, hasPendingWork } from "./logic";
import { getLocalMeal, listLocalMeals, onLocalChange, pruneSyncedMeals, saveServerCache } from "./mealStore";
import { apiTransport, runSyncOnce, type RunResult } from "./syncRunner";
import { useSyncStore } from "./syncStore";

/**
 * 同步引擎：決定「什麼時候」把本機佇列送給伺服器。
 *
 * 觸發時機：App 啟動、本機有新動作、網路恢復 (online)、App 回到前景、
 * 佇列還有東西時每 30 秒、登入狀態恢復、使用者手動按「立即同步」。
 * 失敗後依指數退避重試；網路恢復或使用者手動觸發會略過退避立刻試。
 */

const LOCK_NAME = "kidney-diet-sync";
const POLL_INTERVAL_MS = 30_000;

let running: Promise<RunResult | null> | null = null;
/** 上一輪執行期間又有新動作進來，這一輪結束後要再跑一輪 (否則新動作要等下一次輪詢) */
let dirty = false;
/** 有人要求「強制」同步 (略過退避)：下一輪要略過每一筆的退避等待 */
let forceNext = false;
let consecutiveFailures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshCounts(): Promise<void> {
  const user = useAuthStore.getState().user;
  if (!user || isTrialMode()) {
    useSyncStore.getState().patch({ pendingCount: 0, failedCount: 0 });
    return;
  }
  const meals = await listLocalMeals(user.id);
  useSyncStore.getState().patch({
    pendingCount: meals.filter((m) => !m.failure && hasPendingWork(m)).length,
    failedCount: meals.filter((m) => m.failure !== null).length,
  });
}

function scheduleRetry(delayMs: number): void {
  if (retryTimer) clearTimeout(retryTimer);
  useSyncStore.getState().patch({ nextRetryAt: Date.now() + delayMs });
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void requestSync({ force: true });
  }, delayMs);
}

async function executeRound(userId: string): Promise<RunResult> {
  const store = useSyncStore.getState();
  const wasFailing = consecutiveFailures > 0;
  const ignoreBackoff = forceNext;
  forceNext = false;
  store.patch({ phase: "syncing" });
  const result = await runSyncOnce({ userId, transport: apiTransport, ignoreBackoff });

  if (result.gamification) {
    store.patch({ lastGamification: result.gamification });
    await saveServerCache(userId, { summary: result.gamification }).catch(() => {});
  }
  if (result.processed > 0) {
    const at = Date.now();
    store.patch({ lastBatch: { processed: result.processed, at } });
    if (wasFailing) store.patch({ lastRecovery: { processed: result.processed, at } });
  }

  switch (result.stopped) {
    case "done":
      consecutiveFailures = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      store.patch({ phase: "idle", lastSyncedAt: Date.now(), nextRetryAt: null });
      await pruneSyncedMeals(userId).catch(() => {});
      break;
    case "network":
    case "transient":
      consecutiveFailures++;
      store.patch({ phase: result.stopped === "network" ? "offline" : "busy" });
      scheduleRetry(backoffMs(consecutiveFailures));
      break;
    case "auth":
      // 登入失效：不排重試 (重試也一定失敗)，等使用者重新登入後由 auth store 訂閱觸發
      store.patch({ phase: "paused-auth", nextRetryAt: null });
      break;
  }
  await refreshCounts();
  return result;
}

async function runLocked(userId: string): Promise<RunResult | null> {
  const body = async (): Promise<RunResult | null> => {
    let last: RunResult | null = null;
    do {
      dirty = false;
      last = await executeRound(userId);
    } while (dirty && last.stopped === "done");
    return last;
  };
  // 多個分頁/視窗同時開著時，只讓一個在上傳，避免重複送出
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? body() : null));
  }
  return body();
}

/**
 * 請求同步。已經有一輪在跑的話，不另開新的，只標記「跑完後再來一輪」並回傳同一個 promise。
 * force: 略過退避等待 (網路恢復、使用者手動按、App 回到前景時用)。
 */
export function requestSync(opts: { force?: boolean } = {}): Promise<RunResult | null> {
  // 試用模式沒有伺服器可傳。這個 return 要擺在最前面、而且不能去動 syncStore：
  // 只要碰了狀態，畫面就會冒出「請重新登入 / N 筆等待上傳」之類跟試用無關的提示。
  if (isTrialMode()) return Promise.resolve(null);
  if (opts.force) forceNext = true;
  if (running) {
    dirty = true;
    return running;
  }
  const { user, accessToken } = useAuthStore.getState();
  if (!user || !accessToken) {
    useSyncStore.getState().patch({ phase: "paused-auth" });
    return Promise.resolve(null);
  }
  const { nextRetryAt } = useSyncStore.getState();
  if (!opts.force && nextRetryAt && Date.now() < nextRetryAt) return Promise.resolve(null);

  running = runLocked(user.id)
    .catch((err) => {
      // 引擎本身的意外錯誤不能讓 App 當掉，也不能卡住之後的同步
      console.error("[sync] 同步失敗", err);
      consecutiveFailures++;
      useSyncStore.getState().patch({ phase: "busy" });
      scheduleRetry(backoffMs(consecutiveFailures));
      return null;
    })
    .finally(() => {
      running = null;
    });
  return running;
}

export type SyncOutcome = "synced" | "pending" | { failed: string };

/**
 * 給「剛送出一筆紀錄」的畫面用：立刻試著上傳，最多等 timeoutMs。
 * 線上就能拿到結果 (可以立刻顯示點數)；離線或太慢就回 "pending"，資料已經安全存在本機。
 */
export async function syncAndWait(mealId: string, timeoutMs = 8000): Promise<SyncOutcome> {
  const run = requestSync({ force: true });
  await Promise.race([run, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
  const meal = await getLocalMeal(mealId);
  if (!meal) return "synced";
  if (meal.failure) return { failed: meal.failure.message };
  return hasPendingWork(meal) ? "pending" : "synced";
}

/** 測試用：清掉引擎的模組層級狀態 (計時器、失敗計數) */
export function resetSyncEngineForTests(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  running = null;
  dirty = false;
  forceNext = false;
  consecutiveFailures = 0;
}

export function startSyncEngine(): () => void {
  const onOnline = () => void requestSync({ force: true });
  const onVisible = () => {
    if (document.visibilityState === "visible") void requestSync({ force: true });
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  const interval = setInterval(() => {
    if (useSyncStore.getState().pendingCount > 0) void requestSync();
  }, POLL_INTERVAL_MS);

  const offLocalChange = onLocalChange(() => {
    void refreshCounts();
    void requestSync();
  });

  // 重新登入後，把登入期間卡住的佇列接著上傳
  const offAuth = useAuthStore.subscribe((state, prev) => {
    if (state.accessToken && !prev.accessToken) void requestSync({ force: true });
    if (state.user?.id !== prev.user?.id) void refreshCounts();
  });

  void refreshCounts();
  void requestSync({ force: true });

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(interval);
    offLocalChange();
    offAuth();
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
}
