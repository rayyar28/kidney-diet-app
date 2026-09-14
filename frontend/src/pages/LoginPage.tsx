import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuthStore } from "../store/auth";
import type { AuthUser } from "../api/types";

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
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
        "/auth/login",
        { email, password },
        { skipAuth: true }
      );
      setSession(data.user, data.accessToken, data.refreshToken);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登入失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="page center-col" style={{ justifyContent: "center", minHeight: "100%" }}>
        <div style={{ fontSize: 40 }}>🌱</div>
        <h1 style={{ margin: 0, fontSize: 22 }}>腎臟飲食小幫手</h1>
        <p style={{ color: "var(--color-text-muted)", marginTop: -4 }}>記錄三餐，一起守護你的腎臟健康</p>
        <form onSubmit={onSubmit} style={{ width: "100%", marginTop: 12, textAlign: "left" }}>
          <div className="field">
            <label className="label">Email</label>
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">密碼</label>
            <input
              className="input"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "登入中..." : "登入"}
          </button>
        </form>
        <p style={{ fontSize: 14, color: "var(--color-text-muted)" }}>
          還沒有帳號？ <Link to="/register">立即註冊</Link>
        </p>
      </div>
    </div>
  );
}
