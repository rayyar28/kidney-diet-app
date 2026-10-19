import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, NetworkError } from "../api/client";
import { useAuthStore } from "../store/auth";
import type { AuthUser } from "../api/types";

/**
 * 衛教師幫病人建帳號：只填研究編號與初始密碼。
 *
 * **刻意沒有「姓名」欄位**：醫院端的規定是病人身分只用研究編號，不存姓名或病歷號
 * （送資訊室的申請書上也是這樣寫）。少一個欄位，就少一個有人「順手」把名字打進去的機會。
 *
 * 實際流程：衛教師在這裡建好帳號後，直接在病人的手機上用這組帳號密碼登入。
 * 登入狀態可以維持一年，所以多數病人之後根本不需要再打密碼。
 */
export function StaffCreatePatientPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const [patientRef, setPatientRef] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<{ patientRef: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 前端這層只是不讓一般病人看到這個畫面；真正的權限檢查在後端
  if (role !== "RESEARCHER" && role !== "ADMIN") return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user } = await api.post<{ user: AuthUser }>("/staff/patients", { patientRef, password });
      // 顯示伺服器存下來的編號（已經轉大寫、全形轉半形），衛教師抄給病人的才會是對的那一個
      setCreated({ patientRef: user.patientRef ?? patientRef, password });
    } catch (err) {
      if (err instanceof NetworkError) setError("目前沒有網路，請連上網路再試");
      else setError(err instanceof ApiError ? err.message : "建立失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  if (created) {
    return (
      <div className="app-shell">
        <div className="page page-center">
          <div style={{ fontSize: 64 }}>✅</div>
          <h1 className="page-title">帳號已建立</h1>
          <div className="reset-code">{created.patientRef}</div>
          <p style={{ margin: 0 }}>
            初始密碼：<strong>{created.password}</strong>
          </p>
          <p className="page-hint" style={{ maxWidth: 320 }}>
            請在病人的手機上，用這組研究編號和密碼登入。
          </p>
        </div>
        <div className="page-footer">
          <button
            className="btn btn-secondary"
            onClick={() => {
              setCreated(null);
              setPatientRef("");
              setPassword("");
            }}
          >
            再建一位病人
          </button>
          <button className="btn btn-ghost" onClick={() => navigate("/staff")}>
            完成
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">幫病人建帳號</h1>
          <p className="page-hint">只填研究編號，不填姓名</p>
        </div>
      </div>

      <form id="create-patient-form" className="page" onSubmit={onSubmit}>
        <div className="field">
          <label className="label">研究編號</label>
          <input
            className="input"
            type="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="例如 P0012"
            required
            value={patientRef}
            onChange={(e) => setPatientRef(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">初始密碼</label>
          {/* 刻意用明碼顯示：衛教師要把它交給病人，打錯了要看得出來 */}
          <input
            className="input"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <p className="page-hint">至少 8 個字。建議用 8 位數字，長輩比較好輸入。</p>
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className="page-footer">
        <button className="btn btn-primary" type="submit" form="create-patient-form" disabled={loading}>
          {loading ? "建立中…" : "✓ 建立帳號"}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate("/staff")}>
          返回
        </button>
      </div>
    </div>
  );
}
