import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, NetworkError } from "../api/client";
import { Toast } from "../components/Toast";
import { useToastStore } from "../store/toast";

interface PatientProfile {
  ckdStage: string;
  dialysisType: string;
  dailySodiumLimitMg: number | null;
  dailyPotassiumLimitMg: number | null;
  dailyPhosphorusLimitMg: number | null;
}

const CKD_STAGE_LABEL: Record<string, string> = {
  UNKNOWN: "尚未設定",
  STAGE_1: "第一期",
  STAGE_2: "第二期",
  STAGE_3A: "第三期 A",
  STAGE_3B: "第三期 B",
  STAGE_4: "第四期",
  STAGE_5: "第五期",
  TRANSPLANT: "腎臟移植",
};

const DIALYSIS_LABEL: Record<string, string> = {
  NONE: "沒有洗腎",
  HEMODIALYSIS: "血液透析",
  PERITONEAL_DIALYSIS: "腹膜透析",
};

const LIMIT_FIELDS: Array<{ key: keyof PatientProfile; label: string }> = [
  { key: "dailySodiumLimitMg", label: "每日鈉上限（mg）" },
  { key: "dailyPotassiumLimitMg", label: "每日鉀上限（mg）" },
  { key: "dailyPhosphorusLimitMg", label: "每日磷上限（mg）" },
];

/**
 * 健康資料設定。這是少數會用到的設定頁，欄位較多所以允許滑動，
 * 但每個欄位都用大字、大輸入框，並把儲存按鈕固定在底部。
 */
export function HealthProfilePage() {
  const navigate = useNavigate();
  const showToast = useToastStore((s) => s.show);
  const [profile, setProfile] = useState<PatientProfile>({
    ckdStage: "UNKNOWN",
    dialysisType: "NONE",
    dailySodiumLimitMg: null,
    dailyPotassiumLimitMg: null,
    dailyPhosphorusLimitMg: null,
  });
  const [saving, setSaving] = useState(false);
  // 三個 mg 上限通常是營養師/衛教師給的數字，病人自己多半不知道，
  // 預設收起來讓畫面只留病人答得出來的兩題（也讓這一頁不需要滑動）。
  const [limitsOpen, setLimitsOpen] = useState(false);

  useEffect(() => {
    api
      .get<{ user: { patientProfile: PatientProfile | null } }>("/profile")
      .then((data) => {
        const p = data.user.patientProfile;
        if (!p) return;
        setProfile(p);
        // 已經填過上限的人，直接展開讓他看得到自己填的值
        if (LIMIT_FIELDS.some((f) => p[f.key] != null)) setLimitsOpen(true);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      await api.put("/profile", profile);
      showToast("已儲存");
      navigate("/profile");
    } catch (err) {
      showToast(err instanceof NetworkError ? "目前沒有網路，請連上網路再儲存" : "儲存失敗，請再試一次");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">我的健康資料</h1>
          <p className="page-hint">幫助未來的飲食建議更準確</p>
        </div>
      </div>

      <div className="page">
        <div className="field">
          <label className="label">腎臟病分期</label>
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
          <label className="label">洗腎狀況</label>
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

        {limitsOpen ? (
          LIMIT_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label className="label">{f.label}</label>
              <input
                className="input"
                type="number"
                inputMode="numeric"
                placeholder="不知道可以留空"
                value={(profile[f.key] as number | null) ?? ""}
                onChange={(e) => setProfile({ ...profile, [f.key]: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          ))
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setLimitsOpen(true)}>
            ⚙️ 營養師給的每日上限（選填）
          </button>
        )}
      </div>

      <div className="page-footer">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "儲存中…" : "✓ 儲存"}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate("/profile")}>
          返回
        </button>
      </div>

      <Toast />
    </div>
  );
}
