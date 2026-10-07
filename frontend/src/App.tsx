import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { startSyncEngine } from "./offline/syncEngine";
import { useAuthStore } from "./store/auth";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NewMealPage } from "./pages/NewMealPage";
import { PostMealPage } from "./pages/PostMealPage";
import { HistoryPage } from "./pages/HistoryPage";
import { HistoryDayPage } from "./pages/HistoryDayPage";
import { ProfilePage } from "./pages/ProfilePage";
import { HealthProfilePage } from "./pages/HealthProfilePage";
import { ServerSetupPage } from "./pages/ServerSetupPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { StaffResetPage } from "./pages/StaffResetPage";
import { ImportTrialPage } from "./pages/ImportTrialPage";
import { needsApiBaseSetup } from "./api/config";

function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  // 試用模式沒有帳號也沒有 token，但一樣可以進 App（資料只存在本機）
  const trial = useAuthStore((s) => s.mode === "trial");
  if (!accessToken && !trial) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const userId = useAuthStore((s) => s.user?.id);
  const trial = useAuthStore((s) => s.mode === "trial");

  // 登入期間一直開著同步引擎：把本機還沒上傳的紀錄在有網路時補傳給伺服器。
  // 試用模式不啟動——沒有伺服器可傳，開著只會讓畫面一直顯示「N 筆等待上傳」。
  useEffect(() => {
    if (!userId || trial) return;
    return startSyncEngine();
  }, [userId, trial]);

  // 試用版 APK 第一次開啟時還不知道後端在哪，先請使用者設定（正式版寫死網址，不會進到這裡）。
  //
  // 必須用 state 而不是每次 render 直接呼叫 needsApiBaseSetup()：App 只訂閱了登入狀態，
  // 路由變化不會讓 App 重新 render，所以設定完網址之後那個判斷不會被重新計算，
  // 畫面會一直卡在設定頁（存好了也跳不出去）。存檔成功時由設定頁回呼把這個狀態關掉。
  const [needsSetup, setNeedsSetup] = useState(needsApiBaseSetup);
  // 選了「直接試用」就不必設定網址；trial 有訂閱，切換模式時這裡會重新判斷
  if (needsSetup && !trial) {
    return (
      <Routes>
        <Route path="*" element={<ServerSetupPage onSaved={() => setNeedsSetup(false)} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<ServerSetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      {/* 忘記密碼不需要登入就能用 */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      {/* 登入後若手機上還有試用紀錄，先問一次要不要帶進這個帳號 */}
      <Route
        path="/import-trial"
        element={
          <RequireAuth>
            <ImportTrialPage />
          </RequireAuth>
        }
      />
      <Route
        path="/new-meal"
        element={
          <RequireAuth>
            <NewMealPage />
          </RequireAuth>
        }
      />
      <Route
        path="/meal/:id/post-meal"
        element={
          <RequireAuth>
            <PostMealPage />
          </RequireAuth>
        }
      />
      <Route
        path="/history"
        element={
          <RequireAuth>
            <HistoryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/history/:day"
        element={
          <RequireAuth>
            <HistoryDayPage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        }
      />
      <Route
        path="/staff/reset"
        element={
          <RequireAuth>
            <StaffResetPage />
          </RequireAuth>
        }
      />
      <Route
        path="/profile/health"
        element={
          <RequireAuth>
            <HealthProfilePage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
