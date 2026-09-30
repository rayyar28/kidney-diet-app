import bcrypt from "bcryptjs";
import type { PasswordResetSource } from "@prisma/client";
import { prisma } from "../prisma.js";
import { env } from "../config/env.js";
import { generateResetCode, hashResetCode, isWellFormedResetCode, normalizeResetCode } from "../utils/resetCode.js";

/**
 * 忘記密碼的核心流程。兩條入口（病人自己申請、衛教師代開）最後都走到同一組機制：
 * 產生一次性代碼 → 驗證代碼 → 換密碼，差別只在「代碼怎麼送到病人手上」。
 *
 * 安全上的幾個決定，每一個都對應一種實際會發生的狀況：
 *
 * - **資料庫只存代碼的雜湊。** 資料庫備份外流時，光有這張表不能重設任何人的密碼。
 * - **同一個帳號同時只有一組有效代碼。** 病人常常連按好幾次「忘記密碼」，如果每次
 *   都開一組新的，舊的那幾組也還能用，等於憑空多出好幾把鑰匙。
 * - **重設成功後撤銷所有 refresh token。** 如果密碼是被別人猜到才需要重設，那個人
 *   手上的登入狀態必須一起失效，否則改密碼等於沒改。病人自己的手機會被登出，
 *   但本機還沒上傳的紀錄不會不見——重新登入後同步引擎會接著傳（見前端 offline/）。
 * - **不透露信箱存不存在。** requestSelfServiceReset 對不存在的帳號也回報成功。
 */

export interface IssuedResetCode {
  /** 已排版成 XXXXX-XXXXX，只有在「剛產生的當下」存在，之後只剩雜湊 */
  code: string;
  expiresAt: Date;
}

/** 產生一組代碼並作廢這個帳號先前還沒用過的代碼 */
async function issueCode(params: {
  userId: string;
  source: PasswordResetSource;
  issuedById?: string;
}): Promise<IssuedResetCode> {
  const code = generateResetCode();
  const expiresAt = new Date(Date.now() + env.passwordResetExpiresMs);

  await prisma.$transaction([
    // 舊的一律標記成已使用：同一個帳號同時只會有一組代碼能用
    prisma.passwordResetToken.updateMany({
      where: { userId: params.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: params.userId,
        codeHash: hashResetCode(normalizeResetCode(code)),
        source: params.source,
        issuedById: params.issuedById ?? null,
        expiresAt,
      },
    }),
  ]);

  return { code, expiresAt };
}

/**
 * 病人自己申請。回傳 null 代表「這個信箱沒有註冊」——呼叫端**必須**照樣回報成功，
 * 否則這個端點就變成一台「查這個 email 有沒有在這個研究裡」的機器。
 */
export async function requestSelfServiceReset(email: string): Promise<
  | null
  | (IssuedResetCode & {
      user: { id: string; email: string; displayName: string };
    })
> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) return null;
  const issued = await issueCode({ userId: user.id, source: "SELF_SERVICE" });
  return { ...issued, user };
}

/** 衛教師/研究人員當面確認身分後代開。找不到帳號時要明確報錯——這裡沒有列舉風險，
 *  操作者本來就已經通過身分驗證，而且他需要知道是不是打錯 email。 */
export async function issueStaffReset(params: {
  email: string;
  issuedById: string;
}): Promise<(IssuedResetCode & { user: { id: string; email: string; displayName: string } }) | null> {
  const user = await prisma.user.findUnique({
    where: { email: params.email },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) return null;
  const issued = await issueCode({ userId: user.id, source: "STAFF", issuedById: params.issuedById });
  return { ...issued, user };
}

export type ResetOutcome = { ok: true } | { ok: false; reason: "invalid" | "expired" | "used" };

/**
 * 用代碼換新密碼。
 *
 * 「查無此代碼」「已經用過」「已過期」在對外訊息上會合併成同一句話（見路由），
 * 免得有人靠不同的錯誤訊息判斷「這組代碼曾經存在」。這裡仍然分開回報，是為了寫 log
 * 與驗證腳本時能看出到底是哪一種。
 */
export async function resetPasswordWithCode(rawCode: string, newPassword: string): Promise<ResetOutcome> {
  const normalized = normalizeResetCode(rawCode);
  // 格式不對就不必查資料庫了（也順便讓亂送的請求不會打到 DB）
  if (!isWellFormedResetCode(normalized)) return { ok: false, reason: "invalid" };

  const token = await prisma.passwordResetToken.findUnique({
    where: { codeHash: hashResetCode(normalized) },
  });

  if (!token) return { ok: false, reason: "invalid" };
  if (token.usedAt) return { ok: false, reason: "used" };
  if (token.expiresAt < new Date()) return { ok: false, reason: "expired" };

  const passwordHash = await bcrypt.hash(newPassword, 10);

  // 三件事必須一起成功：換密碼、把代碼標記用過、撤銷所有登入狀態。
  // 只做到一半的話會出現「密碼換了但舊代碼還能再換一次」之類的破口。
  const consumed = await prisma.$transaction(async (tx) => {
    // 條件加上 usedAt: null：兩個請求同時拿同一組代碼進來時，只有一個會更新到列
    const claim = await tx.passwordResetToken.updateMany({
      where: { id: token.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claim.count === 0) return false;

    await tx.user.update({ where: { id: token.userId }, data: { passwordHash } });
    await tx.refreshToken.updateMany({
      where: { userId: token.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return true;
  });

  return consumed ? { ok: true } : { ok: false, reason: "used" };
}

/** 組出信件裡的重設連結；沒設定 APP_URL 就回 null，信裡只放代碼 */
export function buildResetUrl(code: string): string | null {
  if (!env.appUrl) return null;
  return `${env.appUrl}/reset-password?code=${encodeURIComponent(code)}`;
}
