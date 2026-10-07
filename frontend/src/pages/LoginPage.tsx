import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError, NetworkError } from "../api/client";
import { isNativeApp } from "../api/config";
import { useAuthStore } from "../store/auth";
import { pendingTrialImportCount } from "../trial/trialData";
import type { AuthUser } from "../api/types";

export function LoginPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const startTrial = useAuthStore((s) => s.startTrial);
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
      // 這支手機上還留著試用模式的紀錄 → 先問一次要不要帶進這個帳號
      const trialMeals = await pendingTrialImportCount(data.user.id).catch(() => 0);
      navigate(trialMeals > 0 ? "/import-trial" : "/");
    } catch (err) {
      if (err instanceof NetworkError) setError("目前沒有網路，請連上網路再登入");
      else setError(err instanceof ApiError ? err.message : "登入失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <form id="login-form" className="page page-center" onSubmit={onSubmit}>
        <div style={{ fontSize: 56 }}>🌱</div>
        <h1 className="page-title">腎臟飲食小幫手</h1>
        <p className="page-hint" style={{ marginBottom: 8 }}>
          記錄三餐，一起守護腎臟健康
        </p>

        <div style={{ width: "100%", textAlign: "left" }}>
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
            <label className="label">密碼</label>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="error-text">{error}</p>}
        </div>
      </form>

      <div className="page-footer">
        {/* 按鈕固定在畫面底部、在 form 外面，用 form 屬性關聯回去，Enter 送出也能運作 */}
        <button className="btn btn-primary" type="submit" form="login-form" disabled={loading}>
          {loading ? "登入中…" : "登入"}
        </button>
        <Link to="/register" className="btn btn-ghost" style={{ textDecoration: "none" }}>
          還沒有帳號？建立新帳號
        </Link>
        <Link to="/forgot-password" className="link-btn" style={{ textAlign: "center" }}>
          忘記密碼？
        </Link>
        <div className="link-row">
          {/* 不用帳號也能先把流程走一遍（紀錄只存在本機）。第一次開啟 App 時
              「開始使用」畫面已經問過一次，這裡是給已經設定過伺服器的人回頭用的 */}
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              startTrial();
              navigate("/", { replace: true });
            }}
          >
            🧪 不登入，先試用
          </button>
          {/* 試用版才需要：讓測試者可以改連到別台後端。正式版寫死網址後這個連結不會出現 */}
          {isNativeApp() && (
            <Link to="/setup" className="link-btn" style={{ display: "inline-block" }}>
              ⚙️ 伺服器設定
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
