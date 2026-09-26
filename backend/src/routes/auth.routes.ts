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

authRouter.post("/register", registerLimiter, async (req, res, next) => {
  try {
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
    res.status(201).json({
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      throw new HttpError(401, "email 或密碼錯誤");
    }
    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      throw new HttpError(401, "email 或密碼錯誤");
    }
    const tokens = await issueTokenPair(user.id, user.role);
    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role },
      ...tokens,
    });
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
    const body = forgotSchema.parse(req.body);
    const issued = await requestSelfServiceReset(body.email);
    res.status(204).send();

    if (!issued) return; // 沒這個帳號，什麼都不做（上面已經回 204 了）
    const minutes = Math.round(env.passwordResetExpiresMs / 60_000);
    void getMailer()
      .sendPasswordReset({
        to: issued.user.email,
        displayName: issued.user.displayName,
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
