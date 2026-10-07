import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LocalMeal, LocalPhotoSlot } from "../offline/types";
import type { GamificationSummary, MealType } from "../api/types";
import { BADGE_CATALOG, POINTS, computeLocalGamification, projectGamification } from "./replay";

/** 台灣時區：JS getTimezoneOffset() 的慣例是「當地時間 = UTC - offset」，所以是 -480 */
const TW = -480;

function slot(capturedAt: string, tzOffsetMinutes = TW): LocalPhotoSlot {
  return {
    capturedAt,
    tzOffsetMinutes,
    capturedOffline: false,
    thumbDataUrl: null,
    file: null,
    synced: false,
  };
}

let seq = 0;
function meal(over: Partial<LocalMeal> & { preAt: string }): LocalMeal {
  return {
    id: `m${++seq}`,
    userId: "trial-local-user",
    mealType: "LUNCH",
    notes: null,
    pre: slot(over.preAt),
    post: null,
    abandon: null,
    remove: null,
    failure: null,
    attempts: 0,
    nextAttemptAt: 0,
    createdAtLocal: over.preAt,
    ...over,
  };
}

/** 一筆完成的紀錄：餐前 preAt、餐後 postAt */
function done(preAt: string, postAt: string, mealType: MealType = "LUNCH", tz = TW): LocalMeal {
  return meal({ preAt, mealType, pre: slot(preAt, tz), post: slot(postAt, tz) });
}

const earnedCodes = (meals: LocalMeal[]) =>
  computeLocalGamification(meals)
    .badges.filter((b) => b.earned)
    .map((b) => b.code);

