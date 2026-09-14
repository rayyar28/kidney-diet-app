import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { BottomNav } from "../components/BottomNav";
import { ElapsedTimer } from "../components/ElapsedTimer";
import { Toast } from "../components/Toast";
import { useToastStore } from "../store/toast";
import { pickEncouragement } from "../content/encouragement";
import type { GamificationSummary, MealRecord } from "../api/types";

const MEAL_TYPE_LABEL: Record<string, string> = {
  BREAKFAST: "早餐",
  LUNCH: "午餐",
  DINNER: "晚餐",
  SNACK: "點心",
};

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);
  const [summary, setSummary] = useState<GamificationSummary | null>(null);
  const [pending, setPending] = useState<MealRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, pendingData] = await Promise.all([
        api.get<GamificationSummary>("/gamification/summary"),
        api.get<{ items: MealRecord[] }>("/meals?status=AWAITING_POST_PHOTO&pageSize=10"),
      ]);
      setSummary(summaryData);
      setPending(pendingData.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function abandon(id: string) {
    await api.patch(`/meals/${id}/abandon`);
    showToast("已放棄這筆紀錄");
    load();
  }

  const encouragement = pickEncouragement(summary?.currentStreakDays ?? 0);
  const recentBadges = (summary?.badges ?? []).filter((b) => b.earned).slice(-4).reverse();

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>哈囉，{user?.displayName ?? "朋友"}</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>今天也要好好吃飯 🍚</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span className="pill pill-accent">✨ {summary?.totalPoints ?? 0}</span>
          <span className="pill pill-primary">
            <span className="streak-flame" style={{ fontSize: 16 }}>
              🔥
            </span>
            {summary?.currentStreakDays ?? 0}
          </span>
        </div>
      </div>

      <div className="page">
        <div className="encouragement-banner">
          <div className="headline">{encouragement.headline}</div>
          <div className="sub">{encouragement.sub}</div>
        </div>

        <button className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => navigate("/new-meal")}>
          📸 開始記錄一餐
        </button>

        {pending.length > 0 && (
          <>
            <div className="section-title">進行中的用餐（{pending.length}）</div>
            {pending.map((meal) => (
              <div key={meal.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span className="tag tag-waiting">{MEAL_TYPE_LABEL[meal.mealType]} · 等待餐後照</span>
                    <div style={{ marginTop: 6, fontSize: 13, color: "var(--color-text-muted)" }}>
                      <ElapsedTimer since={meal.preMealAt} />
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate(`/meal/${meal.id}/post-meal`)}>
                    拍餐後照
                  </button>
                  <button className="btn btn-ghost" onClick={() => abandon(meal.id)}>
                    放棄
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {recentBadges.length > 0 && (
          <>
            <div className="section-title">最新徽章</div>
            <div className="badge-grid">
              {recentBadges.map((b) => (
                <div key={b.code} className="badge-cell">
                  <span className="badge-emoji">{b.iconEmoji}</span>
                  <span className="badge-name">{b.name}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && pending.length === 0 && (
          <p style={{ color: "var(--color-text-muted)", fontSize: 14, marginTop: 20, textAlign: "center" }}>
            目前沒有進行中的用餐紀錄，按上面的按鈕開始新的一餐吧！
          </p>
        )}
      </div>

      <Toast />
      <BottomNav />
    </div>
  );
}
