import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuthStore } from "../store/auth";
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
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "註冊失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page center-col" style={{ justifyContent: "center", minHeight: "100%" }}>
        <div style={{ fontSize: 40 }}>🌱</div>
        <h1 style={{ margin: 0, fontSize: 22 }}>建立帳號</h1>
        <form onSubmit={onSubmit} style={{ width: "100%", marginTop: 12, textAlign: "left" }}>
          <div className="field">
            <label className="label">暱稱</label>
            <input className="input" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">密碼（至少 8 個字元）</label>
            <input
              className="input"
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "建立中..." : "註冊並開始使用"}
          </button>
        </form>
        <p style={{ fontSize: 14, color: "var(--color-text-muted)" }}>
          已經有帳號？ <Link to="/login">前往登入</Link>
        </p>
      </div>
    </div>
  );
}
