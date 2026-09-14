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

export interface GamificationSummary {
  totalPoints: number;
  currentStreakDays: number;
  longestStreakDays: number;
  badges: BadgeSummary[];
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: "PATIENT" | "RESEARCHER" | "ADMIN";
}
