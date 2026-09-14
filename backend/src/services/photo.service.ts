import crypto from "crypto";
import path from "path";
import sharp from "sharp";
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
}

/**
 * 把一張上傳的照片存起來、抽取研究用的中繼資料、並建立對應的
 * Photo + NutritionEstimate(佔位) 資料列。回傳建立好的 Photo。
 */
export async function ingestPhoto(params: {
  userId: string;
  mealRecordId: string;
  phase: "PRE_MEAL" | "POST_MEAL";
  photo: IncomingPhoto;
}) {
  const { userId, mealRecordId, phase, photo } = params;

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(photo.buffer).metadata();
  } catch {
    throw new HttpError(400, "無法解析這張圖片，請確認檔案是有效的照片格式");
  }
  if (!metadata.width || !metadata.height) {
    throw new HttpError(400, "無法讀取照片的像素尺寸");
  }

  const sha256Hash = crypto.createHash("sha256").update(photo.buffer).digest("hex");
  const ext = (metadata.format ?? "jpg").replace("jpeg", "jpg");
  const keyHint = path.posix.join(
    userId,
    mealRecordId,
    `${phase.toLowerCase()}-${Date.now()}.${ext}`
  );
  const storageKey = await storageService.save({ buffer: photo.buffer, keyHint });

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
      deviceUserAgent: photo.deviceUserAgent,
      nutritionEstimate: { create: {} }, // status 預設 NOT_STARTED，等未來辨識模型接上
    },
  });

  return created;
}
