import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { useToastStore } from "../store/toast";
import { importTrialMeals, markTrialImportAsked, pendingTrialImportCount } from "../trial/trialData";

/**
 * 登入後問一次：要不要把試用模式記錄的紀錄帶進這個帳號。
 *
 * **為什麼要問，不直接搬**：App 沒辦法分辨「試用的人」跟「登入的人」是不是同一位。
 * 衛教師常常先用自己的手機試用，之後才讓病人在同一支手機登入——那些測試照片
 * 不該混進病人的資料裡。所以把決定權交給當下看著畫面的人。
 *
 * 帶進來的紀錄只留在這支手機、**不會上傳**（見 trial/trialData.ts 的 importTrialMeals）。
 */
export function ImportTrialPage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const showToast = useToastStore((s) => s.show);
  const [count, setCount] = useState<number | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void pendingTrialImportCount(user.id).then((n) => {
      if (cancelled) return;
      // 沒有東西可帶（例如重新整理後又進到這一頁）就不要卡住使用者
      if (n === 0) navigate("/", { replace: true });
      else setCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [user, navigate]);

  async function accept() {
    if (!user || working) return;
    setWorking(true);
    try {
      const moved = await importTrialMeals(user.id);
      showToast(`已帶入 ${moved} 筆試用紀錄`);
    } catch {
      showToast("帶入失敗，紀錄仍然留在試用模式裡");
    } finally {
      navigate("/", { replace: true });
    }
  }

  function decline() {
    if (!user) return;
    // 只記「問過了」，不刪資料：使用者可能只是這次不想帶，下次進試用模式還看得到
    markTrialImportAsked(user.id);
    navigate("/", { replace: true });
  }

  if (count === null) return null;

  return (
    <div className="app-shell">
      <div className="page page-center">
        <div style={{ fontSize: 64 }}>🧪</div>
        <h1 className="page-title">發現 {count} 筆試用紀錄</h1>
        <p style={{ margin: 0, maxWidth: 300 }}>
          要把它們一起帶進「{user?.displayName}」的帳號嗎？
        </p>
        <p className="page-hint" style={{ maxWidth: 300 }}>
          帶進來之後，這些紀錄會出現在日曆和點數裡，但只會留在這支手機，
          <strong>不會上傳到伺服器</strong>。
        </p>
      </div>

      <div className="page-footer">
        <button className="btn btn-primary" onClick={accept} disabled={working}>
          {working ? "處理中…" : "✓ 好，帶進來"}
        </button>
        <button className="btn btn-ghost" onClick={decline} disabled={working}>
          不用，留在試用模式
        </button>
      </div>
    </div>
  );
}
