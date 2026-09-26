import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { listLocalMeals, loadServerCache } from "../offline/mealStore";
import { useSyncStore } from "../offline/syncStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { computeLocalGamification } from "../trial/gamification";
import { clearTrialData } from "../trial/trialData";
import { BottomNav } from "../components/BottomNav";
import { Toast } from "../components/Toast";
import type { GamificationSummary } from "../api/types";

/**
 * 個人頁只顯示「我是誰、我累積了什麼」。
 * 健康資料設定欄位多、會需要滑動，所以移到獨立的 /profile/health 頁面。
 */
export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const trial = useAuthStore((s) => s.mode === "trial");
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const showToast = useToastStore((s) => s.show);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const failedCount = useSyncStore((s) => s.failedCount);
  const [summary, setSummary] = useState<GamificationSummary | null>(null);

  const loadTrialSummary = useCallback(async () => {
    if (!user) return;
    const locals = await listLocalMeals(user.id).catch(() => []);
    setSummary(computeLocalGamification(locals));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // 試用模式沒有伺服器，點數/徽章在本機用同一套規則算
    if (trial) {
      void loadTrialSummary();
      return;
    }
    // 離線時載不到就用本機快取，不要丟出未處理的錯誤
    loadServerCache(user.id)
      .then((cached) => cached?.summary && setSummary(cached.summary))
      .catch(() => {});
    api
      .get<GamificationSummary>("/gamification/summary")
      .then(setSummary)
      .catch(() => {});
  }, [user, trial, loadTrialSummary]);

  async function resetTrial() {
    if (!window.confirm("要清除試用期間的所有紀錄嗎？清除後無法復原。\n\n（適合換下一位測試者接手前使用）")) return;
    await clearTrialData();
    await loadTrialSummary();
    showToast("已清除試用紀錄");
  }

  function endTrial() {
    const ok = window.confirm(
      "結束試用後會回到「開始使用」畫面。\n\n試用期間的紀錄會留在這支手機，下次再進試用模式還看得到；要清掉請先按「清除試用紀錄」。"
    );
    if (!ok) return;
    clearAuth();
    navigate("/login", { replace: true });
  }

  function logout() {
    const unsynced = pendingCount + failedCount;
    if (unsynced > 0) {
      const ok = window.confirm(
        `還有 ${unsynced} 筆紀錄還沒上傳完成。登出後它們會留在這支手機裡，下次用同一個帳號登入並連上網路時會自動上傳。\n\n確定要登出嗎？`
      );
      if (!ok) return;
    }
    clearAuth();
    navigate("/login");
  }

  const badges = summary?.badges ?? [];
  const earnedCount = badges.filter((b) => b.earned).length;
  // 已獲得的排前面，最多顯示兩排 (8 個)。全部 13 個攤開會超出畫面需要滑動，
  // 而且一整片灰色的未解鎖徽章對病人也不是好的觀感。
  const shown = [...badges.filter((b) => b.earned), ...badges.filter((b) => !b.earned)].slice(0, 8);

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">{user?.displayName}</h1>
          <p className="page-hint">{user?.email}</p>
        </div>
      </div>

      <div className="page">
        <div className="stat-pair">
          <div className="stat stat-accent" style={{ flex: 1 }}>
            <div className="stat-num">{summary?.totalPoints ?? 0}</div>
            <div className="stat-label">總點數</div>
          </div>
          <div className="stat stat-primary" style={{ flex: 1 }}>
            <div className="stat-num">{summary?.longestStreakDays ?? 0}</div>
            <div className="stat-label">最長連續天</div>
          </div>
        </div>

        <div className="section-title">
          我的徽章　已獲得 {earnedCount} / {badges.length} 個
        </div>
        <div className="badge-grid">
          {shown.map((b) => (
            <div key={b.code} className={`badge-cell ${b.earned ? "" : "locked"}`}>
              <span className="badge-emoji">{b.iconEmoji}</span>
              <span className="badge-name">{b.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="page-footer">
        <button className="btn btn-secondary" onClick={() => navigate("/profile/health")}>
          🩺 我的健康資料
        </button>
        {trial ? (
          <>
            <button className="btn btn-ghost" onClick={endTrial}>
              結束試用
            </button>
            {/* 換下一位測試者之前用的，刻意做小、放最下面，避免被當成一般操作誤按 */}
            <button type="button" className="link-btn" onClick={resetTrial}>
              清除試用紀錄
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={logout}>
            登出
          </button>
        )}
      </div>

      <Toast />
      <BottomNav />
    </div>
  );
}
