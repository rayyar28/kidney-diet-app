import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, NetworkError } from "../api/client";

/**
 * 申請重設密碼。
 *
 * 不論這個信箱有沒有註冊，畫面都顯示同一句話——後端也是一律回 204。
 * 如果這裡會出現「查無此帳號」，任何人都能拿它逐一測試某個人是不是這個腎臟病研究的
 * 受試者，那等於洩漏病情。
 *
 * 畫面上同時給「我已經收到代碼」的出口，因為衛教師代開的代碼不會經過信箱，
 * 病人是直接拿到一組代碼的。
 */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email }, { skipAuth: true });
      setSent(true);
    } catch (err) {
      // 連不上網路是唯一該告訴使用者的失敗：其他情況後端都回成功
      setError(err instanceof NetworkError ? "目前沒有網路，請連上網路再試" : "申請失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="app-shell">
        <div className="page page-center">
          <div style={{ fontSize: 56 }}>📬</div>
          <h1 className="page-title">信寄出去了</h1>
          <p style={{ margin: 0, maxWidth: 300 }}>
            如果 <strong>{email}</strong> 有註冊過，裡面會有一組重設代碼。
          </p>
          <p className="page-hint" style={{ maxWidth: 300 }}>
            沒收到的話記得看一下垃圾信匣。代碼一小時內有效。
          </p>
        </div>
        <div className="page-footer">
          <button className="btn btn-primary" onClick={() => navigate("/reset-password")}>
            我收到代碼了
          </button>
          <Link to="/login" className="btn btn-ghost" style={{ textDecoration: "none" }}>
            回到登入
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">忘記密碼</h1>
          <p className="page-hint">我們會寄一組代碼到你的信箱</p>
        </div>
      </div>

      <form id="forgot-form" className="page" onSubmit={onSubmit}>
        <div className="field">
          <label className="label">註冊時用的 Email</label>
          <input
            className="input"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <p className="page-hint">
          信箱進不去也沒關係——回診時請衛教師幫你開一組代碼，一樣可以重設。
        </p>
      </form>

      <div className="page-footer">
        <button className="btn btn-primary" type="submit" form="forgot-form" disabled={loading}>
          {loading ? "申請中…" : "寄出重設代碼"}
        </button>
        <Link to="/reset-password" className="btn btn-ghost" style={{ textDecoration: "none" }}>
          我已經有代碼了
        </Link>
        <Link to="/login" className="link-btn" style={{ textAlign: "center" }}>
          回到登入
        </Link>
      </div>
    </div>
  );
}
