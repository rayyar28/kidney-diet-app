import { describe, expect, it } from "vitest";
import type { MealView } from "../offline/types";
import type { MealType } from "../api/types";
import {
  addMonths,
  dateOfDayKey,
  dayKey,
  dayKeyOfIso,
  dayLabel,
  isFutureMonth,
  markOf,
  mealsOfDay,
  monthGrid,
  monthLabel,
  summariseByDay,
} from "./historyCalendar";

function view(over: Partial<MealView> & { preMealAt: string }): MealView {
  return {
    id: over.id ?? `m-${over.preMealAt}`,
    mealType: "LUNCH" as MealType,
    status: "COMPLETED",
    postMealAt: null,
    mealDurationSeconds: null,
    notes: null,
    createdAt: over.preMealAt,
    sync: "synced",
    failureMessage: null,
    preThumbDataUrl: null,
    postThumbDataUrl: null,
    ...over,
  };
}

/** 用當地時間的年月日組出 ISO，避免測試被執行機器的時區影響 */
const localIso = (y: number, m: number, d: number, hh = 12, mm = 0) =>
  new Date(y, m - 1, d, hh, mm).toISOString();

describe("日期換算", () => {
  it("dayKey 用裝置當地時區，不是 UTC", () => {
    // 當地時間的 23:30 不論時區都應該算成當天
    const late = new Date(2026, 8, 26, 23, 30);
    expect(dayKey(late)).toBe("2026-09-26");
    // 當地時間 00:30 算成隔天
    const early = new Date(2026, 8, 27, 0, 30);
    expect(dayKey(early)).toBe("2026-09-27");
  });

  it("dayKeyOfIso 跟 dayKey 一致", () => {
    const iso = localIso(2026, 9, 26, 23, 30);
    expect(dayKeyOfIso(iso)).toBe("2026-09-26");
  });

  it("dateOfDayKey 是 dayKey 的反函式", () => {
    expect(dayKey(dateOfDayKey("2026-02-29"))).toBe("2026-03-01"); // 2026 不是閏年，會滾到 3/1
    expect(dayKey(dateOfDayKey("2026-09-26"))).toBe("2026-09-26");
  });

  it("dayLabel 顯示月日與星期", () => {
    expect(dayLabel("2026-09-26")).toBe("9 月 26 日（週六）");
  });
});

describe("月曆格子", () => {
  const months: Array<[number, number]> = [
    [2026, 0], // 1 月
    [2026, 1], // 2 月（28 天）
    [2026, 8], // 9 月
    [2024, 1], // 閏年 2 月
    [2026, 11], // 12 月（跨年）
  ];

  it("一定是整週：第一格是星期日、最後一格是星期六、長度是 7 的倍數", () => {
    for (const [y, m] of months) {
      const cells = monthGrid(y, m);
      expect(cells.length % 7, `${y}/${m + 1}`).toBe(0);
      expect(cells[0]!.date.getDay(), `${y}/${m + 1} 第一格`).toBe(0);
      expect(cells[cells.length - 1]!.date.getDay(), `${y}/${m + 1} 最後一格`).toBe(6);
    }
  });

  it("該月每一天都在格子裡，而且只出現一次", () => {
    for (const [y, m] of months) {
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const inMonth = monthGrid(y, m).filter((c) => c.inMonth);
      expect(inMonth.length, `${y}/${m + 1}`).toBe(daysInMonth);
      expect(new Set(inMonth.map((c) => c.key)).size).toBe(daysInMonth);
      expect(inMonth[0]!.date.getDate()).toBe(1);
      expect(inMonth[inMonth.length - 1]!.date.getDate()).toBe(daysInMonth);
    }
  });

  it("頭尾補的是上個月/下個月的日期，inMonth 為 false", () => {
    const cells = monthGrid(2026, 8); // 2026/9/1 是星期二 → 前面補 8/30、8/31
    expect(cells[0]!.key).toBe("2026-08-30");
    expect(cells[0]!.inMonth).toBe(false);
    expect(cells[2]!.key).toBe("2026-09-01");
    expect(cells[2]!.inMonth).toBe(true);
  });

  it("2 月剛好整週時不會多補一整排空白", () => {
    // 2026/2/1 是星期日、2/28 是星期六 → 剛好 4 週
    const cells = monthGrid(2026, 1);
    expect(cells).toHaveLength(28);
    expect(cells.every((c) => c.inMonth)).toBe(true);
  });

  it("addMonths 跨年正確", () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(addMonths(2026, 8, 0)).toEqual({ year: 2026, month0: 8 });
  });

  it("isFutureMonth 以「月」為單位比較", () => {
    const now = new Date(2026, 8, 26);
    expect(isFutureMonth(2026, 8, now)).toBe(false); // 本月
    expect(isFutureMonth(2026, 7, now)).toBe(false); // 上個月
    expect(isFutureMonth(2026, 9, now)).toBe(true); // 下個月
    expect(isFutureMonth(2027, 0, now)).toBe(true);
    expect(isFutureMonth(2025, 11, now)).toBe(false);
  });

  it("monthLabel", () => {
    expect(monthLabel(2026, 8)).toBe("2026 年 9 月");
  });
});

