import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { SyncStatusBar } from "../components/SyncStatusBar";
import { TrialBanner } from "../components/TrialBanner";
import { Toast } from "../components/Toast";
import { useMealViews } from "../offline/useMealViews";
import { useAuthStore } from "../store/auth";
import {
  WEEKDAY_LABELS,
  addMonths,
  dayKey,
  isFutureMonth,
  monthGrid,
  monthLabel,
  summariseByDay,
} from "./historyCalendar";

/**
 * 紀錄頁＝月曆。一個月一眼看完，哪幾天有記錄、哪幾天漏掉一目了然，
 * 這比一長串清單更容易讓病人看見自己的習慣（也跟點數/連續天數的設計呼應）。
 *
 * 只有「有紀錄的日子」才是可以按的按鈕：空白的日子做成純文字，
 * 病人就不會按了半天沒反應，也不會被導到一個空畫面。
 * 按下去進入 /history/YYYY-MM-DD 看那一天每一餐的照片。
 */
export function HistoryPage() {
  const navigate = useNavigate();
  const { meals, loading, offline } = useMealViews();
  const trial = useAuthStore((s) => s.mode === "trial");

  // 只在第一次 render 取一次「今天」：跨午夜時整頁重算沒有意義，反而會閃動
  const today = useMemo(() => new Date(), []);
  const [cursor, setCursor] = useState(() => ({ year: today.getFullYear(), month0: today.getMonth() }));

  const byDay = useMemo(() => summariseByDay(meals), [meals]);
  const cells = useMemo(() => monthGrid(cursor.year, cursor.month0), [cursor]);
  const todayKey = dayKey(today);

  const monthTotal = cells.reduce((sum, c) => (c.inMonth ? sum + (byDay.get(c.key)?.total ?? 0) : sum), 0);
  const next = addMonths(cursor.year, cursor.month0, 1);
  const canGoNext = !isFutureMonth(next.year, next.month0, today);

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">我的紀錄</h1>
          <p className="page-hint">{loading ? "載入中…" : `這個月記錄了 ${monthTotal} 餐`}</p>
        </div>
      </div>

      <div className="page">
        <TrialBanner />
        <SyncStatusBar offline={offline} />

        <div className="cal-header">
          <button
            type="button"
            className="cal-nav"
            aria-label="上個月"
            onClick={() => setCursor(addMonths(cursor.year, cursor.month0, -1))}
          >
            ‹
          </button>
          <span className="cal-month">{monthLabel(cursor.year, cursor.month0)}</span>
          <button
            type="button"
            className="cal-nav"
            aria-label="下個月"
            disabled={!canGoNext}
            onClick={() => setCursor(next)}
          >
            ›
          </button>
        </div>

        <div className="cal-grid cal-weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        <div className="cal-grid cal-days">
          {cells.map((cell) => {
            const s = byDay.get(cell.key);
            const isToday = cell.key === todayKey;
            const classes = ["cal-cell", cell.inMonth ? "" : "cal-out", s ? "cal-has" : "", isToday ? "cal-today" : ""]
              .filter(Boolean)
              .join(" ");

            if (!s) {
              return (
                <span key={cell.key} className={classes}>
                  <span className="cal-day">{cell.date.getDate()}</span>
                </span>
              );
            }
            return (
              <button
                key={cell.key}
                type="button"
                className={classes}
                aria-label={`${cell.date.getMonth() + 1} 月 ${cell.date.getDate()} 日，${s.total} 餐`}
                onClick={() => navigate(`/history/${cell.key}`)}
              >
                <span className="cal-day">{cell.date.getDate()}</span>
                <span className="cal-dots">
                  {/* 一餐一個點，最多四個：格子只有 45px 寬，再多就糊成一團了 */}
                  {s.marks.slice(0, 4).map((mark, i) => (
                    <i key={i} className={`cal-dot cal-${mark}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className="cal-legend">
          <span>
            <i className="cal-dot cal-done" />已完成
          </span>
          <span>
            <i className="cal-dot cal-waiting" />待補餐後照
          </span>
          {/* 試用模式不會上傳，也就不可能有上傳失敗；列出來只會讓試用者困惑 */}
          {!trial && (
            <span>
              <i className="cal-dot cal-failed" />上傳失敗
            </span>
          )}
        </div>

        {!loading && monthTotal === 0 && (
          <p className="page-hint" style={{ textAlign: "center" }}>
            這個月還沒有紀錄，回首頁拍一餐吧！
          </p>
        )}
      </div>

      <Toast />
      <BottomNav />
    </div>
  );
}
