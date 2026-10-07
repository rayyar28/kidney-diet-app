import type { GamificationSummary, MealRecord, MealRecordStatus, MealType } from "../api/types";

/**
 * 一個拍照「時間點」(餐前或餐後) 在本機的狀態。
 * file 在上傳成功後會被清成 null 釋放空間，只留縮圖與中繼資料。
 */
export interface LocalPhotoSlot {
  capturedAt: string; // ISO，裝置時鐘的原始值
  tzOffsetMinutes: number;
  /** 這張照片是不是在沒網路/連不上伺服器的狀況下拍的 (上傳時回報給後端做研究分析) */
  capturedOffline: boolean;
  thumbDataUrl: string | null;
  file: { blob: Blob; name: string; type: string } | null;
  synced: boolean;
}

export interface LocalFailure {
  /** permanent: 伺服器明確拒絕 (照片格式不對等)，重試沒有用；stalled: 伺服器一直回 5xx，暫停等人處理 */
  kind: "permanent" | "stalled";
  message: string;
  at: string;
}

/**
 * 一筆「在這支手機上經手過」的用餐紀錄。id 就是伺服器上 MealRecord 的 id
 * (由前端產生、後端接受)，所以離線建立、之後補傳都指向同一筆。
 */
export interface LocalMeal {
  id: string;
  userId: string;
  mealType: MealType;
  notes: string | null;
  /** 餐前拍攝時間 (= 伺服器的 preMealAt)，列表排序與計算用餐時長用 */
  preAt: string;
  /** null 代表伺服器早就知道這筆紀錄 (例如在別支手機建立，或本功能上線前建立)，這裡只是補餐後照用的殼 */
  pre: LocalPhotoSlot | null;
  post: LocalPhotoSlot | null;
  abandon: { requestedAt: string; synced: boolean } | null;
  remove: { requestedAt: string; synced: boolean } | null;
  failure: LocalFailure | null;
  /** 連續遇到「可疑的 5xx」的次數，用來判斷要不要暫停這筆 */
  attempts: number;
  /** 這筆下次可以再試的時間 (ms epoch)，避免對同一個壞掉的請求狂打 */
  nextAttemptAt: number;
  /** 第一次遇到「可疑 5xx」的時間 (ms epoch)；成功上傳後清掉 */
  firstSuspectAt?: number;
  /**
   * 這一筆只留在這支手機，**永遠不會上傳**。
   *
   * 目前只有一個來源：使用者在試用模式記錄、登入後選擇「帶進帳號」的紀錄
   * （見 trial/trialData.ts 的 importTrialMeals）。IRB 尚未核准，試用期間拍的照片
   * 不能進伺服器，但也不該因為登入就憑空消失，所以帶進來之後標記成本機專屬。
   *
   * 守門的地方只有一個：`buildEvents` 不會為這種紀錄產生任何上傳事件。
   * 另外它是這份資料的**唯一一份**，所以 `pruneSyncedMeals` 絕對不能清掉它。
   */
  localOnly?: boolean;
  createdAtLocal: string;
}

export type SyncEventKind = "PRE" | "POST" | "ABANDON" | "DELETE";

export interface SyncEvent {
  mealId: string;
  kind: SyncEventKind;
  /** 這個動作發生的時間 (裝置時鐘)，全部待上傳事件依它排序 */
  at: string;
}

/** local = 只留在這支手機、不會上傳的紀錄（從試用模式帶進來的） */
export type MealSyncState = "synced" | "pending" | "failed" | "local";

/** 畫面上顯示用的「合併後」紀錄：伺服器資料 + 本機還沒上傳完的狀態 */
export interface MealView extends MealRecord {
  sync: MealSyncState;
  failureMessage: string | null;
  preThumbDataUrl: string | null;
  postThumbDataUrl: string | null;
}

export interface CachedServerData {
  meals: MealRecord[];
  summary: GamificationSummary | null;
  updatedAt: number;
}

export type { MealRecordStatus };
