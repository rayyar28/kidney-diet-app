import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { HttpError } from "../middleware/error.middleware.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.middleware.js";
import { issueStaffReset } from "../services/passwordReset.service.js";

/**
 * 衛教師 / 研究人員專用的端點。
 *
 * 為什麼需要這條路：email 重設對這群病人不見得管用——年長病人的信箱常常是家人幫忙
 * 申請的、密碼早就忘了，或者根本不會去收信。他們回診時當面跟衛教師說「我登不進去」，
 * 衛教師當場開一組代碼唸給他，是最實際、也是身分驗證最強的一條路（當面看到本人）。
 *
 * 角色不是自助申請的：註冊一律是 PATIENT，要變成 RESEARCHER/ADMIN 只能由管理者
 * 在伺服器上執行 `npm run grant-role`。
 */
export const staffRouter = Router();

const issueSchema = z.object({ email: z.string().email() });

/**
 * 幫某個病人開一組重設代碼。
 *
 * 回應會帶出代碼本身（這是整個系統唯一會把代碼交出去的地方），所以：
 * - 必須是 RESEARCHER / ADMIN
 * - 會記錄 issuedById，之後稽核時看得出是誰幫誰開的
 */
staffRouter.post(
  "/password-resets",
  requireAuth,
  requireRole("RESEARCHER", "ADMIN"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = issueSchema.parse(req.body);
      const issued = await issueStaffReset({ email: body.email, issuedById: req.user!.id });
      // 這裡可以明講「查無此帳號」：操作者已經通過身分驗證，而且他需要知道是不是打錯了。
      // 跟對外的 /auth/forgot-password 不同，那裡才有列舉風險。
      if (!issued) throw new HttpError(404, "找不到這個 email 的帳號");

      res.json({
        code: issued.code,
        expiresAt: issued.expiresAt.toISOString(),
        expiresInMinutes: Math.round(env.passwordResetExpiresMs / 60_000),
        user: { email: issued.user.email, displayName: issued.user.displayName },
      });
    } catch (err) {
      next(err);
    }
  }
);
