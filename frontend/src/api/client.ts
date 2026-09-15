import { useAuthStore } from "../store/auth";

/**
 * API 位址。
 *
 * 開發時不設 VITE_API_BASE_URL，會用相對路徑 "/api"，由 vite.config.ts 的
 * proxy 轉發到本機後端。
 *
 * 正式環境前端在 Cloudflare Pages、後端在 Render，兩者不同網域，所以要在
 * Cloudflare Pages 的環境變數設定 VITE_API_BASE_URL，例如：
 *   VITE_API_BASE_URL=https://kidney-diet-api.onrender.com/api
 *
 * 注意：Vite 的環境變數是「建置時」寫進 bundle 的，不是執行時讀取。
 * 改了這個值必須重新 build + 重新部署才會生效。
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
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
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) {
    clearAuth();
    return false;
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

  const res = await fetch(`${API_BASE}${path}`, { method: opts.method ?? "GET", headers, body });

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
  const res = await fetch(`${API_BASE}/photos/${photoId}/file`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return fetchPhotoBlobUrl(photoId, false);
  }
  if (!res.ok) throw new ApiError(res.status, "無法載入照片");
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export { ApiError };
