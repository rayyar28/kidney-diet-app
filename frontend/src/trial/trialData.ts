import { deleteLocalMeal, listLocalMeals } from "../offline/mealStore";
import { TRIAL_USER_ID } from "../store/auth";

/**
 * 試用模式的本機資料。
 *
 * 用餐紀錄跟正常模式共用同一個 IndexedDB，只是掛在固定的假 userId 底下
 * （TRIAL_USER_ID），所以跟真實帳號的資料天然分開，也不可能被同步引擎撿去上傳
 * （同步是依登入帳號的 id 撈資料，而試用模式根本不會啟動同步引擎）。
 *
 * 健康資料在正常模式是存在伺服器的 PatientProfile，試用模式沒有伺服器，
 * 就直接放 localStorage：它只是讓護理師能把「我的健康資料」這一頁走完，
 * 不是要保存研究資料。
 */

export interface TrialProfile {
  ckdStage: string;
  dialysisType: string;
  dailySodiumLimitMg: number | null;
  dailyPotassiumLimitMg: number | null;
  dailyPhosphorusLimitMg: number | null;
}

const PROFILE_KEY = "kidney-diet-trial-profile";

export function loadTrialProfile(): TrialProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as TrialProfile) : null;
  } catch {
    return null;
  }
}

export function saveTrialProfile(profile: TrialProfile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* 無痕模式等情況存不進去：試用資料不重要，不要因此讓畫面壞掉 */
  }
}

/** 清掉這支手機上所有試用資料，讓下一位測試者從乾淨的狀態開始 */
export async function clearTrialData(): Promise<void> {
  const meals = await listLocalMeals(TRIAL_USER_ID);
  for (const meal of meals) await deleteLocalMeal(meal.id);
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* 同上 */
  }
}
