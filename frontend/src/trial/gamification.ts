import type { BadgeSummary, GamificationSummary } from "../api/types";
import type { LocalMeal } from "../offline/types";

/**
 * 試用模式專用：在手機上自己算點數 / 連續天數 / 徽章。
 *
 * 為什麼需要這一支：正常模式下這些數字是後端算好回傳的（見
 * backend/src/services/gamification.service.ts）。試用模式根本沒有後端，
 * 如果點數永遠顯示 0，護理師會把它當成 bug 回報，真正想問的「介面好不好用」
 * 反而問不到。所以這裡把後端的規則原樣搬過來，在本機重算一次。
 *
 * **這份規則必須跟後端保持一致**。改了後端的點數/門檻，這裡也要跟著改，
 * 否則試用版看到的數字會跟正式版對不起來。下面的常數與函式名稱刻意跟
 * 後端取一樣，方便對照。
 *
 * 做法是「把所有已完成的紀錄依餐後照時間由早到晚重播一次」，而不是直接統計。
 * 因為連續天數、當日全勤、里程碑徽章都跟「發生順序」有關，重播才會跟後端
 * 逐筆處理上傳佇列的結果一致。
 */

export const POINTS = {
  PRE_MEAL_LOGGED: 10,
  POST_MEAL_LOGGED: 15,
  DAILY_ALL_MEALS_BONUS: 20,
  BADGE_AWARDED: 25,
} as const;

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;
const MEAL_COUNT_MILESTONES = [10, 50, 100, 200] as const;
const BREAKFAST_MILESTONE = 10;
const CORE_MEAL_TYPES = ["BREAKFAST", "LUNCH", "DINNER"] as const;

function streakBonusPoints(days: number): number {
  if (days >= 100) return 200;
  if (days >= 60) return 120;
  if (days >= 30) return 80;
  if (days >= 14) return 50;
  if (days >= 7) return 30;
  return 15; // 3 天
}

/** 徽章目錄，內容對齊 backend/prisma/seed.ts（順序就是 sortOrder） */
export const BADGE_CATALOG: ReadonlyArray<Omit<BadgeSummary, "earned" | "earnedAt">> = [
  { code: "FIRST_MEAL", name: "跨出第一步", description: "完成第一筆餐前紀錄", iconEmoji: "🌱" },
  { code: "STREAK_3", name: "三天不間斷", description: "連續 3 天都有紀錄飲食", iconEmoji: "🔥" },
  { code: "STREAK_7", name: "一週好習慣", description: "連續 7 天都有紀錄飲食", iconEmoji: "🔥" },
  { code: "STREAK_14", name: "兩週堅持", description: "連續 14 天都有紀錄飲食", iconEmoji: "🔥" },
  { code: "STREAK_30", name: "月度達人", description: "連續 30 天都有紀錄飲食", iconEmoji: "🏆" },
  { code: "STREAK_60", name: "兩月堅持", description: "連續 60 天都有紀錄飲食", iconEmoji: "🏆" },
  { code: "STREAK_100", name: "百日修煉", description: "連續 100 天都有紀錄飲食", iconEmoji: "👑" },
  { code: "PERFECT_DAY", name: "完美的一天", description: "同一天內完成早、中、晚三餐紀錄", iconEmoji: "⭐" },
  { code: "BREAKFAST_10", name: "早餐達人", description: "累計完成 10 次早餐紀錄", iconEmoji: "🍳" },
  { code: "MEALS_10", name: "紀錄小達人", description: "累計完成 10 筆用餐紀錄", iconEmoji: "📸" },
  { code: "MEALS_50", name: "紀錄能手", description: "累計完成 50 筆用餐紀錄", iconEmoji: "📸" },
  { code: "MEALS_100", name: "百餐紀錄", description: "累計完成 100 筆用餐紀錄", iconEmoji: "💯" },
  { code: "MEALS_200", name: "紀錄大師", description: "累計完成 200 筆用餐紀錄", iconEmoji: "💯" },
];

