import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { CameraCaptureField } from "../components/CameraCaptureField";
import { pickCompletionMessage } from "../content/encouragement";
import type { GamificationSummary, MealRecord } from "../api/types";

const MEAL_TYPE_LABEL: Record<string, string> = {
  BREAKFAST: "早餐",
  LUNCH: "午餐",
  DINNER: "晚餐",
  SNACK: "點心",
};

function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} 分鐘`;
  const h = Math.floor(m / 60);
  return `${h} 小時 ${m % 60} 分鐘`;
}

export function PostMealPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [meal, setMeal] = useState<MealRecord | null>(null);
  const [beforeSummary, setBeforeSummary] = useState<GamificationSummary | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ meal: MealRecord; summary: GamificationSummary; newBadgeCodes: string[] } | null>(
    null
  );

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<{ mealRecord: MealRecord }>(`/meals/${id}`),
      api.get<GamificationSummary>("/gamification/summary"),
    ]).then(([mealData, summary]) => {
      setMeal(mealData.mealRecord);
      setBeforeSummary(summary);
    });
  }, [id]);

  async function submit() {
    if (!file || !capturedAt || !id) {
      setError("請先拍攝餐後照片");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("capturedAt", capturedAt.toISOString());
      form.append("tzOffsetMinutes", String(new Date().getTimezoneOffset()));

      const data = await api.post<{ mealRecord: MealRecord; gamification: GamificationSummary }>(
        `/meals/${id}/post-meal`,
        form
      );

      const earnedBefore = new Set((beforeSummary?.badges ?? []).filter((b) => b.earned).map((b) => b.code));
      const newBadgeCodes = data.gamification.badges.filter((b) => b.earned && !earnedBefore.has(b.code)).map((b) => b.code);

      setResult({ meal: data.mealRecord, summary: data.gamification, newBadgeCodes });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "上傳失敗，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const newBadges = result.summary.badges.filter((b) => result.newBadgeCodes.includes(b.code));
    return (
      <div className="app-shell">
        <div className="page center-col" style={{ justifyContent: "center", minHeight: "100%" }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <h2 style={{ margin: 0 }}>{pickCompletionMessage()}</h2>
          {result.meal.mealDurationSeconds != null && (
            <p style={{ color: "var(--color-text-muted)" }}>
              這一餐花了 {formatDuration(result.meal.mealDurationSeconds)}
            </p>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <span className="pill pill-accent">✨ 共 {result.summary.totalPoints} 點</span>
            <span className="pill pill-primary">🔥 連續 {result.summary.currentStreakDays} 天</span>
          </div>

          {newBadges.length > 0 && (
            <>
              <div className="section-title">獲得新徽章！</div>
              <div className="badge-grid">
                {newBadges.map((b) => (
                  <div key={b.code} className="badge-cell">
                    <span className="badge-emoji">{b.iconEmoji}</span>
                    <span className="badge-name">{b.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => navigate("/")}>
            回到首頁
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="page">
        <h2 style={{ marginBottom: 4 }}>記錄餐後</h2>
        {meal && (
          <p style={{ color: "var(--color-text-muted)", marginTop: 0, fontSize: 14 }}>
            {MEAL_TYPE_LABEL[meal.mealType]} · 餐前照拍攝於 {new Date(meal.preMealAt).toLocaleTimeString("zh-TW")}
          </p>
        )}

        <div className="section-title">餐後照片</div>
        <CameraCaptureField label="餐後照片" onCapture={(f, d) => { setFile(f); setCapturedAt(d); }} />

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={submit} disabled={submitting}>
          {submitting ? "上傳中..." : "完成這一餐"}
        </button>
        <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => navigate(-1)}>
          稍後再拍
        </button>
      </div>
    </div>
  );
}
