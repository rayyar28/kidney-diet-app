import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, NetworkError } from "../api/client";
import { useAuthStore } from "../store/auth";
import { pendingTrialImportCount } from "../trial/trialData";
import type { AuthUser } from "../api/types";

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await api.post<{ user: AuthUser; accessToken: string; refreshToken: string }>(
        "/auth/register",
        { displayName, email, password },
        { skipAuth: true }
      );
      setSession(data.user, data.accessToken, data.refreshToken);
      // 這支手機上還留著試用模式的紀錄 → 先問一次要不要帶進這個帳號
      const trialMeals = await pendingTrialImportCount(data.user.id).catch(() => 0);
      navigate(trialMeals > 0 ? "/import-trial" : "/");
    } catch (err) {
      if (err instanceof NetworkError) setError("目前沒有網路，請連上網路再註冊");
      else setError(err instanceof ApiError ? err.message : "註冊失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">建立新帳號</h1>
          <p className="page-hint">只需要三個欄位</p>
        </div>
      </div>

      <form id="register-form" className="page" onSubmit={onSubmit}>
        <div className="field">
          <label className="label">您的稱呼</label>
          <input className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">密碼（至少 8 個字）</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className="page-footer">
        <button className="btn btn-primary" type="submit" form="register-form" disabled={loading}>
          {loading ? "建立中…" : "建立帳號"}
        </button>
        <Link to="/login" className="btn btn-ghost" style={{ textDecoration: "none" }}>
          已經有帳號？前往登入
        </Link>
      </div>
    </div>
  );
}
