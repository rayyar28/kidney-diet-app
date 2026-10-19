import crypto from "crypto";
import path from "path";
import sharp from "sharp";
import { Prisma, type Photo } from "@prisma/client";
import { prisma } from "../prisma.js";
import { storageService } from "./storage.service.js";
import { HttpError } from "../middleware/error.middleware.js";

export interface IncomingPhoto {
  buffer: Buffer;
  originalFileName?: string;
  mimeType: string;
  capturedAt: Date;
  tzOffsetMinutes: number | null;
  deviceUserAgent: string | null;
  /** 前端回報：這張照片是在沒網路時拍下、排隊等待上傳的 */
  capturedOffline: boolean;
  /** 前端送出這個請求當下的裝置時間，用來估算手機時鐘偏差 */
  clientSentAt: Date | null;
}

const INT32_MAX = 2_147_483_647;

/**
 * 依檔案開頭的魔術位元組判斷真實格式，只放行 JPEG / PNG / WEBP / HEIF。
 * 不能只信客戶端宣告的 Content-Type：否則 SVG (可夾帶腳本、且會走 librsvg 解析)、
 * GIF、TIFF 等格式只要宣告成 image/jpeg 就能上傳。這個檢查在丟給 sharp 解析「之前」做，
 * 不允許的格式根本不會進到圖片解析器。
 */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
function sniffImageFormat(buf: Buffer): "jpeg" | "png" | "webp" | "heif" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 4, 8) === "ftyp" && HEIF_BRANDS.has(buf.toString("ascii", 8, 12))) return "heif";
  return null;
}

/**
 * 去掉照片裡所有的中繼資料（EXIF，含 GPS 座標、拍攝裝置序號等），重新編碼成 JPEG。
 *
 * **為什麼在伺服器上一定要做這一次**：手機端壓縮照片時重新編碼，本來就會順便去掉 EXIF，
 * 但有三種情況手機會直接送原檔：解碼失敗（例如 HEIC）、壓完反而比較大、瀏覽器不支援。
 * 這時 GPS 會原封不動進到研究資料庫——病患在家拍的照片，等於記下了他家的座標。
 * 在伺服器這裡統一處理，不管手機端發生什麼事，存下來的照片都保證不含 EXIF。
 *
 * 先 rotate() 再丟掉中繼資料：手機照片的「直拍/橫拍」記在 EXIF 的 Orientation 裡，
 * 沒有先依它把像素轉正，直拍的照片丟掉 EXIF 之後會變成橫躺。
 * sharp 輸出時預設不帶任何中繼資料（除非呼叫 withMetadata / keepExif），這裡刻意不呼叫。
 *
 * 判斷「重送」用的 sha256 仍然是手機送來的原檔（呼叫端計算），不受這裡影響：
 * 同一張照片重送，原檔一樣、雜湊就一樣。
 */
async function stripMetadata(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  try {
    const { data, info } = await sharp(input)
      .rotate()
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) throw new Error("no dimensions");
    return { buffer: data, width: info.width, height: info.height };
  } catch {
    // 這台伺服器的 sharp 不支援 HEIC（只認 AVIF），HEIC 會在這裡被拒絕。
    // App 內建的相機一律產生 JPEG，所以只有「從相簿選 HEIC、手機又轉不了」才會遇到。
    throw new HttpError(400, "無法處理這張照片的格式，請改用 App 裡的相機拍照");
  }
}

function resolveExisting(existing: Photo, sha256Hash: string): { photo: Photo; replayed: true } {
  if (existing.sha256Hash !== sha256Hash) {
    throw new HttpError(409, "這筆用餐紀錄的這個階段已經有另一張不同的照片");
  }
  return { photo: existing, replayed: true };
}

/**
 * 把一張上傳的照片存起來、抽取研究用的中繼資料、並建立對應的
 * Photo + NutritionEstimate(佔位) 資料列。
 *
 * 這個函式可以安全地重送 (idempotent)：同一筆紀錄的同一個階段，如果已經有
 * 內容相同 (sha256 相同) 的照片，直接回傳既有的照片 (replayed: true)，不會
 * 重複儲存；內容不同則回 409。離線補傳時網路可能在「伺服器處理完」與「手機
 * 收到回應」之間中斷，手機會重送同一個請求，靠這個機制保證不會產生重複資料。
 */
export async function ingestPhoto(params: {
  userId: string;
  mealRecordId: string;
  phase: "PRE_MEAL" | "POST_MEAL";
  photo: IncomingPhoto;
}): Promise<{ photo: Photo; replayed: boolean }> {
  const { userId, mealRecordId, phase, photo } = params;

  const sha256Hash = crypto.createHash("sha256").update(photo.buffer).digest("hex");

  const existing = await prisma.photo.findUnique({
    where: { mealRecordId_phase: { mealRecordId, phase } },
  });
  if (existing) return resolveExisting(existing, sha256Hash);

  if (!sniffImageFormat(photo.buffer)) {
    throw new HttpError(400, "只接受 JPEG / PNG / WEBP / HEIC 格式的照片");
  }

  const clean = await stripMetadata(photo.buffer);

  // 檔名不含時間戳：同一筆紀錄的同一階段永遠是同一個 key，重送時覆蓋同一個檔案，
  // 不會在儲存空間留下孤兒檔案。存下來的一律是 JPEG（見 stripMetadata）。
  const keyHint = path.posix.join(userId, mealRecordId, `${phase.toLowerCase()}.jpg`);
  const storageKey = await storageService.save({
    buffer: clean.buffer,
    keyHint,
    contentType: "image/jpeg",
  });

  // 欄位是 32 位元整數；時鐘偏差極端時夾在範圍內，避免溢位變成 500
  const clientClockSkewSeconds = photo.clientSentAt
    ? Math.max(-INT32_MAX, Math.min(INT32_MAX, Math.round((Date.now() - photo.clientSentAt.getTime()) / 1000)))
    : null;

  try {
    const created = await prisma.photo.create({
      data: {
        userId,
        mealRecordId,
        phase,
        storageKey,
        originalFileName: photo.originalFileName,
        // 記的是「實際存下來的那個檔案」：格式、大小、轉正之後的寬高
        mimeType: "image/jpeg",
        fileSizeBytes: clean.buffer.length,
        widthPx: clean.width,
        heightPx: clean.height,
        sha256Hash,
        capturedAt: photo.capturedAt,
        clientTimezoneOffsetMin: photo.tzOffsetMinutes,
        capturedOffline: photo.capturedOffline,
        clientClockSkewSeconds,
        deviceUserAgent: photo.deviceUserAgent,
        nutritionEstimate: { create: {} }, // status 預設 NOT_STARTED，等未來辨識模型接上
      },
    });
    return { photo: created, replayed: false };
  } catch (err) {
    // 兩個相同的請求同時到達：另一個請求先寫入了，這裡改為回傳它寫入的結果
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.photo.findUnique({
        where: { mealRecordId_phase: { mealRecordId, phase } },
      });
      if (winner) return resolveExisting(winner, sha256Hash);
    }
    throw err;
  }
}
