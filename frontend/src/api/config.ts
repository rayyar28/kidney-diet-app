/**
 * 後端網址的決定順序：
 *   1. 使用者在 App 裡設定的網址（存在 localStorage）
 *   2. 建置時寫死的 VITE_API_BASE_URL
 *   3. "/api"（網頁版開發用，由 Vite proxy 轉給本機後端）
 *
 * 為什麼要讓它可以在 App 裡設定：打包成 APK 之後就沒有 Vite proxy 了，
 * App 必須知道一個完整的後端網址。試用階段後端還沒有固定位置，
 * 如果寫死就代表每次後端搬家都要重新打包、重新發一次 APK。
 * 正式發給病人的版本會用 VITE_API_BASE_URL 寫死，並且不顯示這個設定畫面。
 */

const STORAGE_KEY = "kidney-diet-api-base";

/** 建置時寫死的網址（正式版用），沒設定就是空字串 */
const BUILT_IN = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

/** 是不是跑在原生 App 裡（Capacitor 會把網頁放在 https://localhost 之類的位置） */
export function isNativeApp(): boolean {
  return Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
}

function readStored(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function getApiBase(): string {
  const stored = readStored();
  if (stored) return stored;
  if (BUILT_IN) return BUILT_IN;
  return "/api";
}

export function setApiBase(url: string): void {
  const trimmed = url.trim().replace(/\/$/, "");
  localStorage.setItem(STORAGE_KEY, trimmed);
}

export function clearApiBase(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 需不需要先請使用者設定網址：只有「在原生 App 裡、而且既沒存過也沒寫死」時才需要。
 * 網頁版永遠用相對路徑，不會被擋。
 */
export function needsApiBaseSetup(): boolean {
  return isNativeApp() && !readStored() && !BUILT_IN;
}

/** 把使用者輸入的網址補齊成可用的 API 位址（允許只輸入網域） */
export function normalizeApiBase(input: string): string {
  let url = input.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, "");
  if (!/\/api$/i.test(url)) url = `${url}/api`;
  return url;
}