describe("本機算點數", () => {
  it("沒有任何紀錄 → 全部歸零，13 個徽章都還沒拿到", () => {
    const s = computeLocalGamification([]);
    expect(s.totalPoints).toBe(0);
    expect(s.currentStreakDays).toBe(0);
    expect(s.longestStreakDays).toBe(0);
    expect(s.badges).toHaveLength(13);
    expect(s.badges.every((b) => !b.earned && b.earnedAt === null)).toBe(true);
  });

  it("只拍了餐前照 → 餐前點數 + 第一步徽章，連續天數還是 0", () => {
    const meals = [meal({ preAt: "2026-09-01T04:00:00.000Z" })];
    const s = computeLocalGamification(meals);
    expect(s.totalPoints).toBe(POINTS.PRE_MEAL_LOGGED + POINTS.BADGE_AWARDED);
    expect(s.currentStreakDays).toBe(0);
    expect(earnedCodes(meals)).toEqual(["FIRST_MEAL"]);
  });

  it("完成一餐 → 餐前 + 餐後 + 第一步徽章，連續天數 1", () => {
    const s = computeLocalGamification([done("2026-09-01T04:00:00.000Z", "2026-09-01T04:30:00.000Z")]);
    expect(s.totalPoints).toBe(10 + 15 + 25);
    expect(s.currentStreakDays).toBe(1);
    expect(s.longestStreakDays).toBe(1);
  });

  it("同一天完成早中晚三餐 → 多拿當日全勤獎勵與「完美的一天」", () => {
    const meals = [
      done("2026-09-01T00:00:00.000Z", "2026-09-01T00:30:00.000Z", "BREAKFAST"),
      done("2026-09-01T04:00:00.000Z", "2026-09-01T04:30:00.000Z", "LUNCH"),
      done("2026-09-01T10:00:00.000Z", "2026-09-01T10:30:00.000Z", "DINNER"),
    ];
    const s = computeLocalGamification(meals);
    expect(s.totalPoints).toBe(3 * (10 + 15) + POINTS.DAILY_ALL_MEALS_BONUS + 2 * POINTS.BADGE_AWARDED);
    expect(earnedCodes(meals).sort()).toEqual(["FIRST_MEAL", "PERFECT_DAY"]);
    expect(s.currentStreakDays).toBe(1);
  });

  it("點心不算進當日全勤（後端只看早中晚）", () => {
    const meals = [
      done("2026-09-01T00:00:00.000Z", "2026-09-01T00:30:00.000Z", "BREAKFAST"),
      done("2026-09-01T04:00:00.000Z", "2026-09-01T04:30:00.000Z", "LUNCH"),
      done("2026-09-01T07:00:00.000Z", "2026-09-01T07:30:00.000Z", "SNACK"),
    ];
    expect(earnedCodes(meals)).toEqual(["FIRST_MEAL"]);
  });

  it("連續三天各完成一餐 → 連續天數 3、里程碑加碼 + 徽章", () => {
    const meals = [
      done("2026-09-01T04:00:00.000Z", "2026-09-01T04:30:00.000Z"),
      done("2026-09-02T04:00:00.000Z", "2026-09-02T04:30:00.000Z"),
      done("2026-09-03T04:00:00.000Z", "2026-09-03T04:30:00.000Z"),
    ];
    const s = computeLocalGamification(meals);
    expect(s.currentStreakDays).toBe(3);
    expect(s.longestStreakDays).toBe(3);
    // 3 餐 + 第一步徽章 + 連三天加碼 15 + 連三天徽章
    expect(s.totalPoints).toBe(3 * (10 + 15) + 25 + 15 + 25);
    expect(earnedCodes(meals).sort()).toEqual(["FIRST_MEAL", "STREAK_3"]);
  });

  it("中間斷一天 → 目前連續重新從 1 算，最長連續保留", () => {
    const s = computeLocalGamification([
      done("2026-09-01T04:00:00.000Z", "2026-09-01T04:30:00.000Z"),
      done("2026-09-02T04:00:00.000Z", "2026-09-02T04:30:00.000Z"),
      done("2026-09-04T04:00:00.000Z", "2026-09-04T04:30:00.000Z"),
    ]);
    expect(s.currentStreakDays).toBe(1);
    expect(s.longestStreakDays).toBe(2);
  });

  it("同一天完成兩餐不會讓連續天數加兩次", () => {
    const s = computeLocalGamification([
      done("2026-09-01T00:00:00.000Z", "2026-09-01T00:30:00.000Z", "BREAKFAST"),
      done("2026-09-01T04:00:00.000Z", "2026-09-01T04:30:00.000Z", "LUNCH"),
    ]);
    expect(s.currentStreakDays).toBe(1);
  });

  it("連續天數依裝置當地日期判斷，不是 UTC 日期", () => {
    // 台灣 9/1 23:30 與 9/2 00:30 → 同一個 UTC 日 (9/1)，但是相鄰的兩個「當地日」
    const taipei = [
      done("2026-09-01T15:30:00.000Z", "2026-09-01T15:40:00.000Z", "DINNER", TW),
      done("2026-09-01T16:30:00.000Z", "2026-09-01T16:40:00.000Z", "SNACK", TW),
    ];
    expect(computeLocalGamification(taipei).currentStreakDays).toBe(2);
    // 同樣兩個時間點，裝置若在 UTC 時區就會被算成同一天
    const utc = [
      done("2026-09-01T15:30:00.000Z", "2026-09-01T15:40:00.000Z", "DINNER", 0),
      done("2026-09-01T16:30:00.000Z", "2026-09-01T16:40:00.000Z", "SNACK", 0),
    ];
    expect(computeLocalGamification(utc).currentStreakDays).toBe(1);
  });

  it("放棄的紀錄保留餐前點數，但不算完成", () => {
    const s = computeLocalGamification([
      meal({
        preAt: "2026-09-01T04:00:00.000Z",
        abandon: { requestedAt: "2026-09-01T05:00:00.000Z", synced: false },
      }),
    ]);
    expect(s.totalPoints).toBe(10 + 25);
    expect(s.currentStreakDays).toBe(0);
  });

  it("刪除紀錄不會把已經拿到的點數追討回去（軟刪除語意）", () => {
    const completed = done("2026-09-01T04:00:00.000Z", "2026-09-01T04:30:00.000Z");
    const deleted: LocalMeal = { ...completed, remove: { requestedAt: "2026-09-02T00:00:00.000Z", synced: false } };
    expect(computeLocalGamification([deleted]).totalPoints).toBe(computeLocalGamification([completed]).totalPoints);
  });

  it("累計 10 餐 / 10 次早餐會拿到對應徽章", () => {
    // 全部擠在同一天，避免順便觸發連續天數的徽章
    const sameDay = (i: number, type: MealType) => {
      const hh = String(Math.floor(i / 6)).padStart(2, "0");
      const mm = String((i % 6) * 10).padStart(2, "0");
      return done(`2026-09-01T${hh}:${mm}:00.000Z`, `2026-09-01T${hh}:${mm}:30.000Z`, type);
    };
    const snacks = Array.from({ length: 10 }, (_, i) => sameDay(i, "SNACK"));
    expect(earnedCodes(snacks).sort()).toEqual(["FIRST_MEAL", "MEALS_10"]);

    const breakfasts = Array.from({ length: 10 }, (_, i) => sameDay(i, "BREAKFAST"));
    expect(earnedCodes(breakfasts).sort()).toEqual(["BREAKFAST_10", "FIRST_MEAL", "MEALS_10"]);
  });

  it("結果跟輸入順序無關（重播一定依時間排序）", () => {
    const meals = [
      done("2026-09-01T04:00:00.000Z", "2026-09-01T04:30:00.000Z", "BREAKFAST"),
      done("2026-09-02T04:00:00.000Z", "2026-09-02T04:30:00.000Z", "LUNCH"),
      done("2026-09-03T04:00:00.000Z", "2026-09-03T04:30:00.000Z", "DINNER"),
    ];
    const forward = computeLocalGamification(meals);
    const backward = computeLocalGamification([...meals].reverse());
    expect(backward).toEqual(forward);
  });

  it("伺服器上已有、本機只剩殼的紀錄不會重複給餐前點數", () => {
    // pre 為 null = 這筆的餐前照不是在這支手機拍的，點數早就發過了
    const s = computeLocalGamification([
      meal({ preAt: "2026-09-01T04:00:00.000Z", pre: null, post: slot("2026-09-01T04:30:00.000Z") }),
    ]);
    expect(s.totalPoints).toBe(POINTS.POST_MEAL_LOGGED);
  });
});

