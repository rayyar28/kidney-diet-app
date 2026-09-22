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
 * 上傳前壓縮照片的目標：最長邊 1600px、JPEG 品質 0.82。
 *
 * 為什麼要壓：離線模式下照片會留在手機裡直到下次連上伺服器。以原始 4K 照片
 * (單張 2~4MB) 計算，病人若兩三個月才回診一次，手機裡會囤到 1.5GB 以上，
 * 年長病人常用的入門機根本放不下。壓過之後大約是原本的 1/10。
 *
 * 為什麼是 1600px：食物辨識模型的輸入通常在 224~640px，1600px remains 綽綽有餘，
 * 未來要換更大的模型也還有餘裕；再往上只是浪費病人的儲存空間與流量。
 *
 * 附帶效果：用 canvas 重新編碼會把原始 EXIF 一併去掉，其中包含 GPS 座標——
 * 這正好也完成了「照片去識別化」這項 IRB 前置工作。但也代表**未來若要改用
 * EXIF 的拍攝時間，必須在壓縮之前先讀出來**，否則資訊已經被移除。
 */
const UPLOAD_MAX_EDGE = 1600;
const UPLOAD_JPEG_QUALITY = 0.82;

/**
 * 算出縮放後的尺寸。比目標小的照片不放大（放大只會變糊又變大）。
 * 抽成純函式是為了可以單獨測試，不需要瀏覽器環境。
 */
export function computeTargetSize(
  width: number,
  height: number,
  maxEdge: number = UPLOAD_MAX_EDGE
): { width: number; height: number; changed: boolean } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, changed: false };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    changed: true,
  };
}

/**
 * 壓縮照片。任何一步失敗（例如瀏覽器解不開 HEIC）都回傳原檔，
 * 寧可佔空間也不要讓病人的照片上傳不了。
 */
export async function compressImage(file: File): Promise<File> {
  try {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
    const bitmap = await createImageBitmap(file);
    const target = computeTargetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", UPLOAD_JPEG_QUALITY)
    );
    // 壓完反而更大就用原檔（小圖、或本來就壓得很好的 JPEG 會這樣）
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

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
