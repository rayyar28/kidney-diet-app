import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { CameraCaptureField } from "../components/CameraCaptureField";
import { pickCompletionMessage } from "../content/encouragement";
import { attachPostPhoto, discardFailedMeal, getLocalMeal, loadServerCache } from "../offline/mealStore";
import { syncAndWait } from "../offline/syncEngine";
import { useSyncStore } from "../offline/syncStore";
import { useAuthStore } from "../store/auth";
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

/** 這一頁需要的、關於這筆用餐紀錄的資訊 (可能來自本機，也可能來自伺服器) */
type MealInfo = Pick<MealRecord, "id" | "mealType" | "notes" | "preMealAt">;

interface Result {
  durationSeconds: number;
  /** null = 還沒上傳成功 (離線或太慢)，點數要等連上網路之後才算得出來 */
  summary: GamificationSummary | null;
  newBadgeCodes: string[];
}

export function PostMealPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [meal, setMeal] = useState<MealInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [beforeSummary, setBeforeSummary] = useState<GamificationSummary | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState<Date | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!id || !user) return;
    let cancelled = false;
    (async () => {
      // 先看本機 (離線建立、還沒上傳的紀錄只存在這裡)，沒有再向伺服器要
      const local = await getLocalMeal(id);
      if (cancelled) return;
      if (local && local.userId === user.id) {
        setMeal({ id: local.id, mealType: local.mealType, notes: local.notes, preMealAt: local.preAt });
      } else {
        try {
          const data = await api.get<{ mealRecord: MealRecord }>(`/meals/${id}`);
          if (!cancelled) setMeal(data.mealRecord);
        } catch (err) {
          // 伺服器說「沒有這筆」就是沒有；其他狀況 (沒網路、伺服器暫時掛掉) 改用首頁的快取，
          // 這樣在伺服器上建立、本機還沒有的紀錄，離線時也能補拍餐後照。
          const notFound = err instanceof ApiError && err.status === 404;
          const cached = notFound ? undefined : (await loadServerCache(user.id).catch(() => undefined))?.meals.find((m) => m.id === id);
          if (cached) {
            if (!cancelled) setMeal(cached);
          } else {
            if (!cancelled) {
              setLoadError(notFound ? "找不到這筆用餐紀錄。" : "目前沒有網路，需要連上網路才能載入這筆紀錄。");
            }
            return;
          }
        }
      }
      // 記下「完成前」的徽章狀態，完成後才能算出這次新拿到哪些
      const cached = await loadServerCache(user.id).catch(() => undefined);
      let before = cached?.summary ?? null;
      try {
        before = await api.get<GamificationSummary>("/gamification/summary");
      } catch {
        /* 離線：用快取的 */
      }
      if (!cancelled) setBeforeSummary(before);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user]);

  async function submit() {
    if (!file || !capturedAt || !id || !meal || !user) {
      setError("請先拍攝餐後照片");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved = await attachPostPhoto({ userId: user.id, mealId: id, serverMeal: meal, file, capturedAt });
      const durationSeconds = Math.max(0, Math.round((capturedAt.getTime() - Date.parse(saved.preAt)) / 1000));

      const outcome = await syncAndWait(id);

      if (typeof outcome === "object") {
        // 餐前照還沒上傳成功就失敗了：這不是餐後照的問題，回紀錄頁處理
        const current = await getLocalMeal(id);
        if (current?.pre && !current.pre.synced) {
          setError(`這筆紀錄的餐前照上傳失敗：${outcome.failed}。請到「紀錄」頁處理。`);
          return;
        }
        // 伺服器拒絕了這張餐後照：跟原本一樣留在這頁讓使用者重拍
        await discardFailedMeal(id);
        setFile(null);
        setCapturedAt(null);
        setError(`${outcome.failed}。請重新拍攝。`);
        return;
      }

      if (outcome === "pending") {
        setResult({ durationSeconds, summary: null, newBadgeCodes: [] });
        return;
      }

      const summary = useSyncStore.getState().lastGamification ?? (await api.get<GamificationSummary>("/gamification/summary"));
      const earnedBefore = new Set((beforeSummary?.badges ?? []).filter((b) => b.earned).map((b) => b.code));
      const newBadgeCodes = summary.badges.filter((b) => b.earned && !earnedBefore.has(b.code)).map((b) => b.code);
      setResult({ durationSeconds, summary, newBadgeCodes });
    } catch (err) {
      setError(err instanceof Error ? err.message : "儲存失敗，請再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  if (result) {
    const newBadges = (result.summary?.badges ?? []).filter((b) => result.newBadgeCodes.includes(b.code));
    return (
      <div className="app-shell">
        <div className="page center-col" style={{ justifyContent: "center", minHeight: "100%" }}>
          <div style={{ fontSize: 48 }}>🎉</div>
          <h2 style={{ margin: 0 }}>{pickCompletionMessage()}</h2>
          <p style={{ color: "var(--color-text-muted)" }}>這一餐花了 {formatDuration(result.durationSeconds)}</p>

          {result.summary ? (
            <div style={{ display: "flex", gap: 10 }}>
              <span className="pill pill-accent">✨ 共 {result.summary.totalPoints} 點</span>
              <span className="pill pill-primary">🔥 連續 {result.summary.currentStreakDays} 天</span>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "var(--color-text-muted)", maxWidth: 280 }}>
              餐後照已安全存在手機裡，連上網路後會自動上傳，並幫你算好點數和徽章。
            </p>
          )}

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
        {loadError && <p className="error-text">{loadError}</p>}
        {meal && (
          <p style={{ color: "var(--color-text-muted)", marginTop: 0, fontSize: 14 }}>
            {MEAL_TYPE_LABEL[meal.mealType]} · 餐前照拍攝於 {new Date(meal.preMealAt).toLocaleTimeString("zh-TW")}
          </p>
        )}

        <div className="section-title">餐後照片</div>
        <CameraCaptureField label="餐後照片" onCapture={(f, d) => { setFile(f); setCapturedAt(d); }} />

        {error && <p className="error-text">{error}</p>}

        <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={submit} disabled={submitting || !meal}>
          {submitting ? "儲存中..." : "完成這一餐"}
        </button>
        <button className="btn btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => navigate(-1)}>
          稍後再拍
        </button>
      </div>
    </div>
  );
}