/*
 * 這些規則在後端也有一份（見 replay.ts 檔頭）。兩邊對不起來的話，試用版看到的
 * 數字就會跟正式版不一樣，而且不會有任何錯誤訊息——只能靠這兩個檢查擋下來。
 */
describe("規則必須跟後端一致", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  it("徽章目錄跟 prisma/seed.ts 完全一致", () => {
    const seed = read("../../../backend/prisma/seed.ts");
    const pattern = /\{ code: "([A-Z0-9_]+)", name: "([^"]+)", description: "([^"]+)", iconEmoji: "([^"]+)"/g;
    const fromSeed = [...seed.matchAll(pattern)].map((m) => ({
      code: m[1],
      name: m[2],
      description: m[3],
      iconEmoji: m[4],
    }));
    expect(fromSeed.length).toBeGreaterThan(0); // 正則沒對上就不算通過
    expect(BADGE_CATALOG).toEqual(fromSeed);
  });

  it("點數規則跟 gamification.service.ts 一致", () => {
    const service = read("../../../backend/src/services/gamification.service.ts");
    const value = (name: string) => {
      const m = new RegExp(`${name}: (\\d+)`).exec(service);
      expect(m, `後端找不到 ${name}`).not.toBeNull();
      return Number(m![1]);
    };
    expect(POINTS.PRE_MEAL_LOGGED).toBe(value("PRE_MEAL_LOGGED"));
    expect(POINTS.POST_MEAL_LOGGED).toBe(value("POST_MEAL_LOGGED"));
    expect(POINTS.DAILY_ALL_MEALS_BONUS).toBe(value("DAILY_ALL_MEALS_BONUS"));
    // 徽章點數寫在 awardBadgeIfNew 裡
    expect(service).toContain(`points: ${POINTS.BADGE_AWARDED}, reason: PointsReason.BADGE_AWARDED`);
  });
});

/*
 * 正常模式：伺服器算到哪，手機就從那裡接著算還沒上傳的部分。
 *
 * 這一段守的是兩件事：
 *   1. 已經上傳成功的紀錄不能再算一次（否則點數會變成雙倍）
 *   2. 東西全部上傳完之後，手機顯示的數字要正好等於伺服器的數字——
 *      否則病人會看到點數在同步前後跳動，那比離線時看不到更糟
 */
