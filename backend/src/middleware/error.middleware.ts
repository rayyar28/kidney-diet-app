import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "輸入資料格式錯誤", details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "照片檔案太大了 (上限 15MB)" : "照片上傳失敗";
    return res.status(400).json({ error: message });
  }
  // body-parser 對格式錯誤的 JSON body 會丟出帶 statusCode/expose 的錯誤 (非 HttpError 實例)，
  // 沒有特別處理的話會被底下的 catch-all 誤判成伺服器錯誤，回錯成 500。
  if (
    err instanceof Error &&
    "statusCode" in err &&
    "expose" in err &&
    (err as { expose?: unknown }).expose === true &&
    typeof (err as { statusCode?: unknown }).statusCode === "number"
  ) {
    const statusCode = (err as { statusCode: number }).statusCode;
    return res.status(statusCode).json({ error: "請求格式錯誤" });
  }
  console.error(err);
  return res.status(500).json({ error: "伺服器發生未預期的錯誤" });
}
