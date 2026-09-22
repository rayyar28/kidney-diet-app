/**
 * crypto.randomUUID 只在安全連線 (HTTPS / localhost) 才有；病人若用一般 HTTP 網址
 * (例如區網測試) 開啟時會是 undefined，所以要有備援。
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isBrowserOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

const THUMB_MAX_EDGE = 320;

/**
 * 產生小縮圖 (data URL)。離線時本機沒有伺服器可以載照片，歷史紀錄靠這張縮圖顯示；
 * 原始大圖上傳成功後就會被刪掉以節省手機空間。失敗 (例如瀏覽器解不開 HEIC) 回 null，
 * 畫面會顯示灰色佔位，不影響上傳。
 */
export async function makeThumbnail(blob: Blob): Promise<string | null> {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

/** 請瀏覽器「不要在儲存空間吃緊時清掉我們的資料」，離線佇列裡的照片不能被系統默默清掉 */
let persistRequested = false;
export function requestPersistentStorage(): void {
  if (persistRequested) return;
  persistRequested = true;
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* 不支援就算了 */
  }
}
