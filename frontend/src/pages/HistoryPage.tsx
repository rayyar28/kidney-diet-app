import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
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

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  COMPLETED: { text: "已完成", className: "tag" },
  AWAITING_POST_PHOTO: { text: "等待餐後照", className: "tag tag-waiting" },
  ABANDONED: { text: "已放棄", className: "tag" },
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  return `${h} 時 ${m % 60} 分`;
}

/** 優先用本機縮圖 (不需要網路、立刻顯示)，沒有才向伺服器載入 */
function MealPhoto({ thumb, photoId, alt }: { thumb: string | null; photoId?: string; alt: string }) {
  if (thumb) return <img src={thumb} alt={alt} />;
  if (photoId) return <AuthedImage photoId={photoId} alt={alt} />;
  return null;
}

export function HistoryPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);
  const { meals, loading, offline } = useMealViews();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    },
    []
  );

  async function handleDeleteClick(meal: MealView, e: MouseEvent) {
    e.stopPropagation();
    if (confirmingId !== meal.id) {
      setConfirmingId(meal.id);
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = setTimeout(() => setConfirmingId(null), 4000);
      return;
    }
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setConfirmingId(null);
    if (!user) return;
    try {
      // 離線也能刪：畫面上立刻消失，連上網路後才通知伺服器 (跟線上一樣是軟刪除)
      await requestRemove({ userId: user.id, mealId: meal.id, serverMeal: meal });
      showToast("已刪除這筆紀錄");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "刪除失敗，請再試一次");
    }
  }

  async function handleRetry(mealId: string, e: MouseEvent) {
    e.stopPropagation();
    await retryFailedMeal(mealId);
    void requestSync({ force: true });
  }

  async function handleDiscard(mealId: string, e: MouseEvent) {
    e.stopPropagation();
    if (!window.confirm("確定要捨棄這筆上傳失敗的紀錄嗎？捨棄後無法復原。")) return;
    await discardFailedMeal(mealId);
    showToast("已捨棄");
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div style={{ fontSize: 18, fontWeight: 700 }}>我的紀錄</div>
      </div>
      <div className="page">
        <SyncStatusBar offline={offline} />
        {loading && <p style={{ color: "var(--color-text-muted)" }}>載入中...</p>}
        {!loading && meals.length === 0 && (
          <p style={{ color: "var(--color-text-muted)", textAlign: "center", marginTop: 40 }}>
            還沒有任何紀錄，去首頁拍下第一餐吧！
          </p>
        )}
        {meals.map((meal) => {
          const pre = meal.photos?.find((p) => p.phase === "PRE_MEAL");
          const post = meal.photos?.find((p) => p.phase === "POST_MEAL");
          const status = STATUS_LABEL[meal.status];
          return (
            <div
              key={meal.id}
              className="card"
              style={{ marginBottom: 10, cursor: meal.status === "AWAITING_POST_PHOTO" ? "pointer" : "default" }}
              onClick={() => meal.status === "AWAITING_POST_PHOTO" && navigate(`/meal/${meal.id}/post-meal`)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontWeight: 700 }}>{MEAL_TYPE_LABEL[meal.mealType]}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {meal.sync === "pending" && <span className="tag">☁️ 待上傳</span>}
                  {meal.sync === "failed" && <span className="tag tag-failed">⚠️ 上傳失敗</span>}
                  <span className={status.className}>{status.text}</span>
                  {meal.sync !== "failed" && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{
                        padding: "4px 10px",
                        fontSize: 12,
                        color: confirmingId === meal.id ? "var(--color-danger)" : "var(--color-text-muted)",
                        fontWeight: confirmingId === meal.id ? 700 : 400,
                      }}
                      onClick={(e) => handleDeleteClick(meal, e)}
                    >
                      {confirmingId === meal.id ? "確定刪除？" : "刪除"}
                    </button>
                  )}
                </div>
              </div>
              <div className="meal-card">
                <div className="meal-photos">
                  <MealPhoto thumb={meal.preThumbDataUrl} photoId={pre?.id} alt="餐前" />
                  <MealPhoto thumb={meal.postThumbDataUrl} photoId={post?.id} alt="餐後" />
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  <div>{new Date(meal.preMealAt).toLocaleString("zh-TW")}</div>
                  <div>用餐時長：{formatDuration(meal.mealDurationSeconds)}</div>
                </div>
              </div>
              {meal.notes && <p style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>{meal.notes}</p>}
              {meal.sync === "failed" && (
                <div style={{ marginTop: 10 }}>
                  <p className="error-text" style={{ marginTop: 0 }}>
                    {meal.failureMessage ?? "上傳失敗"}
                  </p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="sync-bar-btn" onClick={(e) => handleRetry(meal.id, e)}>
                      重試上傳
                    </button>
                    <button type="button" className="sync-bar-btn" onClick={(e) => handleDiscard(meal.id, e)}>
                      捨棄這筆
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Toast />
      <BottomNav />
    </div>
  );
}
