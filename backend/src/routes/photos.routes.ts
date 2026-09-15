import { Router } from "express";
import { prisma } from "../prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.middleware.js";
import { HttpError } from "../middleware/error.middleware.js";
import { storageService } from "../services/storage.service.js";
import { env } from "../config/env.js";

export const photosRouter = Router();
photosRouter.use(requireAuth);

/**
 * 回傳照片實體檔案。只有照片本人或 RESEARCHER/ADMIN 角色可以讀取，
 * 避免病人的飲食照片被其他病人看到。
 *
 * 權限檢查通過後有兩條路：
 *   1. 儲存後端支援簽名網址（R2）→ 302 轉址，讓瀏覽器直接跟 R2 拿檔案。
 *      照片流量不經過後端，既快又不會算在後端的頻寬費上。
 *   2. 不支援（本機磁碟）→ 後端讀檔後直接送出，維持原本的行為。
 *
 * 不論走哪一條，「這個人能不能看這張照片」都是後端說了算。
 */
photosRouter.get("/:id/file", async (req: AuthedRequest, res, next) => {
  try {
    const photo = await prisma.photo.findUnique({
      where: { id: req.params.id },
      include: { mealRecord: { select: { deletedAt: true } } },
    });
    if (!photo) throw new HttpError(404, "找不到這張照片");

    const isOwner = photo.userId === req.user!.id;
    const isStaff = req.user!.role === "RESEARCHER" || req.user!.role === "ADMIN";
    if (!isOwner && !isStaff) throw new HttpError(403, "沒有權限讀取這張照片");

    // 病人「刪除」過的紀錄，資料仍保留供研究使用，但病人端不應該再讀得到。
    // 研究人員 (RESEARCHER/ADMIN) 不受這個限制。
    if (photo.mealRecord?.deletedAt && !isStaff) {
      throw new HttpError(404, "找不到這張照片");
    }

    const signedUrl = await storageService.getSignedReadUrl(
      photo.storageKey,
      env.signedUrlTtlSeconds
    );
    if (signedUrl) {
      return res.redirect(302, signedUrl);
    }

    const buffer = await storageService.read(photo.storageKey);
    res.setHeader("Content-Type", photo.mimeType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});
