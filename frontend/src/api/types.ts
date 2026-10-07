export type MealType = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
export type MealRecordStatus = "AWAITING_POST_PHOTO" | "COMPLETED" | "ABANDONED";
export type PhotoPhase = "PRE_MEAL" | "POST_MEAL";

export interface Photo {
  id: string;
  mealRecordId: string;
  phase: PhotoPhase;
  mimeType: string;
  fileSizeBytes: number;
  widthPx: number;
  heightPx: number;
  capturedAt: string;
  uploadedAt: string;
}

export interface MealRecord {
  id: string;
  mealType: MealType;
  status: MealRecordStatus;
  preMealAt: string;
  postMealAt: string | null;
  mealDurationSeconds: number | null;
  notes: string | null;
  photos?: Photo[];
  createdAt: string;
}

export interface BadgeSummary {
  code: string;
  name: string;
  description: string;
  iconEmoji: string;
  earned: boolean;
  earnedAt: string | null;
}

/**
 * 伺服器算到哪裡為止——手機離線時要從這裡「接著往下算」還沒上傳的紀錄。
 *
 * 這幾個數字是手機自己湊不出來的：本機已同步的紀錄會被定期清掉（只留最近 100 筆 /
 * 60 天，見 offline/mealStore.ts 的 pruneSyncedMeals），所以跨越整個收案期的累計數字
 * 一定要由伺服器提供。詳見 backend/src/services/gamification.service.ts 的 getReplayBase。
 */
export interface ReplayBase {
  /** 最後一次算進連續天數的「當地日期」YYYY-MM-DD；null = 還沒有任何完成紀錄 */
  lastActiveDateKey: string | null;
  /** 累計完成的餐數（用來判斷 MEALS_10/50/100/200 徽章門檻） */
  completedMealCount: number;
  /** 累計完成的早餐數（BREAKFAST_10 徽章門檻） */
  breakfastCompletedCount: number;
  /** 最近 14 天「某個當地日期已完成哪些主餐」，用來判斷補上一餐會不會湊成當日全勤 */
  coreMealTypesByDay: Record<string, string[]>;
}

export interface GamificationSummary {
  totalPoints: number;
  currentStreakDays: number;
  longestStreakDays: number;
  badges: BadgeSummary[];
  /** 這個版本之前的後端 / 之前存下來的本機快取不會有這個欄位，所以是 optional */
  replayBase?: ReplayBase;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: "PATIENT" | "RESEARCHER" | "ADMIN";
}
