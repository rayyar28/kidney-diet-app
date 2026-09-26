import { registerPlugin } from "@capacitor/core";
import { isNativeApp } from "../api/config";
import { compressImage } from "../offline/util";

/**
 * 把 App 內拍的照片另存一份到手機相簿。
 *
 * 為什麼要做：病人（和幫忙測試的護理師）會期待「用這個 App 拍的東西，我在相簿裡找得到」，
 * 就像用一般相機 App 拍照一樣。App 自己的資料庫存的是壓縮過的版本、而且在 App 裡才看得到，
 * 那不是他們認知中的「存在手機裡」。
 *
 * 三個刻意的決定：
 *
 * 1. **只存「用這個 App 的相機拍的」照片。** 從相簿挑的照片本來就已經在相簿裡了，
 *    再存一份只會製造重複。
 * 2. **存壓縮後的版本（最長邊 1600px），不是原始檔。** 三個理由：
 *    - 原始 4K 照片有 2~4MB，轉成 base64 要 5MB 以上才能通過 Capacitor 的 JS↔原生橋接，
 *      入門機很容易因此卡頓甚至記憶體不足。壓縮後只有 200KB 左右。
 *    - 1600px 比任何手機螢幕都大，病人在相簿裡看不出差別，但省下大約 15 倍的空間。
 *    - 壓縮時 EXIF 會被移除，所以相簿這份**不含 GPS 座標**。這很重要：相簿裡的照片
 *      多半會被 Google 相簿自動備份到雲端，帶著住家座標上雲不是我們想要的結果。
 *    代價是同一張照片會被壓縮兩次（一次給 App、一次給相簿）。兩次都是從原始檔壓的，
 *    所以沒有畫質疊加損失，只是多花一點 CPU；之後若要省掉，可以把「照片來源」一路傳到
 *    mealStore.buildSlot()，在那裡壓縮完順便存相簿。
 * 3. **一律盡力而為。** 存相簿失敗（沒權限、空間不足、系統拒絕）只會安靜地回 false，
 *    絕對不能影響到「病人記錄這一餐」這件事——照片在 App 的資料庫裡已經是安全的。
 */

interface PhotoGalleryPlugin {
  save(options: { dataUrl: string; fileName?: string; album?: string }): Promise<SaveResult>;
}

interface SaveResult {
  saved: boolean;
  uri?: string;
  /** saved 為 false 時的原因，只拿來寫 console，不給使用者看 */
  reason?: string;
}

const PhotoGallery = registerPlugin<PhotoGalleryPlugin>("PhotoGallery");

/** 這個裝置有沒有可能存進相簿（網頁版沒有相簿可以存） */
export function canSaveToGallery(): boolean {
  return isNativeApp();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("讀取照片失敗"));
    reader.readAsDataURL(blob);
  });
}

/** 檔名用拍攝時間，病人在相簿裡看得出是哪一餐；不含路徑分隔字元等危險字元 */
export function galleryFileName(capturedAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${capturedAt.getFullYear()}${pad(capturedAt.getMonth() + 1)}${pad(capturedAt.getDate())}`;
  const time = `${pad(capturedAt.getHours())}${pad(capturedAt.getMinutes())}${pad(capturedAt.getSeconds())}`;
  return `meal-${date}-${time}.jpg`;
}

/**
 * 存一份到相簿。永遠不會 throw：回傳 false 代表沒存成功，呼叫端直接忽略即可。
 */
export async function saveCameraPhotoToGallery(file: File, capturedAt: Date): Promise<boolean> {
  if (!canSaveToGallery()) return false;
  try {
    const dataUrl = await blobToDataUrl(await compressImage(file));
    const result = await PhotoGallery.save({ dataUrl, fileName: galleryFileName(capturedAt) });
    if (!result.saved) console.warn("[gallery] 沒有存進相簿", result.reason);
    return result.saved;
  } catch (err) {
    console.warn("[gallery] 存進相簿失敗", err);
    return false;
  }
}
