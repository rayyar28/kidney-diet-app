import type { MealView } from "../offline/types";

/**
 * 試用模式下，本機紀錄的「同步狀態」沒有意義——它永遠不會被上傳。
 *
 * 如果不處理，紀錄頁每一筆都會掛著「☁️ 待上傳」的標籤，試用的護理師會以為
 * App 壞掉或網路有問題，回報的就不是我們想知道的使用問題了。
 */
export function asTrialViews(meals: MealView[]): MealView[] {
  return meals.map((m) => (m.sync === "synced" ? m : { ...m, sync: "synced", failureMessage: null }));
}
