import type { BadgeSummary, GamificationSummary } from "../api/types";
import type { LocalMeal } from "../offline/types";

/**
 * 在手機上自己算點數 / 連續天數 / 徽章。
 *
 * **為什麼要在手機上算**：點數是給病人的成就感，而病人常常是離線的（家裡沒 Wi-Fi、
 * 院內網路要回診才連得到）。如果等伺服器回傳才有數字，那病人剛拍完一餐、最想看到
 * 回饋的那一刻，畫面上只會寫「有網路時會幫你算」——那個時候顯示的 0 分比不顯示還傷。
 *
 * **做法是「接著往下算」，不是「整個重算」**：
 *   顯示的數字 ＝ 伺服器算到的結果（base）＋ 這支手機上還沒上傳成功的紀錄
 *
 * 兩個理由讓它必須這樣做，而不是在手機上重播整段歷史：
 *   1. 本機已同步的紀錄會被定期清掉（只留最近 100 筆 / 60 天，見 offline/mealStore.ts
 *      的 pruneSyncedMeals）。重播算不到被清掉的那些，收案到後期點數會「變少」——
 *      對病人來說那是最糟的一種 bug。
 *   2. 伺服器才是研究資料的正式來源。只補上「伺服器還不知道的部分」，東西上傳完成之後
 *      手機顯示的數字就會自動收斂回伺服器的數字，兩邊不會對不起來。
 *
 * **這份規則必須跟 backend/src/services/gamification.service.ts 保持一致。**
 * 改了後端的點數/門檻，這裡也要跟著改；replay.test.ts 有兩個測試直接去讀後端的程式碼比對。
 * 下面的常數與函式名稱刻意跟後端取一樣，方便對照。
 *
 * 計算方式是「把還沒上傳的完成紀錄依餐後照時間由早到晚重播一次」，而不是直接統計，
 * 因為連續天數、當日全勤、里程碑徽章都跟「發生順序」有關，重播才會跟後端逐筆處理
 * 上傳佇列的結果一致。
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

/** 重播的起點：伺服器已經算到的狀態 */
export interface ReplayBase {
  totalPoints: number;
  currentStreakDays: number;
  longestStreakDays: number;
  /** 最後一次算進連續天數的當地日期 YYYY-MM-DD；null = 還沒有任何完成紀錄 */
  lastActiveDateKey: string | null;
  /** 已取得的徽章代碼 → 取得時間 */
  earnedBadges: Readonly<Record<string, string | null>>;
  completedMealCount: number;
  breakfastCompletedCount: number;
  /** 當地日期 → 那天已完成的主餐種類 */
  coreMealTypesByDay: Readonly<Record<string, readonly string[]>>;
  /** 徽章的名稱/說明/圖示。正常模式用伺服器給的，這樣改文案不必重新打包 App */
  catalog: ReadonlyArray<Omit<BadgeSummary, "earned" | "earnedAt">>;
}

/** 什麼都還沒發生。試用模式用這個當起點（試用模式根本沒有伺服器） */
export const ZERO_BASE: ReplayBase = Object.freeze({
  totalPoints: 0,
  currentStreakDays: 0,
  longestStreakDays: 0,
  lastActiveDateKey: null,
  earnedBadges: Object.freeze({}),
  completedMealCount: 0,
  breakfastCompletedCount: 0,
  coreMealTypesByDay: Object.freeze({}),
  catalog: BADGE_CATALOG,
});

function stripEarned(b: BadgeSummary): Omit<BadgeSummary, "earned" | "earnedAt"> {
  return { code: b.code, name: b.name, description: b.description, iconEmoji: b.iconEmoji };
}

/** 把伺服器的摘要（或它的本機快取）轉成重播起點 */
export function baseFromServer(summary: GamificationSummary | null | undefined): ReplayBase {
  if (!summary) return ZERO_BASE;
  const base = summary.replayBase;
  return {
    totalPoints: summary.totalPoints,
    currentStreakDays: summary.currentStreakDays,
    longestStreakDays: summary.longestStreakDays,
    lastActiveDateKey: base?.lastActiveDateKey ?? null,
    earnedBadges: Object.fromEntries(summary.badges.filter((b) => b.earned).map((b) => [b.code, b.earnedAt])),
    completedMealCount: base?.completedMealCount ?? 0,
    breakfastCompletedCount: base?.breakfastCompletedCount ?? 0,
    coreMealTypesByDay: base?.coreMealTypesByDay ?? {},
    // 伺服器沒回徽章清單（理論上不會，防禦性處理）就用本機那一份，至少畫面不會整片空白
    catalog: summary.badges.length > 0 ? summary.badges.map(stripEarned) : BADGE_CATALOG,
  };
}

