import multer from "multer";
import { HttpError } from "./error.middleware.js";

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB，手機相機原圖也綽綽有餘
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new HttpError(400, "只接受 JPEG / PNG / WEBP / HEIC 格式的照片"));
      return;
    }
    cb(null, true);
  },
});
