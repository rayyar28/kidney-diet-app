import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { BottomNav } from "../components/BottomNav";
import { AuthedImage } from "../components/AuthedImage";
import { useToastStore } from "../store/toast";
import type { MealRecord } from "../api/types";

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

export function HistoryPage() {
  const navigate = useNavigate();
  const showToast = useToastStore((s) => s.show);
  const [items, setItems] = useState<MealRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.get<{ items: MealRecord[] }>("/meals?pageSize=50").then((data) => {
      setItems(data.items);
      setLoading(false);
    });
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  function handleDeleteClick(mealId: string, e: MouseEvent) {
    e.stopPropagation();
    if (confirmingId !== mealId) {
      setConfirmingId(mealId);
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
      confirmTimeoutRef.current = setTimeout(() => setConfirmingId(null), 4000);
      return;
    }
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setConfirmingId(null);
    api
      .delete(`/meals/${mealId}`)
      .then(() => {
        setItems((prev) => prev.filter((m) => m.id !== mealId));
        showToast("已刪除這筆紀錄");
      })
      .catch((err) => {
        showToast(err instanceof ApiError ? err.message : "刪除失敗，請再試一次");
      });
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div style={{ fontSize: 18, fontWeight: 700 }}>我的紀錄</div>
      </div>
      <div className="page">
        {loading && <p style={{ color: "var(--color-text-muted)" }}>載入中...</p>}
        {!loading && items.length === 0 && (
          <p style={{ color: "var(--color-text-muted)", textAlign: "center", marginTop: 40 }}>
            還沒有任何紀錄，去首頁拍下第一餐吧！
          </p>
        )}
        {items.map((meal) => {
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
                  <span className={status.className}>{status.text}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{
                      padding: "4px 10px",
                      fontSize: 12,
                      color: confirmingId === meal.id ? "var(--color-danger)" : "var(--color-text-muted)",
                      fontWeight: confirmingId === meal.id ? 700 : 400,
                    }}
                    onClick={(e) => handleDeleteClick(meal.id, e)}
                  >
                    {confirmingId === meal.id ? "確定刪除？" : "刪除"}
                  </button>
                </div>
              </div>
              <div className="meal-card">
                <div className="meal-photos">
                  {pre && <AuthedImage photoId={pre.id} alt="餐前" />}
                  {post && <AuthedImage photoId={post.id} alt="餐後" />}
                </div>
                <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
                  <div>{new Date(meal.preMealAt).toLocaleString("zh-TW")}</div>
                  <div>用餐時長：{formatDuration(meal.mealDurationSeconds)}</div>
                </div>
              </div>
              {meal.notes && <p style={{ fontSize: 13, marginTop: 8, marginBottom: 0 }}>{meal.notes}</p>}
            </div>
          );
        })}
      </div>
      <BottomNav />
    </div>
  );
}
