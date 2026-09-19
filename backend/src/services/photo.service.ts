import crypto from "crypto";
import path from "path";
import sharp, { type Metadata } from "sharp";
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

  let metadata: Metadata;
  try {
    metadata = await sharp(photo.buffer).metadata();
  } catch {
    throw new HttpError(400, "無法解析這張圖片，請確認檔案是有效的照片格式");
  }
  if (!metadata.width || !metadata.height) {
    throw new HttpError(400, "無法讀取照片的像素尺寸");
  }

  const ext = (metadata.format ?? "jpg").replace("jpeg", "jpg");
  // 檔名不含時間戳：同一筆紀錄的同一階段永遠是同一個 key，重送時覆蓋同一個檔案，
  // 不會在儲存空間留下孤兒檔案。
  const keyHint = path.posix.join(userId, mealRecordId, `${phase.toLowerCase()}.${ext}`);
  const storageKey = await storageService.save({
    buffer: photo.buffer,
    keyHint,
    contentType: photo.mimeType,
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
        mimeType: photo.mimeType,
        fileSizeBytes: photo.buffer.length,
        widthPx: metadata.width,
        heightPx: metadata.height,
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
