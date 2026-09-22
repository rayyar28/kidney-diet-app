import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { BottomNav } from "../components/BottomNav";
import { ElapsedTimer } from "../components/ElapsedTimer";
import { SyncStatusBar } from "../components/SyncStatusBar";
import { Toast } from "../components/Toast";
import { requestAbandon } from "../offline/mealStore";
import { useMealViews } from "../offline/useMealViews";
import { useToastStore } from "../store/toast";
import { pickEncouragement } from "../content/encouragement";

const MEAL_TYPE_LABEL: Record<string, string> = {
  BREAKFAST: "早餐",
  LUNCH: "午餐",
  DINNER: "晚餐",
  SNACK: "點心",
};

/**
 * 首頁只做一件事：告訴病人「現在該按哪裡」。
 * 有還沒拍餐後照的紀錄 → 整個畫面主體就是那顆「拍餐後照」大按鈕；
 * 沒有的話 → 就是「開始記錄一餐」大按鈕。其餘資訊（徽章牆等）都在其他頁。
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);
  const { meals, summary, offline } = useMealViews();

  const pending = meals.filter((m) => m.status === "AWAITING_POST_PHOTO");
  const current = pending[0];

  async function abandon() {
    if (!user || !current) return;
    try {
      await requestAbandon({ userId: user.id, mealId: current.id, serverMeal: current });
      showToast("已放棄這筆紀錄");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "操作失敗，請再試一次");
    }
  }

  const encouragement = pickEncouragement(summary?.currentStreakDays ?? 0);

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <div className="page-hint">哈囉</div>
          <div className="page-title">{user?.displayName ?? "朋友"}</div>
        </div>
        <div className="stat-pair">
          <div className="stat stat-accent">
            <div className="stat-num">{summary?.totalPoints ?? 0}</div>
            <div className="stat-label">點數</div>
          </div>
          <div className="stat stat-primary">
            <div className="stat-num">{summary?.currentStreakDays ?? 0}</div>
            <div className="stat-label">連續天</div>
          </div>
        </div>
      </div>

      <div className="page">
        <SyncStatusBar offline={offline} />

        {current ? (
          // 有待補餐後照時不放鼓勵語：大按鈕本身已經說了要做什麼，
          // 多一行文字只是重複，還會在小螢幕 + 離線提示同時出現時把版面擠到需要滑動
          <>
            <button
              type="button"
              className="hero-btn hero-accent"
              onClick={() => navigate(`/meal/${current.id}/post-meal`)}
            >
              <span className="hero-icon">📷</span>
              <span className="hero-label">拍餐後照</span>
              <span className="hero-hint">
                {MEAL_TYPE_LABEL[current.mealType]}· <ElapsedTimer since={current.preMealAt} />
              </span>
            </button>
            {pending.length > 1 && (
              <div className="page-hint" style={{ textAlign: "center" }}>
                另外還有 {pending.length - 1} 筆等待餐後照，可到「紀錄」查看
              </div>
            )}
          </>
        ) : (
          <>
            <div className="encourage-line">{encouragement.headline}</div>
            <button type="button" className="hero-btn" onClick={() => navigate("/new-meal")}>
              <span className="hero-icon">📷</span>
              <span className="hero-label">開始記錄一餐</span>
              <span className="hero-hint">先拍「吃之前」的樣子</span>
            </button>
          </>
        )}
      </div>

      {current && (
        <div className="page-footer">
          <button className="btn btn-secondary" onClick={() => navigate("/new-meal")}>
            記錄另一餐
          </button>
          <button className="btn btn-ghost" onClick={abandon}>
            放棄這筆紀錄
          </button>
        </div>
      )}

      <Toast />
      <BottomNav />
    </div>
  );
}
