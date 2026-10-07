import { deleteLocalMeal, listLocalMeals, mutateMeal } from "../offline/mealStore";
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

/* ---------- 把試用紀錄帶進登入的帳號 ---------- */

/**
 * 問過哪些帳號「要不要帶進來」了。
 *
 * 使用者說「不用」之後就不該每次登入再問一次——但也不能直接把試用資料刪掉，
 * 他可能只是這次不想帶、或是手機借給別人登入。所以只記「問過了」。
 */
const ASKED_KEY = "kidney-diet-trial-import-asked";

function readAsked(): string[] {
  try {
    const raw = localStorage.getItem(ASKED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 這個帳號還沒被問過，而且手機上真的有試用紀錄 → 登入後要跳提示 */
export async function pendingTrialImportCount(userId: string): Promise<number> {
  if (userId === TRIAL_USER_ID) return 0; // 試用模式自己不用問自己
  if (readAsked().includes(userId)) return 0;
  const meals = await listLocalMeals(TRIAL_USER_ID).catch(() => []);
  return meals.length;
}

export function markTrialImportAsked(userId: string): void {
  try {
    const asked = readAsked();
    if (!asked.includes(userId)) localStorage.setItem(ASKED_KEY, JSON.stringify([...asked, userId]));
  } catch {
    /* 存不進去最多就是下次再問一次，不值得讓畫面壞掉 */
  }
}

/**
 * 把試用期間的紀錄「搬」進登入的帳號。
 *
 * **搬，不是複製**：複製的話同一批紀錄會同時存在於試用模式與帳號底下，點數被算兩次，
 * 而且使用者還能再帶進第二個帳號。
 *
 * 搬過來的紀錄一律標記 `localOnly`，**永遠不會上傳**。IRB 尚未核准，試用期間拍的照片
 * 不能進伺服器；但也沒道理因為登入就讓使用者前幾天的紀錄憑空消失，所以留在本機、
 * 照常出現在日曆與點數裡，並在畫面上標示「不會上傳」。
 *
 * 健康資料（localStorage 的試用設定）不在搬移範圍：正常模式那份存在伺服器上，
 * 搬過去就等於上傳。
 *
 * @returns 實際搬了幾筆
 */
export async function importTrialMeals(userId: string): Promise<number> {
  if (userId === TRIAL_USER_ID) return 0;
  const meals = await listLocalMeals(TRIAL_USER_ID);
  let moved = 0;
  for (const meal of meals) {
    const ok = await mutateMeal(meal.id, (m) =>
      // 再確認一次這筆還是試用紀錄：mutateMeal 是重新讀出來的，中間可能已經被別的流程動過
      m.userId === TRIAL_USER_ID ? { ...m, userId, localOnly: true } : m
    );
    if (ok && ok.userId === userId) moved += 1;
  }
  markTrialImportAsked(userId);
  return moved;
}
