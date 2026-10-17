import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { env } from "../config/env.js";
import { prisma } from "../prisma.js";
import { HttpError } from "../middleware/error.middleware.js";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.middleware.js";
import { issueStaffReset } from "../services/passwordReset.service.js";
import { isValidPatientRef, normalizePatientRef, publicUser, readAccount } from "../domain/account.js";

/**
 * 衛教師 / 研究人員專用的端點。
 *
 * 收案流程是「衛教師當面幫病人建帳號」，病人不自己註冊（公開註冊在正式環境是關的，
 * 見 auth.routes.ts）。所以這裡有兩件事：
 *   1. 幫病人建帳號（研究編號 + 初始密碼）
 *   2. 病人忘記密碼時，當面開一組重設代碼
 *
 * 角色不是自助申請的：要變成 RESEARCHER/ADMIN 只能由管理者在主機上執行
 * `scripts/account.mjs`（醫院主機上是 6_staff_account.bat）。
 */
export const staffRouter = Router();
staffRouter.use(requireAuth, requireRole("RESEARCHER", "ADMIN"));

const createPatientSchema = z.object({
  patientRef: z.string().trim().min(1, "請輸入研究編號").max(64),
  password: z.string().min(8, "初始密碼至少需要 8 個字元"),
});

/**
 * 幫病人建帳號。
 *
 * **只存研究編號，不存姓名、病歷號、email**——這是醫院端的規定，也是送資訊室申請書上
 * 寫的資安措施。畫面上顯示的「名字」就是研究編號。
 *
 * 初始密碼由衛教師決定並當面交給病人（通常就是衛教師直接在病人手機上幫他登入）。
 * 登入狀態可以維持一年，所以多數病人之後根本不用再打密碼。
 */
staffRouter.post("/patients", async (req: AuthedRequest, res, next) => {
  try {
    const body = createPatientSchema.parse(req.body);
    const patientRef = normalizePatientRef(body.patientRef);
    if (!isValidPatientRef(patientRef)) {
      throw new HttpError(400, "研究編號只能有英文字母、數字、- 和 _（例如 P0012）");
    }
    const existing = await prisma.user.findUnique({ where: { patientRef } });
    if (existing) throw new HttpError(409, `研究編號 ${patientRef} 已經有帳號了`);

    const user = await prisma.user.create({
      data: {
        patientRef,
        passwordHash: await bcrypt.hash(body.password, 10),
        role: "PATIENT",
      },
    });
    await prisma.userStreak.create({ data: { userId: user.id } });
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    // 兩個衛教師同時建同一個編號：資料庫的 unique 會擋下第二個，給他看得懂的訊息
    if ((err as { code?: string }).code === "P2002") {
      return next(new HttpError(409, "這個研究編號剛剛已經被建立了"));
    }
    next(err);
  }
});

/**
 * 幫某個病人開一組重設代碼。帳號可以是研究編號或 email（舊帳號）。
 *
 * 為什麼需要這條路：email 重設對這群病人不見得管用——用研究編號建的帳號根本沒有 email，
 * 有 email 的長輩，信箱也常常是家人幫忙申請、密碼早就忘了。他們回診時當面跟衛教師說
 * 「我登不進去」，衛教師當場開一組代碼唸給他，是最實際、也是身分驗證最強的一條路。
 *
 * 回應會帶出代碼本身（這是整個系統唯一會把代碼交出去的地方），所以會記錄 issuedById，
 * 之後稽核時看得出是誰幫誰開的。
 */
staffRouter.post("/password-resets", async (req: AuthedRequest, res, next) => {
  try {
    const account = readAccount(req.body); // 新版 App 送 account，舊版送 email
    const issued = await issueStaffReset({ account, issuedById: req.user!.id });
    // 這裡可以明講「查無此帳號」：操作者已經通過身分驗證，而且他需要知道是不是打錯了。
    // 跟對外的 /auth/forgot-password 不同，那裡才有列舉風險。
    if (!issued) throw new HttpError(404, "找不到這個帳號");

    res.json({
      code: issued.code,
      expiresAt: issued.expiresAt.toISOString(),
      expiresInMinutes: Math.round(env.passwordResetExpiresMs / 60_000),
      user: {
        patientRef: issued.user.patientRef,
        email: issued.user.email,
        displayName: issued.user.displayName,
      },
    });
  } catch (err) {
    next(err);
  }
});
