import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { api, ApiError, NetworkError } from "../api/client";
import { accountLabel, useAuthStore } from "../store/auth";

interface IssuedCode {
  code: string;
  expiresInMinutes: number;
  user: { patientRef: string | null; email: string | null; displayName: string | null };
}

/**
 * 衛教師 / 研究人員：當面幫病人開一組重設代碼。
 *
 * 為什麼需要：年長病人的信箱常常是家人代辦的，密碼早忘了或根本不收信，email 重設
 * 對他們沒有用。回診時當面確認身分再開一組代碼，是身分驗證最強、也最實際的一條路。
 *
 * 這一頁只有 RESEARCHER / ADMIN 進得來（伺服器端也會再擋一次，不是只靠前端隱藏）。
 * 角色不能自助申請，要由管理者在主機上執行帳號工具（6_staff_account.bat / npm run account）。
 */
export function StaffResetPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  // 研究編號（病人）或 email（舊帳號），後端兩種都認得
  const [account, setAccount] = useState("");
  const [issued, setIssued] = useState<IssuedCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 前端這層只是不讓一般病人看到這個畫面；真正的權限檢查在後端
  if (role !== "RESEARCHER" && role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIssued(null);
    setLoading(true);
    try {
      setIssued(await api.post<IssuedCode>("/staff/password-resets", { account }));
    } catch (err) {
      if (err instanceof NetworkError) setError("目前沒有網路，請連上網路再試");
      else setError(err instanceof ApiError ? err.message : "開立失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  if (issued) {
    return (
      <div className="app-shell">
        <div className="top-bar">
          <div>
            <h1 className="page-title">代碼已開立</h1>
            <p className="page-hint">{accountLabel(issued.user)}</p>
          </div>
        </div>

        <div className="page page-center">
          <p className="page-hint">
            請把這 8 個數字唸給病人，讓他在 App 的「忘記密碼 → 我有代碼了」輸入
          </p>
          <div className="reset-code">{issued.code}</div>
          <p className="page-hint" style={{ maxWidth: 320 }}>
            {issued.expiresInMinutes} 分鐘內有效，只能使用一次。離開這一頁之後就看不到了，
            <strong>系統不會再顯示第二次</strong>。
          </p>
        </div>

        <div className="page-footer">
          <button
            className="btn btn-secondary"
            onClick={() => {
              setIssued(null);
              setAccount("");
            }}
          >
            幫下一位病人開立
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
          <h1 className="page-title">協助重設密碼</h1>
          <p className="page-hint">當面確認身分後再開立</p>
        </div>
      </div>

      <form id="staff-reset-form" className="page" onSubmit={onSubmit}>
        <div className="field">
          <label className="label">病人的研究編號</label>
          <input
            className="input"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="例如 P0012"
            required
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <p className="page-hint">
          開立之後，這個帳號先前還沒用過的重設代碼都會立刻失效。
        </p>
      </form>

      <div className="page-footer">
        <button className="btn btn-primary" type="submit" form="staff-reset-form" disabled={loading}>
          {loading ? "開立中…" : "開立重設代碼"}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate("/staff")}>
          返回
        </button>
      </div>
    </div>
  );
}
