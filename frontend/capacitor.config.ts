import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor 設定：把 dist/ 的網頁包進 Android App。
 *
 * appId 一旦發佈就不能改（Android 用它辨識是不是同一個 App；改掉會變成另一個
 * App，無法覆蓋安裝，而覆蓋安裝失敗代表使用者要先解除安裝，那會清掉手機裡
 * 還沒上傳的離線紀錄）。
 */
const config: CapacitorConfig = {
  appId: "tw.edu.project.kidneydiet",
  appName: "腎臟飲食小幫手",
  webDir: "dist",
  android: {
    // 照片上傳走 https 的後端；不允許明文 http，避免病人資料在區網被竊聽。
    // 若之後真的要連區網內的 http 後端測試，要在這裡開 cleartext 例外。
    allowMixedContent: false,
  },
};

export default config;
