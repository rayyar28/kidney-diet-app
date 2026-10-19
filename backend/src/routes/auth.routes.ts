import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { HttpError } from "../middleware/error.middleware.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt.js";
import { env } from "../config/env.js";
import {
  forgotPasswordLimiter,
  loginLimiter,
  registerLimiter,
  resetPasswordLimiter,
} from "../middleware/rateLimit.middleware.js";
import { getMailer } from "../services/mailer.service.js";
import { buildResetUrl, requestSelfServiceReset, resetPasswordWithCode } from "../services/passwordReset.service.js";
import { findUserByAccount, publicUser, readAccount, verifyPassword } from "../domain/account.js";

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "密碼至少需要 8 個字元"),
  displayName: z.string().min(1).max(50),
});

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * 資料庫這一筆 refresh token 的到期時間。必須跟 JWT 本身的效期一致，
 * 所以兩邊都從 JWT_REFRESH_EXPIRES_IN 這一個設定算出來（見 config/env.ts）。
 */
function refreshExpiryDate(): Date {
  return new Date(Date.now() + env.jwtRefreshExpiresMs);
}

async function issueTokenPair(userId: string, role: string) {
  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = signRefreshToken({ sub: userId, role });
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiryDate(),
    },
  });
  return { accessToken, refreshToken };
}

/**
 * 自己註冊帳號。**正式環境（醫院）是關閉的**：收案帳號一律由衛教師建立（見 staff.routes.ts
 * 的 POST /patients），否則院內訪客 Wi-Fi 上任何拿到 APK 的人都能開帳號、上傳照片到研究資料庫。
 * 只有本機開發與檢查腳本會用 ALLOW_PUBLIC_REGISTRATION=true 打開。
 */
authRouter.post("/register", registerLimiter, async (req, res, next) => {
  try {
    if (!env.allowPublicRegistration) {
      throw new HttpError(403, "帳號由衛教師建立，請洽衛教師");
    }
    const body = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) {
      throw new HttpError(409, "這個 email 已經被註冊過了");
    }
    const passwordHash = await bcrypt.hash(body.password, 10);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        displayName: body.displayName,
      },
    });
    await prisma.userStreak.create({ data: { userId: user.id } });

    const tokens = await issueTokenPair(user.id, user.role);
    res.status(201).json({ user: publicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

const passwordField = z.object({ password: z.string() });

/**
 * 登入：帳號可以是研究編號（病人）或 email（衛教師、舊帳號）。
 * 新版 App 送 `account`，舊版送 `email`，兩個都收（見 domain/account.ts 的 readAccount）。
 */
authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const account = readAccount(req.body);
    const { password } = passwordField.parse(req.body);
    const user = await findUserByAccount(account);
    // 帳號不存在也照樣做一次密碼比對，「沒有這個編號」跟「密碼錯」要花一樣久、回一樣的話。
    // 研究編號是 P0001、P0002 這種流水號，回應時間不能洩漏哪些編號已經收案。
    const valid = await verifyPassword(user?.passwordHash ?? null, password);
    if (!user || !valid) {
      throw new HttpError(401, "帳號或密碼錯誤");
    }
    const tokens = await issueTokenPair(user.id, user.role);
    res.json({ user: publicUser(user), ...tokens });
  } catch (err) {
    next(err);
  }
});

const refreshSchema = z.object({ refreshToken: z.string() });

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body);
    const payload = verifyRefreshToken(body.refreshToken);
    const tokenHash = hashToken(body.refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new HttpError(401, "refresh token 無效，請重新登入");
    }
    // 輪替 refresh token：舊的作廢、發一組新的
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    const tokens = await issueTokenPair(payload.sub, payload.role);
    res.json(tokens);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body);
    const tokenHash = hashToken(body.refreshToken);
    await prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// 忘記密碼
// ---------------------------------------------------------------------------

const forgotSchema = z.object({ email: z.string().email() });

/**
 * 申請重設密碼。
 *
 * **不論這個信箱有沒有註冊，一律回 204。** 如果對沒註冊的信箱回不同的結果，
 * 任何人都可以拿這個端點逐一測試「某某人是不是這個腎臟病研究的受試者」——
 * 那是會洩漏病情的資訊。
 *
 * 寄信不等它完成就先回應，一來避免「有帳號的請求明顯比較慢」這種時間差也變成線索，
 * 二來寄信商暫時掛掉不該讓病人看到錯誤（他該做的事已經做完了）。
 */
authRouter.post("/forgot-password", forgotPasswordLimiter, async (req, res, next) => {
  try {
    // 關閉時對每一個請求都回同一句話，不看信箱是什麼——跟開啟時一樣，不能透露帳號存不存在
    if (!env.allowEmailPasswordReset) {
      throw new HttpError(403, "請回診時找衛教師，當面幫你開一組重設代碼");
    }
    const body = forgotSchema.parse(req.body);
    const issued = await requestSelfServiceReset(body.email);
    res.status(204).send();

    if (!issued) return; // 沒這個帳號，什麼都不做（上面已經回 204 了）
    const minutes = Math.round(env.passwordResetExpiresMs / 60_000);
    void getMailer()
      .sendPasswordReset({
        to: issued.user.email,
        displayName: issued.user.label,
        code: issued.code,
        resetUrl: buildResetUrl(issued.code),
        expiresInMinutes: minutes,
      })
      .catch((err) => {
        // 寄不出去只能記在 log：不能回報給請求端，否則就等於告訴對方「這個信箱存在」
        console.error("[auth] 密碼重設信寄送失敗", err);
      });
  } catch (err) {
    next(err);
  }
});

const resetSchema = z.object({
  code: z.string().min(1).max(64),
  password: z.string().min(8, "密碼至少需要 8 個字元"),
});

/**
 * 用代碼設定新密碼。
 *
 * 代碼無效 / 已使用 / 已過期都回同一句話：分開講的話，有人就能靠錯誤訊息確認
 * 「這組代碼曾經存在」，進而推敲出代碼的產生規則。
 */
authRouter.post("/reset-password", resetPasswordLimiter, async (req, res, next) => {
  try {
    const body = resetSchema.parse(req.body);
    const outcome = await resetPasswordWithCode(body.code, body.password);
    if (!outcome.ok) {
      throw new HttpError(400, "代碼不正確或已失效，請重新申請一組");
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
