import type { MealView } from "../offline/types";

/*
 * 月曆版紀錄頁的純函式。不碰畫面、不碰資料庫，方便完整測試。
 *
 * 日期一律用「裝置當地時區」計算：病人看到的 9 月 26 日就是他手機上的 9 月 26 日。
 * （後端算連續天數時用的是拍照當下回報的時區偏移，那是為了讓補傳的資料也能還原成
 *  當時的當地日期；這裡是「現在這支手機要怎麼顯示」，兩者目的不同。）
 */

/** 裝置當地時區的日期字串 YYYY-MM-DD */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dayKeyOfIso(iso: string): string {
  return dayKey(new Date(iso));
}

/** 把 YYYY-MM-DD 還原成當地時間的那一天零點 */
export function dateOfDayKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** 月曆格子裡「一餐一個小圓點」的顏色。順序就是優先順序：要處理的事情排前面。 */
export type DayMark = "failed" | "waiting" | "done" | "gone";

const MARK_ORDER: Record<DayMark, number> = { failed: 0, waiting: 1, done: 2, gone: 3 };

export function markOf(meal: MealView): DayMark {
  if (meal.sync === "failed") return "failed";
  if (meal.status === "AWAITING_POST_PHOTO") return "waiting";
  if (meal.status === "ABANDONED") return "gone";
  return "done";
}

export interface DaySummary {
  /** 這一天總共有幾筆紀錄 */
  total: number;
  completed: number;
  /** 還沒補餐後照 */
  waiting: number;
  abandoned: number;
  /** 上傳失敗，需要使用者處理 */
  failed: number;
  /**
   * 一餐一個標記，已依優先順序排好。跟上面的計數不同：一筆「上傳失敗的已完成紀錄」
   * 在 failed 和 completed 各算一次，但在這裡只會有一個標記，所以 marks.length === total。
   */
  marks: DayMark[];
}

/** 依「餐前照拍攝日」把紀錄分到各天 */
export function summariseByDay(meals: MealView[]): Map<string, DaySummary> {
  const out = new Map<string, DaySummary>();
  for (const meal of meals) {
    const key = dayKeyOfIso(meal.preMealAt);
    const s = out.get(key) ?? { total: 0, completed: 0, waiting: 0, abandoned: 0, failed: 0, marks: [] };
    s.total += 1;
    if (meal.sync === "failed") s.failed += 1;
    if (meal.status === "COMPLETED") s.completed += 1;
    else if (meal.status === "AWAITING_POST_PHOTO") s.waiting += 1;
    else if (meal.status === "ABANDONED") s.abandoned += 1;
    s.marks.push(markOf(meal));
    out.set(key, s);
  }
  for (const s of out.values()) s.marks.sort((a, b) => MARK_ORDER[a] - MARK_ORDER[b]);
  return out;
}

/** 某一天的紀錄，依用餐時間由早到晚（跟月曆的閱讀方向一致） */
export function mealsOfDay(meals: MealView[], key: string): MealView[] {
  return meals
    .filter((m) => dayKeyOfIso(m.preMealAt) === key)
    .sort((a, b) => Date.parse(a.preMealAt) - Date.parse(b.preMealAt));
}

export interface MonthCell {
  date: Date;
  key: string;
  /** false = 補在頭尾的上/下個月日期，畫面上要變淡 */
  inMonth: boolean;
}

/**
 * 產生一個月的月曆格子：從該月 1 號所在那週的星期日開始，到月底所在那週的星期六結束。
 * 長度一定是 7 的倍數（28、35 或 42），直接餵給 7 欄的 grid。
 */
export function monthGrid(year: number, month0: number): MonthCell[] {
  const first = new Date(year, month0, 1);
  const start = new Date(year, month0, 1 - first.getDay());
  const last = new Date(year, month0 + 1, 0);
  const end = new Date(year, month0 + 1, 0 + (6 - last.getDay()));

  const cells: MonthCell[] = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    cells.push({ date, key: dayKey(date), inMonth: date.getMonth() === month0 });
  }
  return cells;
}

export function addMonths(year: number, month0: number, delta: number): { year: number; month0: number } {
  const d = new Date(year, month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

/** 這個月是不是已經超過今天所在的月份（未來的月份不給翻過去） */
export function isFutureMonth(year: number, month0: number, now = new Date()): boolean {
  return year * 12 + month0 > now.getFullYear() * 12 + now.getMonth();
}

export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export function monthLabel(year: number, month0: number): string {
  return `${year} 年 ${month0 + 1} 月`;
}

export function dayLabel(key: string): string {
  const d = dateOfDayKey(key);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日（週${WEEKDAY_LABELS[d.getDay()]}）`;
}