describe("接著伺服器往下算", () => {
  const SERVER_EARNED_AT = "2026-09-01T00:00:00.000Z";

  interface BaseOver {
    totalPoints?: number;
    currentStreakDays?: number;
    longestStreakDays?: number;
    earned?: string[];
    lastActiveDateKey?: string | null;
    completedMealCount?: number;
    breakfastCompletedCount?: number;
    coreMealTypesByDay?: Record<string, string[]>;
  }

  /** 伺服器回傳的摘要（含重播基準） */
  function server(over: BaseOver = {}): GamificationSummary {
    const earnedSet = new Set(over.earned ?? []);
    return {
      totalPoints: over.totalPoints ?? 0,
      currentStreakDays: over.currentStreakDays ?? 0,
      longestStreakDays: over.longestStreakDays ?? 0,
      badges: BADGE_CATALOG.map((b) => ({
        ...b,
        earned: earnedSet.has(b.code),
        earnedAt: earnedSet.has(b.code) ? SERVER_EARNED_AT : null,
      })),
      replayBase: {
        lastActiveDateKey: over.lastActiveDateKey ?? null,
        completedMealCount: over.completedMealCount ?? 0,
        breakfastCompletedCount: over.breakfastCompletedCount ?? 0,
        coreMealTypesByDay: over.coreMealTypesByDay ?? {},
      },
    };
  }

  /** 已經上傳成功的紀錄（伺服器已經算過了） */
  function uploaded(m: LocalMeal): LocalMeal {
    return {
      ...m,
      pre: m.pre ? { ...m.pre, synced: true } : null,
      post: m.post ? { ...m.post, synced: true } : null,
    };
  }

  const codesOf = (s: GamificationSummary) => s.badges.filter((b) => b.earned).map((b) => b.code);

  it("已經上傳成功的紀錄不會被再算一次", () => {
    const base = server({ totalPoints: 500, completedMealCount: 20, lastActiveDateKey: "2026-09-02" });
    const s = projectGamification(base, [uploaded(done("2026-09-02T03:00:00.000Z", "2026-09-02T04:00:00.000Z"))]);
    expect(s.totalPoints).toBe(500);
  });

  it("全部上傳完之後，顯示的數字正好等於伺服器的數字", () => {
    const base = server({
      totalPoints: 777,
      currentStreakDays: 3,
      longestStreakDays: 11,
      earned: ["FIRST_MEAL", "STREAK_3"],
      completedMealCount: 30,
      breakfastCompletedCount: 8,
      lastActiveDateKey: "2026-09-05",
      coreMealTypesByDay: { "2026-09-05": ["BREAKFAST", "LUNCH"] },
    });
    const allUploaded = [
      uploaded(done("2026-09-05T00:00:00.000Z", "2026-09-05T01:00:00.000Z", "BREAKFAST")),
      uploaded(done("2026-09-05T04:00:00.000Z", "2026-09-05T05:00:00.000Z", "LUNCH")),
      uploaded(meal({ preAt: "2026-09-05T10:00:00.000Z" })),
    ];
    const s = projectGamification(base, allUploaded);
    expect(s.totalPoints).toBe(777);
    expect(s.currentStreakDays).toBe(3);
    expect(s.longestStreakDays).toBe(11);
    expect(codesOf(s)).toEqual(["FIRST_MEAL", "STREAK_3"]);
  });

  it("離線完成一餐 → 伺服器點數 + 餐前餐後，連續天數接著加", () => {
    const base = server({
      totalPoints: 500,
      currentStreakDays: 4,
      longestStreakDays: 9,
      earned: ["FIRST_MEAL", "STREAK_3", "MEALS_10"],
      completedMealCount: 20,
      lastActiveDateKey: "2026-09-02",
    });
    const s = projectGamification(base, [done("2026-09-03T03:00:00.000Z", "2026-09-03T04:00:00.000Z")]);
    expect(s.totalPoints).toBe(500 + POINTS.PRE_MEAL_LOGGED + POINTS.POST_MEAL_LOGGED);
    expect(s.currentStreakDays).toBe(5);
    expect(s.longestStreakDays).toBe(9);
  });

  it("離線太久中斷了 → 連續天數重新從 1 算，最長連續不受影響", () => {
    const base = server({ currentStreakDays: 4, longestStreakDays: 9, lastActiveDateKey: "2026-09-01" });
    const s = projectGamification(base, [done("2026-09-05T03:00:00.000Z", "2026-09-05T04:00:00.000Z")]);
    expect(s.currentStreakDays).toBe(1);
    expect(s.longestStreakDays).toBe(9);
  });

  it("伺服器今天已經算過了，同一天再完成一餐不會讓連續天數加兩次", () => {
    const base = server({ currentStreakDays: 4, longestStreakDays: 4, lastActiveDateKey: "2026-09-03" });
    const s = projectGamification(base, [done("2026-09-03T09:00:00.000Z", "2026-09-03T10:00:00.000Z")]);
    expect(s.currentStreakDays).toBe(4);
  });

  it("伺服器已經發過的徽章不會再發一次（也不會多給 25 點）", () => {
    const base = server({ totalPoints: 100, earned: ["FIRST_MEAL"] });
    const s = projectGamification(base, [meal({ preAt: "2026-09-03T03:00:00.000Z" })]);
    expect(s.totalPoints).toBe(100 + POINTS.PRE_MEAL_LOGGED);
    // 取得時間要保留伺服器那一份，不能被改成今天
    expect(s.badges.find((b) => b.code === "FIRST_MEAL")!.earnedAt).toBe(SERVER_EARNED_AT);
  });

  it("伺服器已有早午餐、手機補上晚餐 → 當日全勤獎勵與徽章在離線時就看得到", () => {
    const base = server({
      totalPoints: 50,
      currentStreakDays: 1,
      longestStreakDays: 1,
      earned: ["FIRST_MEAL"],
      completedMealCount: 2,
      lastActiveDateKey: "2026-09-03",
      coreMealTypesByDay: { "2026-09-03": ["BREAKFAST", "LUNCH"] },
    });
    const s = projectGamification(base, [done("2026-09-03T10:00:00.000Z", "2026-09-03T11:00:00.000Z", "DINNER")]);
    expect(s.totalPoints).toBe(
      50 + POINTS.PRE_MEAL_LOGGED + POINTS.POST_MEAL_LOGGED + POINTS.DAILY_ALL_MEALS_BONUS + POINTS.BADGE_AWARDED
    );
    expect(codesOf(s)).toContain("PERFECT_DAY");
  });

  it("伺服器那天三餐都有了 → 不會再發第二次當日全勤", () => {
    const base = server({
      totalPoints: 200,
      currentStreakDays: 1,
      longestStreakDays: 1,
      earned: ["FIRST_MEAL", "PERFECT_DAY"],
      completedMealCount: 3,
      lastActiveDateKey: "2026-09-03",
      coreMealTypesByDay: { "2026-09-03": ["BREAKFAST", "LUNCH", "DINNER"] },
    });
    const s = projectGamification(base, [done("2026-09-03T12:00:00.000Z", "2026-09-03T13:00:00.000Z", "LUNCH")]);
    expect(s.totalPoints).toBe(200 + POINTS.PRE_MEAL_LOGGED + POINTS.POST_MEAL_LOGGED);
  });

  it("累計餐數接著伺服器算，第 10 餐的徽章在離線時就拿到", () => {
    const base = server({
      currentStreakDays: 1,
      longestStreakDays: 1,
      completedMealCount: 9,
      lastActiveDateKey: "2026-09-03",
    });
    const s = projectGamification(base, [done("2026-09-03T09:00:00.000Z", "2026-09-03T10:00:00.000Z")]);
    expect(codesOf(s)).toContain("MEALS_10");
  });

  it("早餐次數也接著伺服器算", () => {
    const base = server({
      currentStreakDays: 1,
      longestStreakDays: 1,
      completedMealCount: 20,
      breakfastCompletedCount: 9,
      lastActiveDateKey: "2026-09-03",
    });
    const s = projectGamification(base, [done("2026-09-03T00:00:00.000Z", "2026-09-03T01:00:00.000Z", "BREAKFAST")]);
    expect(codesOf(s)).toContain("BREAKFAST_10");
  });

  it("舊版快取沒有重播基準時，點數照算但連續天數不會變少", () => {
    // 這個版本之前存下來的快取沒有 replayBase：不知道最後活躍是哪一天，
    // 硬算下去會把連續天數重設成 1，病人會看到數字倒退。
    const legacy: GamificationSummary = {
      totalPoints: 300,
      currentStreakDays: 6,
      longestStreakDays: 6,
      badges: BADGE_CATALOG.map((b) => ({ ...b, earned: false, earnedAt: null })),
    };
    const s = projectGamification(legacy, [done("2026-09-03T03:00:00.000Z", "2026-09-03T04:00:00.000Z")]);
    expect(s.currentStreakDays).toBe(6);
    expect(s.longestStreakDays).toBe(6);
    expect(s.totalPoints).toBe(300 + POINTS.PRE_MEAL_LOGGED + POINTS.POST_MEAL_LOGGED + POINTS.BADGE_AWARDED);
  });

  it("徽章的名稱與說明用伺服器給的，改文案不必重新打包 App", () => {
    const base = server();
    base.badges[0] = { ...base.badges[0]!, name: "伺服器改過的名稱" };
    const s = projectGamification(base, []);
    expect(s.badges[0]!.name).toBe("伺服器改過的名稱");
    expect(s.badges).toHaveLength(BADGE_CATALOG.length);
  });

  it("全新安裝又連不上伺服器 → 只算得出本機這幾餐，但不會是 0", () => {
    const s = projectGamification(null, [done("2026-09-03T03:00:00.000Z", "2026-09-03T04:00:00.000Z")]);
    expect(s.totalPoints).toBe(POINTS.PRE_MEAL_LOGGED + POINTS.POST_MEAL_LOGGED + POINTS.BADGE_AWARDED);
    expect(s.currentStreakDays).toBe(1);
  });
});
