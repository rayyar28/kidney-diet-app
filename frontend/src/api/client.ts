import { useAuthStore } from "../store/auth";
import { getApiBase } from "./config";

/**
 * API 位址的決定邏輯集中在 ./config.ts。
 *
 * 網頁版開發時是相對路徑 "/api"，由 vite.config.ts 的 proxy 轉給本機後端；
 * 正式環境用建置時的 VITE_API_BASE_URL；打包成 App 的試用版則可以在
 * App 內設定（因為 App 裡沒有 proxy，而試用階段後端還沒有固定網址）。
 *
 * 注意：這裡每次都重新呼叫 getApiBase()，不快取成模組層級的常數，
 * 這樣使用者在 App 裡改了網址之後不用重開 App 就會生效。
 */

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * 連不上伺服器 (沒網路、訊號中斷、DNS 失敗、請求逾時)。跟 ApiError 分開，
 * 因為離線同步要靠它判斷「這不是資料有問題，稍後重試就好」。
 */
class NetworkError extends Error {
  constructor(message = "無法連線到伺服器") {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // fetch 在連不上時丟 TypeError；逾時是我們自己 abort 的 AbortError
    if (err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError")) {
      throw new NetworkError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// refresh token 是「一次性、用了就撤銷」的，如果好幾個請求同時收到 401、
// 各自獨立呼叫 refresh，只有最先送達的那個會成功，其他幾個會拿著已經被撤銷
// 的 token 失敗，進而把剛剛才寫進去的新 token 又清掉、把病人整個登出。
// 用一個共用的 in-flight promise，讓同時發生的 401 共享同一次 refresh 結果。
let refreshPromise: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = doRefreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function doRefreshAccessToken(): Promise<boolean> {
  const { refreshToken, setTokens, clearAuth } = useAuthStore.getState();
  if (!refreshToken) return false;
  // 連不上時 fetchWithTimeout 會丟 NetworkError，直接往外傳，不能當成「登入失效」
  const res = await fetchWithTimeout(
    `${getApiBase()}/auth/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    },
    DEFAULT_TIMEOUT_MS
  );
  if (!res.ok) {
    // 只有伺服器明確說「這個 refresh token 不行」才登出。伺服器暫時掛掉 (5xx)、
    // 被限流 (429) 時不能登出，否則弱網/伺服器重啟時會把病人整個登出，
    // 還沒上傳的離線資料也就沒辦法補傳了。
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      clearAuth();
      return false;
    }
    // 一律回報成 503 (暫時不可用)：換發失敗是伺服器的問題，不是「這一筆資料有問題」，
    // 同步佇列看到 503 會整個停下來稍後重試，而不是把正在上傳的那一餐誤判成可疑。
    throw new ApiError(503, "暫時無法更新登入狀態，請稍後再試");
  }
  const data = await res.json();
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  isForm?: boolean;
  skipAuth?: boolean;
  /** 上傳照片要給比較長的時間 (弱網下一張幾 MB 的照片) */
  timeoutMs?: number;
}

async function request<T>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (accessToken && !opts.skipAuth) headers.Authorization = `Bearer ${accessToken}`;

  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await fetchWithTimeout(
    `${getApiBase()}${path}`,
    { method: opts.method ?? "GET", headers, body },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  if (res.status === 401 && retry && !opts.skipAuth) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, opts, false);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, data.error ?? "發生錯誤");
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, opts: Partial<RequestOptions> = {}) =>
    request<T>(path, { ...opts, method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/**
 * 照片是受保護的資源，<img src> 沒辦法帶 Authorization header，
 * 所以改成 fetch 二進位內容後轉成 blob: URL。呼叫端記得在 unmount 時
 * revokeObjectURL 釋放記憶體 (見 components/AuthedImage.tsx)。
 *
 * 正式環境後端會回 302 轉址到 R2 的簽名網址，fetch 會自動跟著轉址，
 * 瀏覽器在跨網域轉址時會拿掉 Authorization header（這是我們要的行為，
 * R2 的簽名網址本身就帶了授權資訊）。
 */
export async function fetchPhotoBlobUrl(photoId: string, retry = true): Promise<string> {
  const { accessToken } = useAuthStore.getState();
  const res = await fetchWithTimeout(
    `${getApiBase()}/photos/${photoId}/file`,
    { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
    DEFAULT_TIMEOUT_MS
  );
  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return fetchPhotoBlobUrl(photoId, false);
  }
  if (!res.ok) throw new ApiError(res.status, "無法載入照片");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export { ApiError, NetworkError };
