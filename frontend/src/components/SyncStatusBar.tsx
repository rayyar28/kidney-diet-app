import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { requestSync } from "../offline/syncEngine";
import { useSyncStore } from "../offline/syncStore";
import { useToastStore } from "../store/toast";

/**
 * 顯示「有多少紀錄還沒上傳、為什麼」。有事要說才會出現，一切正常時完全不佔版面。
 * 文字刻意短（一行為目標）又帶安心感：重點是讓病人知道資料存在手機裡不會不見。
 */
export function SyncStatusBar({ offline = false }: { offline?: boolean }) {
  const navigate = useNavigate();
  const phase = useSyncStore((s) => s.phase);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const failedCount = useSyncStore((s) => s.failedCount);
  const lastRecovery = useSyncStore((s) => s.lastRecovery);
  const showToast = useToastStore((s) => s.show);

  useEffect(() => {
    if (lastRecovery) showToast(`網路恢復，已上傳 ${lastRecovery.processed} 筆 ✨`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRecovery?.at]);

  let message: string | null = null;
  let action: { label: string; run: () => void } | null = null;
  const retry = { label: "重試", run: () => void requestSync({ force: true }) };

  if (pendingCount > 0) {
    if (phase === "syncing") {
      message = `☁️ 正在上傳 ${pendingCount} 筆…`;
    } else if (phase === "paused-auth") {
      message = `🔒 請重新登入，${pendingCount} 筆待上傳`;
      action = { label: "登入", run: () => navigate("/login") };
    } else if (phase === "offline") {
      message = `📴 沒有網路，${pendingCount} 筆已存在手機裡`;
      action = retry;
    } else if (phase === "busy") {
      message = `⏳ 伺服器忙碌，${pendingCount} 筆稍後自動上傳`;
      action = retry;
    } else {
      message = `⏳ ${pendingCount} 筆等待上傳`;
      action = { label: "上傳", run: retry.run };
    }
  } else if (offline) {
    message = "📴 沒有網路，顯示上次的資料";
  }

  if (!message && failedCount === 0) return null;

  return (
    <>
      {message && (
        <div className="sync-bar">
          <span>{message}</span>
          {action && (
            <button type="button" className="sync-bar-btn" onClick={action.run}>
              {action.label}
            </button>
          )}
        </div>
      )}
      {failedCount > 0 && (
        <div className="sync-bar sync-bar-error">
          <span>⚠️ {failedCount} 筆上傳失敗</span>
          <button type="button" className="sync-bar-btn" onClick={() => navigate("/history")}>
            查看
          </button>
        </div>
      )}
    </>
  );
}
