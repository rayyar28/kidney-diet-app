import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiBase, normalizeApiBase, setApiBase } from "../api/config";

/**
 * 試用版專用：設定要連哪一台後端伺服器。
 *
 * 正式發給病人的版本會在建置時用 VITE_API_BASE_URL 寫死網址，這個畫面
 * 不會出現（needsApiBaseSetup() 會是 false，也不會有人導到這裡）。
 * 留這個畫面是為了讓同一個試用版 APK 可以先連開發電腦，之後正式伺服器
 * 架好再改指過去，不必重新打包、重新安裝。
 */
export function ServerSetupPage({ onSaved }: { onSaved?: () => void } = {}) {
  const navigate = useNavigate();
  const current = getApiBase();
  const [input, setInput] = useState(current === "/api" ? "" : current);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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
          <h1 className="page-title">伺服器設定</h1>
          <p className="page-hint">試用版才需要，正式版不會看到這一頁</p>
        </div>
      </div>

      <div className="page">
        <div className="field">
          <label className="label">後端網址</label>
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
        <p className="page-hint">
          可以只輸入網域，系統會自動補上 <code>https://</code> 與結尾的 <code>/api</code>。
        </p>

        {result && (
          <p className={result.ok ? "page-hint" : "error-text"} style={result.ok ? { color: "var(--color-primary)", fontWeight: 700 } : undefined}>
            {result.ok ? "✓ " : "✕ "}
            {result.message}
          </p>
        )}
      </div>

      <div className="page-footer">
        <button className="btn btn-primary" onClick={testAndSave} disabled={testing}>
          {testing ? "測試連線中…" : "測試並儲存"}
        </button>
        <button className="btn btn-ghost" onClick={() => navigate("/login")}>
          返回
        </button>
      </div>
    </div>
  );
}
