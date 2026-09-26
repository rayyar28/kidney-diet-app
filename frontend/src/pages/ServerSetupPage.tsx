import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBase, normalizeApiBase, setApiBase } from "../api/config";
import { useAuthStore } from "../store/auth";

/**
 * App 第一次開啟時的入口：選擇「直接試用」還是「連到伺服器」。
 *
 * 兩條路的用途不同：
 * - **直接試用**：給護理師/衛教師測試介面用。不需要網址、不需要帳號，
 *   所有紀錄只存在這支手機。要讓人願意花時間幫忙試用，第一步就不能是填網址。
 * - **連到伺服器**：給開發/demo 用，也是之後真正收資料的路。
 *
 * 正式發給病人的版本會在建置時用 VITE_API_BASE_URL 寫死網址，這個畫面不會出現
 * （needsApiBaseSetup() 會是 false）。留這個畫面是為了讓同一個試用版 APK 可以先連
 * 開發電腦，之後正式伺服器架好再改指過去，不必重新打包、重新安裝。
 */
export function ServerSetupPage({ onSaved }: { onSaved?: () => void } = {}) {
  const navigate = useNavigate();
  const startTrial = useAuthStore((s) => s.startTrial);
  const current = getApiBase();
  const [input, setInput] = useState(current === "/api" ? "" : current);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // onSaved 只有在「App 啟動時強制顯示這一頁」的情況下才會傳進來。
  // 那時候整個路由只有這一頁，按「返回」跳到 /login 也還是會回到這裡，所以不顯示。
  const isFirstRun = onSaved !== undefined;

  function beginTrial() {
    // 切到試用模式後 App 會重新 render 並放行路由（見 App.tsx 的 needsSetup 判斷）
    startTrial();
    navigate("/", { replace: true });
  }

  async function testAndSave() {
    const url = normalizeApiBase(input);
    if (!url) {
      setResult({ ok: false, message: "請先輸入網址" });
      return;
    }
    setTesting(true);
    setResult(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        setResult({ ok: false, message: `伺服器有回應，但狀態不正常（${res.status}）` });
        return;
      }
      setApiBase(url);
      setResult({ ok: true, message: `連線成功，已設定為 ${url}` });
      setTimeout(() => {
        onSaved?.(); // 讓 App 離開「只有設定頁」的狀態，否則 navigate 之後仍會停在這一頁
        navigate("/login", { replace: true });
      }, 700);
    } catch {
      setResult({ ok: false, message: "連不上這個網址，請確認伺服器已啟動、網址正確" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="top-bar">
        <div>
          <h1 className="page-title">開始使用</h1>
          <p className="page-hint">試用不需要網路，也不需要帳號</p>
        </div>
      </div>

      <div className="page">
        <button type="button" className="hero-btn" onClick={beginTrial}>
          <span className="hero-icon">🧪</span>
          <span className="hero-label">直接試用</span>
          <span className="hero-hint">紀錄只存在這支手機，不會上傳</span>
        </button>

        <div className="section-title">或：連到伺服器</div>
        <div className="field">
          <input
            className="input"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="例如 abc-def.trycloudflare.com"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        {result && (
          <p
            className={result.ok ? "page-hint" : "error-text"}
            style={result.ok ? { color: "var(--color-primary)", fontWeight: 700 } : undefined}
          >
            {result.ok ? "✓ " : "✕ "}
            {result.message}
          </p>
        )}
      </div>

      <div className="page-footer">
        <button className="btn btn-secondary" onClick={testAndSave} disabled={testing}>
          {testing ? "測試連線中…" : "測試並儲存"}
        </button>
        {!isFirstRun && (
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>
            返回
          </button>
        )}
      </div>
    </div>
  );
}