/** 把 UTC 時間依裝置回報的時區偏移換算成「當地日期」YYYY-MM-DD（同後端 localDateKey） */
function localDateKey(iso: string, tzOffsetMinutes: number): string {
  return new Date(Date.parse(iso) - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function dayIndex(dateKey: string): number {
  return Math.round(Date.parse(`${dateKey}T00:00:00.000Z`) / 86_400_000);
}

/**
 * 從 base 開始，把「這支手機上還沒上傳成功」的紀錄接著算下去。
 *
 * 只算還沒同步的部分（`slot.synced === false`）：已經上傳成功的，伺服器在 base 裡算過了，
 * 再算一次就變雙倍。試用模式永遠不會同步成功，所以等於整段歷史都在這裡算。
 *
 * 刻意「不」排除已刪除的紀錄：跟線上版一樣，已經拿到的點數與徽章不會因為之後刪除紀錄
 * 而被追討回去（見 docs/DATABASE.md 的軟刪除說明）。
 */
export function replayGamification(base: ReplayBase, meals: LocalMeal[]): GamificationSummary {
  let totalPoints = base.totalPoints;
  const earned = new Map<string, string | null>(Object.entries(base.earnedBadges));

  function award(code: string, at: string): void {
    if (earned.has(code)) return;
    earned.set(code, at);
    totalPoints += POINTS.BADGE_AWARDED;
  }

  // 餐前點數：每一筆「拍了餐前照、還沒上傳成功」的紀錄各 10 點。
  // pre 為 null 的是「伺服器上已有、本機只拿來補餐後照」的殼，本來就不該再給一次餐前點數。
  const newPre = meals
    .filter((m) => m.pre !== null && !m.pre.synced)
    .sort((a, b) => Date.parse(a.pre!.capturedAt) - Date.parse(b.pre!.capturedAt));
  totalPoints += newPre.length * POINTS.PRE_MEAL_LOGGED;
  if (newPre.length > 0) award("FIRST_MEAL", newPre[0]!.pre!.capturedAt);

  // 已完成 = 有餐後照且沒有被放棄（與 offline/logic.ts 的 deriveStatus 同一套判斷）
  const newCompleted = meals
    .filter((m) => m.post !== null && !m.post.synced && m.abandon === null)
    .sort((a, b) => Date.parse(a.post!.capturedAt) - Date.parse(b.post!.capturedAt));

  let currentStreakDays = base.currentStreakDays;
  let longestStreakDays = base.longestStreakDays;
  let lastActiveDay = base.lastActiveDateKey === null ? null : dayIndex(base.lastActiveDateKey);

  // base 說「連續 N 天」卻沒說最後一天是哪天（舊版後端、或這個版本之前存下來的本機快取
  // 沒有 replayBase）：硬算下去會把連續天數誤重設成 1，也就是病人會看到連續天數「變少」。
  // 寧可先不動它，等連上伺服器拿到完整的 base 再算。
  const streakUnknown = base.lastActiveDateKey === null && base.currentStreakDays > 0;

  const typesByDay = new Map<string, Set<string>>();
  const perfectDays = new Set<string>();
  for (const [day, types] of Object.entries(base.coreMealTypesByDay)) {
    typesByDay.set(day, new Set(types));
    // 伺服器每完成一餐就會檢查一次當日全勤，所以「三種主餐都有了」就代表獎勵已經發過
    if (CORE_MEAL_TYPES.every((t) => types.includes(t))) perfectDays.add(day);
  }

  let completedCount = base.completedMealCount;
  let breakfastCount = base.breakfastCompletedCount;

  for (const meal of newCompleted) {
    const post = meal.post!;
    const dayKey = localDateKey(post.capturedAt, post.tzOffsetMinutes);
    const day = dayIndex(dayKey);

    // --- 連續天數（對齊後端 updateStreak） ---
    if (!streakUnknown && (lastActiveDay === null || day !== lastActiveDay)) {
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
    badges: base.catalog.map((b) => ({
      ...b,
      earned: earned.has(b.code),
      earnedAt: earned.get(b.code) ?? null,
    })),
  };
}

/** 試用模式：沒有伺服器，整段歷史都在本機，所以從零開始重播全部紀錄。 */
export function computeLocalGamification(meals: LocalMeal[]): GamificationSummary {
  return replayGamification(ZERO_BASE, meals);
}

/**
 * 正常模式：伺服器算到哪，手機就從那裡接著算還沒上傳的部分。
 *
 * `summary` 傳 null（全新安裝又剛好連不上伺服器）時等於從零開始算——此時本機也只有這些
 * 紀錄，顯示它們是當下最誠實的答案；之後連上伺服器，數字只會往上跳、不會往下掉。
 */
export function projectGamification(
  summary: GamificationSummary | null | undefined,
  meals: LocalMeal[]
): GamificationSummary {
  return replayGamification(baseFromServer(summary), meals);
}
