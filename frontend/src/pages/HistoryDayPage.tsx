import { useNavigate, useParams } from "react-router-dom";
import { AuthedImage } from "../components/AuthedImage";
import { Toast } from "../components/Toast";
import { discardFailedMeal, requestRemove, retryFailedMeal } from "../offline/mealStore";
import { requestSync } from "../offline/syncEngine";
import { useMealViews } from "../offline/useMealViews";
import type { MealView } from "../offline/types";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { dayLabel, mealsOfDay } from "./historyCalendar";

const MEAL_TYPE_LABEL: Record<string, string> = {
  BREAKFAST: "早餐",
  LUNCH: "午餐",
  DINNER: "晚餐",
  SNACK: "點心",
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  return `${h} 時 ${m % 60} 分`;
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

/**
 * 一張照片。優先用本機縮圖：不需要網路、立刻顯示，離線時也看得到。
 * 本機沒有（例如很久以前的紀錄已經被清掉縮圖）才向伺服器要原始檔。
 */
function Photo({ thumb, photoId, label }: { thumb: string | null; photoId?: string; label: string }) {
  return (
    <div className="day-photo">
      {thumb ? (
        <img src={thumb} alt={label} />
      ) : photoId ? (
        <AuthedImage photoId={photoId} alt={label} />
      ) : (
        <div className="day-photo-empty">還沒拍</div>
      )}
      <span className="day-photo-label">{label}</span>
    </div>
  );
}

/**
 * 某一天的所有用餐紀錄，每一餐都把餐前/餐後照片放大顯示。
 * 這一頁本質上是清單，是全 App 少數允許滑動的頁面之一。
 */
export function HistoryDayPage() {
  const { day = "" } = useParams<{ day: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);
  const { meals, loading } = useMealViews();

  const valid = DAY_KEY.test(day);
  const dayMeals = valid ? mealsOfDay(meals, day) : [];

  async function handleDelete(meal: MealView) {
    if (!user) return;
    const label = MEAL_TYPE_LABEL[meal.mealType];
    if (!window.confirm(`要刪除「${dayLabel(day)} ${label}」這筆紀錄嗎？`)) return;
    try {
      // 離線也能刪：畫面上立刻消失，連上網路後才通知伺服器 (跟線上一樣是軟刪除)
      await requestRemove({ userId: user.id, mealId: meal.id, serverMeal: meal });
      showToast("已刪除這筆紀錄");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "刪除失敗，請再試一次");
    }
  }

  async function handleRetry(mealId: string) {
    await retryFailedMeal(mealId);
    void requestSync({ force: true });
    showToast("重新上傳中…");
  }

  async function handleDiscard(mealId: string) {
    if (!window.confirm("要捨棄這筆上傳失敗的紀錄嗎？捨棄後無法復原。")) return;
    await discardFailedMeal(mealId);
    showToast("已捨棄");
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">{valid ? dayLabel(day) : "找不到這一天"}</h1>
          <p className="page-hint">{loading ? "載入中…" : `這一天記錄了 ${dayMeals.length} 餐`}</p>
        </div>
      </div>

      <div className="page">
        {!loading && dayMeals.length === 0 && (
          <p className="page-hint" style={{ textAlign: "center", marginTop: 24 }}>
            這一天沒有紀錄
          </p>
        )}

        <div className="day-list">
          {dayMeals.map((meal) => {
            const pre = meal.photos?.find((p) => p.phase === "PRE_MEAL");
            const post = meal.photos?.find((p) => p.phase === "POST_MEAL");
            return (
              <div key={meal.id} className="day-meal">
                <div className="day-meal-head">
                  <span className="record-title">{MEAL_TYPE_LABEL[meal.mealType]}</span>
                  <span className="record-meta">{clockTime(meal.preMealAt)}</span>
                  {meal.sync !== "failed" && (
                    <button
                      type="button"
                      className="icon-btn danger"
                      aria-label="刪除"
                      onClick={() => handleDelete(meal)}
                    >
                      🗑️
                    </button>
                  )}
                </div>

                <div className="day-photos">
                  <Photo thumb={meal.preThumbDataUrl} photoId={pre?.id} label="餐前" />
                  <Photo thumb={meal.postThumbDataUrl} photoId={post?.id} label="餐後" />
                </div>

                {meal.status === "COMPLETED" && (
                  <div className="record-meta">吃了 {formatDuration(meal.mealDurationSeconds)}</div>
                )}

                <div className="record-tags">
                  {meal.status === "ABANDONED" && <span className="tag">已放棄</span>}
                  {meal.status === "AWAITING_POST_PHOTO" && <span className="tag tag-waiting">待補餐後照</span>}
                  {meal.sync === "pending" && <span className="tag">☁️ 待上傳</span>}
                  {meal.sync === "failed" && <span className="tag tag-failed">⚠️ 上傳失敗</span>}
                </div>

                {meal.notes && <div className="record-meta">📝 {meal.notes}</div>}

                {meal.status === "AWAITING_POST_PHOTO" && meal.sync !== "failed" && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => navigate(`/meal/${meal.id}/post-meal`)}
                  >
                    📷 補拍餐後照
                  </button>
                )}

                {meal.sync === "failed" && (
                  <>
                    <p className="error-text" style={{ fontSize: "var(--fs-sm)" }}>
                      {meal.failureMessage ?? "上傳失敗"}
                    </p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" className="sync-bar-btn" onClick={() => handleRetry(meal.id)}>
                        重試
                      </button>
                      <button type="button" className="sync-bar-btn" onClick={() => handleDiscard(meal.id)}>
                        捨棄
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="page-footer">
        <button className="btn btn-secondary" onClick={() => navigate("/history")}>
          ← 回到月曆
        </button>
      </div>

      <Toast />
    </div>
  );
}