describe("依天分組", () => {
  const meals = [
    view({ id: "a", preMealAt: localIso(2026, 9, 26, 8), status: "COMPLETED" }),
    view({ id: "b", preMealAt: localIso(2026, 9, 26, 12), status: "AWAITING_POST_PHOTO" }),
    view({ id: "c", preMealAt: localIso(2026, 9, 26, 18), status: "ABANDONED" }),
    view({ id: "d", preMealAt: localIso(2026, 9, 25, 12), status: "COMPLETED", sync: "failed" }),
  ];

  it("每一天各種狀態分別計數", () => {
    const byDay = summariseByDay(meals);
    expect(byDay.get("2026-09-26")).toMatchObject({ total: 3, completed: 1, waiting: 1, abandoned: 1, failed: 0 });
    expect(byDay.get("2026-09-25")).toMatchObject({ total: 1, completed: 1, waiting: 0, abandoned: 0, failed: 1 });
    expect(byDay.has("2026-09-24")).toBe(false);
  });

  it("marks 是一餐一個，不會因為「失敗的已完成紀錄」被算兩次", () => {
    // d 同時是 COMPLETED 與 failed：計數各加一次，但只該有一個小圓點
    const s = summariseByDay(meals).get("2026-09-25")!;
    expect(s.completed + s.failed).toBe(2);
    expect(s.marks).toEqual(["failed"]);
    expect(s.marks).toHaveLength(s.total);
  });

  it("marks 依優先順序排：要處理的排前面", () => {
    const s = summariseByDay(meals).get("2026-09-26")!;
    expect(s.marks).toEqual(["waiting", "done", "gone"]);
  });

  it("markOf：上傳失敗優先於用餐狀態", () => {
    expect(markOf(view({ preMealAt: localIso(2026, 9, 1), status: "COMPLETED" }))).toBe("done");
    expect(markOf(view({ preMealAt: localIso(2026, 9, 1), status: "AWAITING_POST_PHOTO" }))).toBe("waiting");
    expect(markOf(view({ preMealAt: localIso(2026, 9, 1), status: "ABANDONED" }))).toBe("gone");
    expect(markOf(view({ preMealAt: localIso(2026, 9, 1), status: "AWAITING_POST_PHOTO", sync: "failed" }))).toBe(
      "failed"
    );
  });

  it("沒有紀錄時是空的 Map", () => {
    expect(summariseByDay([]).size).toBe(0);
  });

  it("mealsOfDay 只取那一天，並依時間由早到晚", () => {
    const day = mealsOfDay(meals, "2026-09-26");
    expect(day.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("跨日的午夜紀錄會分到當地日期那一天", () => {
    const beforeMidnight = view({ id: "late", preMealAt: localIso(2026, 9, 26, 23, 50) });
    const afterMidnight = view({ id: "early", preMealAt: localIso(2026, 9, 27, 0, 10) });
    const byDay = summariseByDay([beforeMidnight, afterMidnight]);
    expect(byDay.get("2026-09-26")?.total).toBe(1);
    expect(byDay.get("2026-09-27")?.total).toBe(1);
  });
});
