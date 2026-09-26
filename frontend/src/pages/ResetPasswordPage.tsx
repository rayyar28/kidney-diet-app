import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError, NetworkError } from "../api/client";

/**
 * 用代碼設定新密碼。
 *
 * 代碼可能從兩個地方來：信件裡的連結（帶 ?code=，自動填好）、或是衛教師口頭告訴病人
 * （自己打）。所以欄位一定要能手動輸入，而且要容忍大小寫與有沒有打連字號——
 * 後端會做同樣的正規化。
 */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("密碼至少要 8 個字");
      return;
    }
    if (password !== confirm) {
      setError("兩次輸入的密碼不一樣");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { code, password }, { skipAuth: true });
      setDone(true);
    } catch (err) {
      if (err instanceof NetworkError) setError("目前沒有網路，請連上網路再試");
      else setError(err instanceof ApiError ? err.message : "重設失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="app-shell">
        <div className="page page-center">
          <div style={{ fontSize: 56 }}>✅</div>
          <h1 className="page-title">密碼已更新</h1>
          <p style={{ margin: 0, maxWidth: 300 }}>請用新密碼登入。</p>
          <p className="page-hint" style={{ maxWidth: 300 }}>
            其他裝置上的登入狀態已經一起登出了。手機裡還沒上傳的紀錄不會不見，
            重新登入後會自動繼續上傳。
          </p>
        </div>
        <div className="page-footer">
          <button className="btn btn-primary" onClick={() => navigate("/login", { replace: true })}>
            去登入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">設定新密碼</h1>
          <p className="page-hint">輸入收到的代碼，再設一個新密碼</p>
        </div>
      </div>

      <form id="reset-form" className="page" onSubmit={onSubmit}>
        <div className="field">
          <label className="label">重設代碼</label>
          <input
            className="input input-code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCDE-FGHIJ"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">新密碼（至少 8 個字）</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">再打一次新密碼</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className="page-footer">
        <button className="btn btn-primary" type="submit" form="reset-form" disabled={loading}>
          {loading ? "設定中…" : "✓ 設定新密碼"}
        </button>
        <Link to="/login" className="link-btn" style={{ textAlign: "center" }}>
          回到登入
        </Link>
      </div>
    </div>
  );
}
