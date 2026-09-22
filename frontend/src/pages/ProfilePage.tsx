import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, NetworkError } from "../api/client";
import { loadServerCache } from "../offline/mealStore";
import { useSyncStore } from "../offline/syncStore";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { BottomNav } from "../components/BottomNav";
import type { GamificationSummary } from "../api/types";

interface PatientProfile {
  ckdStage: string;
  dialysisType: string;
  dailySodiumLimitMg: number | null;
  dailyPotassiumLimitMg: number | null;
  dailyPhosphorusLimitMg: number | null;
}

const CKD_STAGE_LABEL: Record<string, string> = {
  STAGE_1: "第一期",
  STAGE_2: "第二期",
  STAGE_3A: "第三期 A",
  STAGE_3B: "第三期 B",
  STAGE_4: "第四期",
  STAGE_5: "第五期",
  TRANSPLANT: "腎臟移植",
  UNKNOWN: "尚未設定",
};

const DIALYSIS_LABEL: Record<string, string> = {
  NONE: "無洗腎",
  HEMODIALYSIS: "血液透析",
  PERITONEAL_DIALYSIS: "腹膜透析",
};

export function ProfilePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const showToast = useToastStore((s) => s.show);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const failedCount = useSyncStore((s) => s.failedCount);
  const [summary, setSummary] = useState<GamificationSummary | null>(null);
  const [profile, setProfile] = useState<PatientProfile>({
    ckdStage: "UNKNOWN",
    dialysisType: "NONE",
    dailySodiumLimitMg: null,
    dailyPotassiumLimitMg: null,
    dailyPhosphorusLimitMg: null,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // 離線時載不到就維持預設值 (點數等資料改用本機快取)，不要丟出未處理的錯誤
    if (user) loadServerCache(user.id).then((cached) => cached?.summary && setSummary(cached.summary)).catch(() => {});
    api.get<GamificationSummary>("/gamification/summary").then(setSummary).catch(() => {});
    api
      .get<{ user: { patientProfile: PatientProfile | null } }>("/profile")
      .then((data) => {
        if (data.user.patientProfile) setProfile(data.user.patientProfile);
      })
      .catch(() => {});
  }, [user]);

  async function save() {
    setSaving(true);
    try {
      await api.put("/profile", profile);
      showToast("已更新個人資料");
    } catch (err) {
      showToast(err instanceof NetworkError ? "目前沒有網路，請連上網路後再儲存" : "儲存失敗，請再試一次");
    } finally {
      setSaving(false);
    }
  }

  function logout() {
    if (pendingCount + failedCount > 0) {
      const ok = window.confirm(
        `還有 ${pendingCount + failedCount} 筆紀錄還沒上傳完成。登出後它們會繼續保留在這支手機裡，下次用同一個帳號登入並連上網路時會自動上傳。\n\n確定要登出嗎？`
      );
      if (!ok) return;
    }
    clearAuth();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div style={{ fontSize: 18, fontWeight: 700 }}>我的</div>
      </div>
      <div className="page">
        <div className="card center-col">
          <div style={{ fontSize: 32 }}>👤</div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{user?.displayName}</div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>{user?.email}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <span className="pill pill-accent">✨ {summary?.totalPoints ?? 0} 點</span>
            <span className="pill pill-primary">🔥 最長連續 {summary?.longestStreakDays ?? 0} 天</span>
          </div>
        </div>

        <div className="section-title">我的徽章牆</div>
        <div className="badge-grid">
          {(summary?.badges ?? []).map((b) => (
            <div key={b.code} className={`badge-cell ${b.earned ? "" : "locked"}`}>
              <span className="badge-emoji">{b.iconEmoji}</span>
              <span className="badge-name">{b.name}</span>
            </div>
          ))}
        </div>

        <div className="section-title">健康背景（幫助未來的飲食建議更準確）</div>
        <div className="card">
          <div className="field">
            <label className="label">慢性腎臟病分期</label>
            <select
              className="input"
              value={profile.ckdStage}
              onChange={(e) => setProfile({ ...profile, ckdStage: e.target.value })}
            >
              {Object.entries(CKD_STAGE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">透析狀態</label>
            <select
              className="input"
              value={profile.dialysisType}
              onChange={(e) => setProfile({ ...profile, dialysisType: e.target.value })}
            >
              {Object.entries(DIALYSIS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label">每日鈉攝取上限（mg）</label>
            <input
              className="input"
              type="number"
              value={profile.dailySodiumLimitMg ?? ""}
              onChange={(e) => setProfile({ ...profile, dailySodiumLimitMg: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
          <div className="field">
            <label className="label">每日鉀攝取上限（mg）</label>
            <input
              className="input"
              type="number"
              value={profile.dailyPotassiumLimitMg ?? ""}
              onChange={(e) =>
                setProfile({ ...profile, dailyPotassiumLimitMg: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>
          <div className="field">
            <label className="label">每日磷攝取上限（mg）</label>
            <input
              className="input"
              type="number"
              value={profile.dailyPhosphorusLimitMg ?? ""}
              onChange={(e) =>
                setProfile({ ...profile, dailyPhosphorusLimitMg: e.target.value ? Number(e.target.value) : null })
              }
            />
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? "儲存中..." : "儲存"}
          </button>
        </div>

        <button className="btn btn-ghost" style={{ width: "100%", marginTop: 20 }} onClick={logout}>
          登出
        </button>
      </div>
      <BottomNav />
    </div>
  );
}
