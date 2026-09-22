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
import { ProfilePage } from "./pages/ProfilePage";
import { HealthProfilePage } from "./pages/HealthProfilePage";
import { ServerSetupPage } from "./pages/ServerSetupPage";
import { needsApiBaseSetup } from "./api/config";

function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  // 登入期間一直開著同步引擎：把本機還沒上傳的紀錄在有網路時補傳給伺服器
  const userId = useAuthStore((s) => s.user?.id);
  useEffect(() => {
    if (!userId) return;
    return startSyncEngine();
  }, [userId]);

  // 試用版 APK 第一次開啟時還不知道後端在哪，先請使用者設定（正式版寫死網址，不會進到這裡）。
  //
  // 必須用 state 而不是每次 render 直接呼叫 needsApiBaseSetup()：App 只訂閱了登入狀態，
  // 路由變化不會讓 App 重新 render，所以設定完網址之後那個判斷不會被重新計算，
  // 畫面會一直卡在設定頁（存好了也跳不出去）。存檔成功時由設定頁回呼把這個狀態關掉。
  const [needsSetup, setNeedsSetup] = useState(needsApiBaseSetup);
  if (needsSetup) {
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
      <Route
        path="/"
        element={
          <RequireAuth>
            <DashboardPage />
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
        path="/profile"
        element={
          <RequireAuth>
            <ProfilePage />
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