/** 把 UTC 時間依裝置回報的時區偏移換算成「當地日期」YYYY-MM-DD（同後端 localDateKey） */
function localDateKey(iso: string, tzOffsetMinutes: number): string {
  return new Date(Date.parse(iso) - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function dayIndex(dateKey: string): number {
  return Math.round(Date.parse(`${dateKey}T00:00:00.000Z`) / 86_400_000);
}

/**
 * 依本機紀錄算出遊戲化摘要。
 *
 * 刻意「不」排除已放棄 / 已刪除的紀錄：跟線上版一樣，已經拿到的點數與徽章
 * 不會因為之後放棄或刪除紀錄而被追討回去（見 docs/DATABASE.md 的軟刪除說明）。
 */
export function computeLocalGamification(meals: LocalMeal[]): GamificationSummary {
  let totalPoints = 0;
  /** 徽章代碼 → 取得時間 */
  const earned = new Map<string, string>();

  function award(code: string, at: string): void {
    if (earned.has(code)) return;
    earned.set(code, at);
    totalPoints += POINTS.BADGE_AWARDED;
  }

  // 餐前點數：每一筆「在這支手機上拍過餐前照」的紀錄各 10 點。
  // pre 為 null 的是「伺服器上已有、本機只補餐後照」的殼，試用模式不會出現，這裡防禦性排除。
  const withPre = meals
    .filter((m) => m.pre !== null)
    .sort((a, b) => Date.parse(a.pre!.capturedAt) - Date.parse(b.pre!.capturedAt));
  totalPoints += withPre.length * POINTS.PRE_MEAL_LOGGED;
  if (withPre.length > 0) award("FIRST_MEAL", withPre[0]!.pre!.capturedAt);

  // 已完成 = 有餐後照且沒有被放棄（與 offline/logic.ts 的 deriveStatus 同一套判斷）
  const completed = meals
    .filter((m) => m.post !== null && m.abandon === null)
    .sort((a, b) => Date.parse(a.post!.capturedAt) - Date.parse(b.post!.capturedAt));

  let currentStreakDays = 0;
  let longestStreakDays = 0;
  let lastActiveDay: number | null = null;
  const typesByDay = new Map<string, Set<string>>();
  const perfectDays = new Set<string>();
  let completedCount = 0;
  let breakfastCount = 0;

  for (const meal of completed) {
    const post = meal.post!;
    const dayKey = localDateKey(post.capturedAt, post.tzOffsetMinutes);
    const day = dayIndex(dayKey);

    // --- 連續天數（對齊後端 updateStreak） ---
    if (lastActiveDay === null || day !== lastActiveDay) {
      let nextStreak = 1;
      let skip = false;
      if (lastActiveDay !== null) {
        const dayDiff = day - lastActiveDay;
        if (dayDiff === 1) nextStreak = currentStreakDays + 1;
        // dayDiff < 0（補傳了更早的資料）後端會整個跳過不動，這裡一樣；
        // 依時間排序後理論上不會發生，保留是為了跟後端逐行對得起來。
        else if (dayDiff < 0) skip = true;
        // dayDiff > 1 → 中斷，重新從 1 起算
      }
      if (!skip) {
        currentStreakDays = nextStreak;
        longestStreakDays = Math.max(nextStreak, longestStreakDays);
        lastActiveDay = day;
        if ((STREAK_MILESTONES as readonly number[]).includes(nextStreak)) {
          totalPoints += streakBonusPoints(nextStreak);
          award(`STREAK_${nextStreak}`, post.capturedAt);
        }
      }
    }

    // --- 當日三餐全勤（對齊後端 checkDailyAllMealsBonus） ---
    const types = typesByDay.get(dayKey) ?? new Set<string>();
    types.add(meal.mealType);
    typesByDay.set(dayKey, types);
    if (!perfectDays.has(dayKey) && CORE_MEAL_TYPES.every((t) => types.has(t))) {
      perfectDays.add(dayKey);
      totalPoints += POINTS.DAILY_ALL_MEALS_BONUS;
      award("PERFECT_DAY", post.capturedAt);
    }

    // --- 累計徽章 ---
    completedCount += 1;
    if ((MEAL_COUNT_MILESTONES as readonly number[]).includes(completedCount)) {
      award(`MEALS_${completedCount}`, post.capturedAt);
    }
    if (meal.mealType === "BREAKFAST") {
      breakfastCount += 1;
      if (breakfastCount === BREAKFAST_MILESTONE) award("BREAKFAST_10", post.capturedAt);
    }

    totalPoints += POINTS.POST_MEAL_LOGGED;
  }

  return {
    totalPoints,
    currentStreakDays,
    longestStreakDays,
    badges: BADGE_CATALOG.map((b) => ({
      ...b,
      earned: earned.has(b.code),
      earnedAt: earned.get(b.code) ?? null,
    })),
  };
}
