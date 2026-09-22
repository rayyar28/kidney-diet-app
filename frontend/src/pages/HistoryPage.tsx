import { BottomNav } from "../components/BottomNav";
import { AuthedImage } from "../components/AuthedImage";
import { SyncStatusBar } from "../components/SyncStatusBar";
import { Toast } from "../components/Toast";
import { discardFailedMeal, requestRemove, retryFailedMeal } from "../offline/mealStore";
import { requestSync } from "../offline/syncEngine";
import { useMealViews } from "../offline/useMealViews";
import type { MealView } from "../offline/types";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";

const MEAL_TYPE_LABEL: Record<string, string> = {
  BREAKFAST: "早餐",
  LUNCH: "午餐",
  DINNER: "晚餐",
  SNACK: "點心",
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  return `${h} 時 ${m % 60} 分`;
}

/**
 * 優先用本機縮圖 (不需要網路、立刻顯示)，沒有才向伺服器載入。
 * 完全沒有照片時不佔位（例如還沒拍餐後照），避免在窄螢幕上白白吃掉寬度。
 */
function MealPhoto({ thumb, photoId, alt }: { thumb: string | null; photoId?: string; alt: string }) {
  if (thumb) return <img src={thumb} alt={alt} />;
  if (photoId) return <AuthedImage photoId={photoId} alt={alt} />;
  return null;
}

/**
 * 歷史紀錄。這一頁本質上是一份會越來越長的清單，所以是全 App 唯一需要滑動的頁面；
 * 每一列刻意做得矮而字大，一個畫面大約能看到 4~5 筆。
 */
export function HistoryPage() {
  const user = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);
  const { meals, loading, offline } = useMealViews();

  async function handleDelete(meal: MealView) {
    if (!user) return;
    const label = MEAL_TYPE_LABEL[meal.mealType];
    const when = new Date(meal.preMealAt).toLocaleDateString("zh-TW");
    if (!window.confirm(`要刪除「${when} ${label}」這筆紀錄嗎？`)) return;
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
        <h1 className="page-title">我的紀錄</h1>
      </div>

      <div className="page">
        <SyncStatusBar offline={offline} />

        {loading && <p className="page-hint">載入中…</p>}
        {!loading && meals.length === 0 && (
          <p className="page-hint" style={{ textAlign: "center", marginTop: 32 }}>
            還沒有任何紀錄，
            <br />
            回首頁拍下第一餐吧！
          </p>
        )}

        <div className="record-list">
          {meals.map((meal) => {
            const pre = meal.photos?.find((p) => p.phase === "PRE_MEAL");
            const post = meal.photos?.find((p) => p.phase === "POST_MEAL");
            const waiting = meal.status === "AWAITING_POST_PHOTO";
            return (
              <div key={meal.id} className="record">
                <div className="record-thumbs">
                  <MealPhoto thumb={meal.preThumbDataUrl} photoId={pre?.id} alt="餐前" />
                  <MealPhoto thumb={meal.postThumbDataUrl} photoId={post?.id} alt="餐後" />
                </div>

                <div className="record-body">
                  <div className="record-title">{MEAL_TYPE_LABEL[meal.mealType]}</div>
                  <div className="record-meta">
                    {new Date(meal.preMealAt).toLocaleString("zh-TW", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  {meal.status === "COMPLETED" && (
                    <div className="record-meta">吃了 {formatDuration(meal.mealDurationSeconds)}</div>
                  )}
                  {/* 標籤放在自己一行：窄螢幕上跟標題同一行會被擠成一字一行 */}
                  <div className="record-tags">
                    {meal.status === "ABANDONED" && <span className="tag">已放棄</span>}
                    {waiting && <span className="tag tag-waiting">待補餐後照</span>}
                    {meal.sync === "pending" && <span className="tag">☁️ 待上傳</span>}
                    {meal.sync === "failed" && <span className="tag tag-failed">⚠️ 上傳失敗</span>}
                  </div>

                  {meal.sync === "failed" && (
                    <>
                      <p className="error-text" style={{ fontSize: "var(--fs-sm)", marginTop: 6 }}>
                        {meal.failureMessage ?? "上傳失敗"}
                      </p>
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
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
            );
          })}
        </div>
      </div>

      <Toast />
      <BottomNav />
    </div>
  );
}
