import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { requestSync } from "../offline/syncEngine";
import { useSyncStore } from "../offline/syncStore";
import { useToastStore } from "../store/toast";

/**
 * 顯示「有多少紀錄還沒上傳、為什麼」。有東西要說才會出現，一切正常時不佔版面。
 * 文字重點是讓病人放心：資料已經安全存在手機裡，不會因為沒網路而不見。
 */
export function SyncStatusBar({ offline = false }: { offline?: boolean }) {
  const navigate = useNavigate();
  const phase = useSyncStore((s) => s.phase);
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const failedCount = useSyncStore((s) => s.failedCount);
  const lastRecovery = useSyncStore((s) => s.lastRecovery);
  const showToast = useToastStore((s) => s.show);

  useEffect(() => {
    if (lastRecovery) showToast(`網路恢復了，已上傳 ${lastRecovery.processed} 筆紀錄 ✨`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastRecovery?.at]);

  let message: string | null = null;
  let action: { label: string; run: () => void } | null = null;

  if (pendingCount > 0) {
    if (phase === "syncing") {
      message = `☁️ 正在上傳 ${pendingCount} 筆紀錄…`;
    } else if (phase === "paused-auth") {
      message = `🔒 登入已失效，${pendingCount} 筆紀錄先安全存在手機裡。重新登入後會自動上傳。`;
      action = { label: "重新登入", run: () => navigate("/login") };
    } else if (phase === "offline") {
      message = `📴 目前沒有網路，${pendingCount} 筆紀錄已安全存在手機裡，連上網路後會自動上傳。`;
      action = { label: "立即重試", run: () => void requestSync({ force: true }) };
    } else if (phase === "busy") {
      message = `⏳ 伺服器暫時忙碌，${pendingCount} 筆紀錄稍後會自動重試上傳。`;
      action = { label: "立即重試", run: () => void requestSync({ force: true }) };
    } else {
      message = `⏳ ${pendingCount} 筆紀錄等待上傳中…`;
      action = { label: "立即上傳", run: () => void requestSync({ force: true }) };
    }
  } else if (offline) {
    message = "📴 目前沒有網路，顯示的是上次同步的資料。";
  }

  if (!message && failedCount === 0) return null;

  return (
    <div style={{ marginBottom: 10 }}>
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
          <span>⚠️ 有 {failedCount} 筆紀錄上傳失敗，請到「紀錄」頁處理。</span>
          <button type="button" className="sync-bar-btn" onClick={() => navigate("/history")}>
            查看
          </button>
        </div>
      )}
    </div>
  );
}
