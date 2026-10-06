/**
 * 領域列舉。
 *
 * **為什麼不是 Prisma 產生的 enum**：資料庫改用 SQLite 之後，Prisma 的 SQLite connector
 * 不支援 enum（schema 裡那些欄位現在是 `String`）。這個檔案把原本由 `@prisma/client`
 * 提供的常數與型別補回來，所以程式碼的寫法完全不用變（`PointsReason.PRE_MEAL_LOGGED`
 * 仍然可以用、打錯字仍然會被 TypeScript 擋下來），只是保證從資料庫層移到了編譯期。
 *
 * **改這裡的時候，三個地方要一起改**：
 *   1. 這個檔案
 *   2. `prisma/schema.prisma` 對應欄位上方的「允許值」註解
 *   3. API 邊界的 `z.enum([...])`（routes/ 底下）——那才是真正擋住外部輸入的那一層
 */

function asEnum<const T extends readonly string[]>(values: T) {
  return Object.freeze(Object.fromEntries(values.map((v) => [v, v])) as { [K in T[number]]: K });
}

export const UserRole = asEnum(["PATIENT", "RESEARCHER", "ADMIN"] as const);
export type UserRole = keyof typeof UserRole;

export const Sex = asEnum(["MALE", "FEMALE", "OTHER"] as const);
export type Sex = keyof typeof Sex;

export const CkdStage = asEnum([
  "STAGE_1",
  "STAGE_2",
  "STAGE_3A",
  "STAGE_3B",
  "STAGE_4",
  "STAGE_5",
  "TRANSPLANT",
  "UNKNOWN",
] as const);
export type CkdStage = keyof typeof CkdStage;

export const DialysisType = asEnum(["NONE", "HEMODIALYSIS", "PERITONEAL_DIALYSIS"] as const);
export type DialysisType = keyof typeof DialysisType;

export const MealType = asEnum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const);
export type MealType = keyof typeof MealType;

export const MealRecordStatus = asEnum([
  /** 已拍餐前照，等待餐後照 */
  "AWAITING_POST_PHOTO",
  /** 餐前/餐後皆已完成 */
  "COMPLETED",
  /** 病人主動放棄這筆紀錄（例如忘記拍餐後照太久） */
  "ABANDONED",
] as const);
export type MealRecordStatus = keyof typeof MealRecordStatus;

export const PhotoPhase = asEnum(["PRE_MEAL", "POST_MEAL"] as const);
export type PhotoPhase = keyof typeof PhotoPhase;

export const NutritionEstimateStatus = asEnum(["NOT_STARTED", "PROCESSING", "COMPLETED", "FAILED"] as const);
export type NutritionEstimateStatus = keyof typeof NutritionEstimateStatus;

export const PointsReason = asEnum([
  "PRE_MEAL_LOGGED",
  "POST_MEAL_LOGGED",
  "DAILY_ALL_MEALS_BONUS",
  "STREAK_MILESTONE",
  "BADGE_AWARDED",
  "MANUAL_ADJUSTMENT",
] as const);
export type PointsReason = keyof typeof PointsReason;

export const PasswordResetSource = asEnum([
  /** 病人在 App 按「忘記密碼」，代碼寄到他自己的信箱 */
  "SELF_SERVICE",
  /** 衛教師/研究人員當面確認身分後代開（病人連信箱都進不去時的唯一辦法） */
  "STAFF",
] as const);
export type PasswordResetSource = keyof typeof PasswordResetSource;
