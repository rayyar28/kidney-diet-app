import { PointsReason } from "@prisma/client";
import { prisma } from "../prisma.js";

/**
 * 遊戲化規則集中寫在這一支檔案，方便未來調整點數/門檻時只要改這裡。
 * 所有「加點數」的動作都走 PointsLedgerEntry (只增不改的事件紀錄)，
 * 徽章判斷則是每次用餐完成後重新檢查一次條件，符合就發放 (UserBadge 有
 * unique(userId, badgeId) 擋重複)。
 */

export const POINTS = {
  PRE_MEAL_LOGGED: 10,
  POST_MEAL_LOGGED: 15,
  DAILY_ALL_MEALS_BONUS: 20,
} as const;

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;
const MEAL_COUNT_MILESTONES = [10, 50, 100, 200] as const;
const BREAKFAST_MILESTONE = 10;

function streakBonusPoints(days: number): number {
  if (days >= 100) return 200;
  if (days >= 60) return 120;
  if (days >= 30) return 80;
  if (days >= 14) return 50;
  if (days >= 7) return 30;
  return 15; // 3 天
}

/** 把 UTC 時間依「使用者裝置回報的時區偏移」換算成當地日期字串 YYYY-MM-DD */
function localDateKey(date: Date, tzOffsetMinutes: number | null | undefined): string {
  const offset = tzOffsetMinutes ?? 0;
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

function localDateStartOfDayUtc(date: Date, tzOffsetMinutes: number | null | undefined): Date {
  const key = localDateKey(date, tzOffsetMinutes);
  return new Date(`${key}T00:00:00.000Z`);
}

async function awardBadgeIfNew(userId: string, badgeCode: string, mealRecordId?: string) {
  const badge = await prisma.badge.findUnique({ where: { code: badgeCode } });
  if (!badge) return; // seed 尚未建立這個徽章，安全地跳過

  const existing = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId: badge.id } },
  });
  if (existing) return;

  await prisma.userBadge.create({
    data: { userId, badgeId: badge.id, mealRecordId },
  });
  await prisma.pointsLedgerEntry.create({
    data: { userId, points: 25, reason: PointsReason.BADGE_AWARDED, mealRecordId },
  });
}

export async function awardPreMealPoints(userId: string, mealRecordId: string) {
  await prisma.pointsLedgerEntry.create({
    data: { userId, points: POINTS.PRE_MEAL_LOGGED, reason: PointsReason.PRE_MEAL_LOGGED, mealRecordId },
  });

  const preMealCount = await prisma.mealRecord.count({ where: { userId } });
  if (preMealCount === 1) {
    await awardBadgeIfNew(userId, "FIRST_MEAL", mealRecordId);
  }
}

/**
 * 一餐完成 (餐後照上傳完畢) 後呼叫：
 * 1. 發放完成點數
 * 2. 更新連續天數 (依裝置時區換算的「當地日期」為單位)，達成里程碑就加碼 + 發徽章
 * 3. 檢查「當天三餐都完成」與「累計完成餐數 / 早餐次數」徽章
 */
export async function handleMealCompleted(params: {
  userId: string;
  mealRecordId: string;
  mealType: string;
  postMealAt: Date;
  tzOffsetMinutes: number | null | undefined;
}) {
  const { userId, mealRecordId, mealType, postMealAt, tzOffsetMinutes } = params;

  await prisma.pointsLedgerEntry.create({
    data: { userId, points: POINTS.POST_MEAL_LOGGED, reason: PointsReason.POST_MEAL_LOGGED, mealRecordId },
  });

  await updateStreak({ userId, mealRecordId, postMealAt, tzOffsetMinutes });
  await checkDailyAllMealsBonus({ userId, mealRecordId, postMealAt, tzOffsetMinutes });
  await checkMealCountBadges(userId, mealRecordId);
  if (mealType === "BREAKFAST") {
    await checkBreakfastBadge(userId, mealRecordId);
  }
}

