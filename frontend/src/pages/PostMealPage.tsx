import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { CameraCaptureField } from "../components/CameraCaptureField";
import { pickCompletionMessage } from "../content/encouragement";
import { attachPostPhoto, discardFailedMeal, getLocalMeal, listLocalMeals, loadServerCache } from "../offline/mealStore";
import { syncAndWait } from "../offline/syncEngine";
import { useSyncStore } from "../offline/syncStore";
import { useAuthStore } from "../store/auth";
import { computeLocalGamification } from "../trial/gamification";
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

/** 這一餐讓病人「新拿到」哪些徽章：完成前沒有、完成後有的 */
function newBadgesSince(before: GamificationSummary | null, after: GamificationSummary): string[] {
  const earnedBefore = new Set((before?.badges ?? []).filter((b) => b.earned).map((b) => b.code));
  return after.badges.filter((b) => b.earned && !earnedBefore.has(b.code)).map((b) => b.code);
}

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
  const trial = useAuthStore((s) => s.mode === "trial");
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
      } else if (trial) {
        // 試用模式的紀錄只可能在本機，本機沒有就是真的沒有
        setLoadError("找不到這筆用餐紀錄");
        return;
      } else {
        try {
          const data = await api.get<{ mealRecord: MealRecord }>(`/meals/${id}`);
          if (!cancelled) setMeal(data.mealRecord);
        } catch (err) {
          // 伺服器說「沒有這筆」就是沒有；其他狀況 (沒網路、伺服器暫時掛掉) 改用首頁的快取，
          // 這樣在伺服器上建立、本機還沒有的紀錄，離線時也能補拍餐後照。
          const notFound = err instanceof ApiError && err.status === 404;
          const cached = notFound
            ? undefined
            : (await loadServerCache(user.id).catch(() => undefined))?.meals.find((m) => m.id === id);
          if (cached) {
            if (!cancelled) setMeal(cached);
          } else {
            if (!cancelled) {
              setLoadError(notFound ? "找不到這筆用餐紀錄" : "目前沒有網路，請連上網路再試");
            }
            return;
          }
        }
      }
      // 記下「完成前」的徽章狀態，完成後才能算出這次新拿到哪些
      if (trial) {
        const locals = await listLocalMeals(user.id);
        if (!cancelled) setBeforeSummary(computeLocalGamification(locals));
        return;
      }
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
  }, [id, user, trial]);

  async function submit() {
    if (!file || !capturedAt || !id || !meal || !user) {
      setError("請先拍一張餐後照片");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const saved = await attachPostPhoto({ userId: user.id, mealId: id, serverMeal: meal, file, capturedAt });
      const durationSeconds = Math.max(0, Math.round((capturedAt.getTime() - Date.parse(saved.preAt)) / 1000));

      // 試用模式沒有伺服器：點數/徽章在本機用同一套規則算，立刻顯示完整的慶祝畫面
      if (trial) {
        const summary = computeLocalGamification(await listLocalMeals(user.id));
        setResult({ durationSeconds, summary, newBadgeCodes: newBadgesSince(beforeSummary, summary) });
        return;
      }

      const outcome = await syncAndWait(id);

      if (typeof outcome === "object") {
        // 餐前照還沒上傳成功就失敗了：這不是餐後照的問題，回紀錄頁處理
        const current = await getLocalMeal(id);
        if (current?.pre && !current.pre.synced) {
          setError(`這筆的餐前照上傳失敗：${outcome.failed}。請到「紀錄」處理`);
          return;
        }
        // 伺服器拒絕了這張餐後照：留在這頁讓使用者重拍
        await discardFailedMeal(id);
        setFile(null);
        setCapturedAt(null);
        setError(`${outcome.failed}。請重新拍一張`);
        return;
      }

      if (outcome === "pending") {
        setResult({ durationSeconds, summary: null, newBadgeCodes: [] });
        return;
      }

      const summary =
        useSyncStore.getState().lastGamification ?? (await api.get<GamificationSummary>("/gamification/summary"));
      setResult({ durationSeconds, summary, newBadgeCodes: newBadgesSince(beforeSummary, summary) });
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
        <div className="page page-center">
          <div style={{ fontSize: 64 }}>🎉</div>
          <h1 className="page-title">{pickCompletionMessage()}</h1>
          <p style={{ margin: 0 }}>這一餐吃了 {formatDuration(result.durationSeconds)}</p>

          {result.summary ? (
            <div className="stat-pair">
              <div className="stat stat-accent">
                <div className="stat-num">{result.summary.totalPoints}</div>
                <div className="stat-label">總點數</div>
              </div>
              <div className="stat stat-primary">
                <div className="stat-num">{result.summary.currentStreakDays}</div>
                <div className="stat-label">連續天</div>
              </div>
            </div>
          ) : (
            <p className="page-hint" style={{ maxWidth: 300 }}>
              已存在手機裡，有網路就會自動上傳，並幫你算好點數
            </p>
          )}

          {newBadges.length > 0 && (
            <>
              <div className="section-title">獲得新徽章！</div>
              <div className="badge-grid" style={{ width: "100%" }}>
                {newBadges.map((b) => (
                  <div key={b.code} className="badge-cell">
                    <span className="badge-emoji">{b.iconEmoji}</span>
                    <span className="badge-name">{b.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="page-footer">
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            回到首頁
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">記錄餐後</h1>
          <p className="page-hint">
            {meal
              ? `${MEAL_TYPE_LABEL[meal.mealType]}·餐前照 ${new Date(meal.preMealAt).toLocaleTimeString("zh-TW", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "載入中…"}
          </p>
        </div>
      </div>

      <div className="page">
        {loadError && <p className="error-text">{loadError}</p>}

        <div className="section-title">拍下吃完後的樣子</div>
        <CameraCaptureField
          label="餐後照片"
          onCapture={(f, d) => {
            setFile(f);
            setCapturedAt(d);
            setError(null);
          }}
        />

        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="page-footer">
        <button className="btn btn-primary" onClick={submit} disabled={submitting || !meal || !file}>
          {submitting ? "儲存中…" : "✓ 完成這一餐"}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          稍後再拍
        </button>
      </div>
    </div>
  );
}
