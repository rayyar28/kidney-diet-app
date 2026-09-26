import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LocalMeal, LocalPhotoSlot } from "../offline/types";
import type { MealType } from "../api/types";
import { BADGE_CATALOG, POINTS, computeLocalGamification } from "./gamification";

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
 * 這些規則在後端也有一份（見 gamification.ts 檔頭）。兩邊對不起來的話，試用版看到的
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
