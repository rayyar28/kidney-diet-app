import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.middleware.js";
import { HttpError } from "../middleware/error.middleware.js";
import { storageService } from "../services/storage.service.js";

export const photosRouter = Router();
photosRouter.use(requireAuth);

// 回傳照片實體檔案。只有照片本人或 RESEARCHER/ADMIN 角色可以讀取，
// 避免病人的飲食照片被其他病人看到。
photosRouter.get("/:id/file", async (req: AuthedRequest, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({ where: { id: req.params.id } });
    if (!photo) throw new HttpError(404, "找不到這張照片");

    const isOwner = photo.userId === req.user!.id;
    const isStaff = req.user!.role === "RESEARCHER" || req.user!.role === "ADMIN";
    if (!isOwner && !isStaff) throw new HttpError(403, "沒有權限讀取這張照片");

    const buffer = await storageService.read(photo.storageKey);
    res.setHeader("Content-Type", photo.mimeType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});
