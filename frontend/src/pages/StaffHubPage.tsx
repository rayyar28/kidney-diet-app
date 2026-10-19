import { Navigate, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";

/**
 * 衛教師工具：收案時要做的兩件事各一顆大按鈕。
 *
 * 為什麼另外開一頁，不直接放在「我的」：那一頁已經量過，多一顆按鈕就會超出 375×667
 * 需要滑動。而且這兩件事都是收案現場、當著病人的面做的，集中在一個地方比較好找。
 *
 * 前端這層只是不讓一般病人看到；真正的權限檢查在後端（staff.routes.ts）。
 */
export function StaffHubPage() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  if (role !== "RESEARCHER" && role !== "ADMIN") return <Navigate to="/" replace />;

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">衛教師工具</h1>
          <p className="page-hint">收案時當著病人的面使用</p>
        </div>
      </div>

      <div className="page">
        <button type="button" className="hero-btn" onClick={() => navigate("/staff/patients/new")}>
          <span className="hero-icon">🧑‍⚕️</span>
          <span className="hero-label">幫病人建帳號</span>
          <span className="hero-hint">研究編號 + 初始密碼</span>
        </button>
        <button type="button" className="hero-btn hero-accent" onClick={() => navigate("/staff/reset")}>
          <span className="hero-icon">🔑</span>
          <span className="hero-label">協助重設密碼</span>
          <span className="hero-hint">病人忘記密碼時當面開代碼</span>
        </button>
      </div>

      <div className="page-footer">
        <button className="btn btn-ghost" onClick={() => navigate("/profile")}>
          返回
        </button>
      </div>
    </div>
  );
}
