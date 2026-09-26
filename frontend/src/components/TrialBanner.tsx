import { useAuthStore } from "../store/auth";

/**
 * 試用模式的常駐提示。放在畫面主體最上方，佔的位置跟 SyncStatusBar 一樣
 * （試用模式下 SyncStatusBar 永遠不會出現，兩者不會同時佔版面）。
 *
 * 為什麼一定要有：試用者按完「完成這一餐」看到點數增加，很容易以為資料已經送出去了。
 * 這一行是提醒他們「這只是試用，紀錄沒有上傳」，避免之後有人以為資料存在伺服器上。
 *
 * 個人頁不放這一條——那一頁的副標題本來就寫著同一句話，再加一條會讓徽章牆被擠出畫面。
 */
export function TrialBanner() {
  const trial = useAuthStore((s) => s.mode === "trial");
  if (!trial) return null;

  return (
    <div className="sync-bar sync-bar-trial">
      <span>🧪 試用模式，資料只存在這支手機</span>
    </div>
  );
}