async function updateStreak(params: {
  userId: string;
  mealRecordId: string;
  postMealAt: Date;
  tzOffsetMinutes: number | null | undefined;
}) {
  const { userId, mealRecordId, postMealAt, tzOffsetMinutes } = params;
  const todayStart = localDateStartOfDayUtc(postMealAt, tzOffsetMinutes);

  const streak = await prisma.userStreak.upsert({
    where: { userId },
    create: { userId, currentStreakDays: 0, longestStreakDays: 0 },
    update: {},
  });

  if (streak.lastActiveDate && streak.lastActiveDate.getTime() === todayStart.getTime()) {
    return; // 今天已經算過streak了，不重複累加
  }

  let nextStreak = 1;
  if (streak.lastActiveDate) {
    const dayDiff = Math.round((todayStart.getTime() - streak.lastActiveDate.getTime()) / 86_400_000);
    if (dayDiff === 1) {
      nextStreak = streak.currentStreakDays + 1;
    } else if (dayDiff <= 0) {
      // 時間比上次紀錄還早 (離線後補傳等情況)，不動 streak，只更新看過的最新日期由呼叫端保證遞增
      return;
    }
    // dayDiff > 1 -> 中斷，nextStreak 重置為 1
  }

  await prisma.userStreak.update({
    where: { userId },
    data: {
      currentStreakDays: nextStreak,
      longestStreakDays: Math.max(nextStreak, streak.longestStreakDays),
      lastActiveDate: todayStart,
    },
  });

  if ((STREAK_MILESTONES as readonly number[]).includes(nextStreak)) {
    await prisma.pointsLedgerEntry.create({
      data: {
        userId,
        points: streakBonusPoints(nextStreak),
        reason: PointsReason.STREAK_MILESTONE,
        mealRecordId,
      },
    });
    await awardBadgeIfNew(userId, `STREAK_${nextStreak}`, mealRecordId);
  }
}

async function checkDailyAllMealsBonus(params: {
  userId: string;
  mealRecordId: string;
  postMealAt: Date;
  tzOffsetMinutes: number | null | undefined;
}) {
  const { userId, mealRecordId, postMealAt, tzOffsetMinutes } = params;
  const dayStart = localDateStartOfDayUtc(postMealAt, tzOffsetMinutes);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const alreadyAwarded = await prisma.pointsLedgerEntry.findFirst({
    where: {
      userId,
      reason: PointsReason.DAILY_ALL_MEALS_BONUS,
      createdAt: { gte: dayStart, lt: dayEnd },
    },
  });
  if (alreadyAwarded) return;

  const completedToday = await prisma.mealRecord.findMany({
    where: {
      userId,
      status: "COMPLETED",
      postMealAt: { gte: dayStart, lt: dayEnd },
      mealType: { in: ["BREAKFAST", "LUNCH", "DINNER"] },
    },
    select: { mealType: true },
    distinct: ["mealType"],
  });

  if (completedToday.length >= 3) {
    await prisma.pointsLedgerEntry.create({
      data: { userId, points: POINTS.DAILY_ALL_MEALS_BONUS, reason: PointsReason.DAILY_ALL_MEALS_BONUS, mealRecordId },
    });
    await awardBadgeIfNew(userId, "PERFECT_DAY", mealRecordId);
  }
}

async function checkMealCountBadges(userId: string, mealRecordId: string) {
  const completedCount = await prisma.mealRecord.count({ where: { userId, status: "COMPLETED" } });
  if ((MEAL_COUNT_MILESTONES as readonly number[]).includes(completedCount)) {
    await awardBadgeIfNew(userId, `MEALS_${completedCount}`, mealRecordId);
  }
}

async function checkBreakfastBadge(userId: string, mealRecordId: string) {
  const breakfastCount = await prisma.mealRecord.count({
    where: { userId, status: "COMPLETED", mealType: "BREAKFAST" },
  });
  if (breakfastCount === BREAKFAST_MILESTONE) {
    await awardBadgeIfNew(userId, "BREAKFAST_10", mealRecordId);
  }
}

export async function getGamificationSummary(userId: string) {
  const [pointsAgg, streak, earnedBadges, allBadges] = await Promise.all([
    prisma.pointsLedgerEntry.aggregate({ where: { userId }, _sum: { points: true } }),
    prisma.userStreak.findUnique({ where: { userId } }),
    prisma.userBadge.findMany({ where: { userId }, include: { badge: true } }),
    prisma.badge.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);

  const earnedBadgeIds = new Set(earnedBadges.map((b) => b.badgeId));

  return {
    totalPoints: pointsAgg._sum.points ?? 0,
    currentStreakDays: streak?.currentStreakDays ?? 0,
    longestStreakDays: streak?.longestStreakDays ?? 0,
    badges: allBadges.map((b) => ({
      code: b.code,
      name: b.name,
      description: b.description,
      iconEmoji: b.iconEmoji,
      earned: earnedBadgeIds.has(b.id),
      earnedAt: earnedBadges.find((eb) => eb.badgeId === b.id)?.earnedAt ?? null,
    })),
  };
}
