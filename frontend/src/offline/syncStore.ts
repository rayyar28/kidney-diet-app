import { create } from "zustand";
import type { GamificationSummary } from "../api/types";

export type SyncPhase =
  | "idle" // 沒事，或正常運作中
  | "syncing" // 正在上傳
  | "offline" // 連不上伺服器，等網路回來
  | "busy" // 伺服器忙碌/出錯，稍後自動重試
  | "paused-auth"; // 登入失效，要重新登入才能繼續上傳

interface SyncState {
  phase: SyncPhase;
  /** 還有動作等著上傳的用餐紀錄數 (不含已失敗的) */
  pendingCount: number;
  /** 上傳失敗、需要使用者處理的紀錄數 */
  failedCount: number;
  lastSyncedAt: number | null;
  nextRetryAt: number | null;
  /**
   * 最近一次從伺服器拿到的遊戲化摘要。
   *
   * 畫面上的點數是「這份摘要 ＋ 本機還沒上傳的紀錄」算出來的
   * （見 gamification/replay.ts 的 projectGamification），所以它不只是提示用的資料，
   * 而是顯示數字的基準。登出時會被清掉，避免換帳號時殘留上一個人的數字。
   */
  lastGamification: GamificationSummary | null;
  /** 最近一輪有上傳成功東西的紀錄，畫面用它跳出「已同步」提示；at 用來辨識是不是新的一輪 */
  lastBatch: { processed: number; at: number } | null;
  /** 上一輪失敗 (離線/伺服器忙碌) 之後，這一輪成功補傳了東西：畫面用它跳「網路恢復了，已上傳 N 筆」提示 */
  lastRecovery: { processed: number; at: number } | null;
  patch: (partial: Partial<Omit<SyncState, "patch">>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  phase: "idle",
  pendingCount: 0,
  failedCount: 0,
  lastSyncedAt: null,
  nextRetryAt: null,
  lastGamification: null,
  lastBatch: null,
  lastRecovery: null,
  patch: (partial) => set(partial),
}));
