import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma.js";

/**
 * 登入帳號：研究編號 或 email。
 *
 * 醫院端的規定是「病人身分只用研究編號，不存姓名或病歷號」，所以收案的病人帳號只有
 * patientRef（例如 P0012）。email 留給衛教師/研究人員帳號，以及這個版本之前建立的舊帳號。
 * 兩者共用同一個登入欄位：有 @ 的當 email 找，沒有的當研究編號找。
 */

/**
 * 研究編號的標準形式。存進資料庫與查詢前一律先過這一關。
 *
 * - **全形轉半形（NFKC）**：長輩用注音輸入法時很容易打出「Ｐ００１２」，看起來一模一樣、
 *   字元卻完全不同。不轉的話他會一直登不進去，而且怎麼看都看不出哪裡打錯。
 * - **轉大寫、去掉所有空白**：p0012、P 0012、P0012 都是同一個人。
 */
export function normalizePatientRef(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

/**
 * 標準化之後的研究編號長這樣：英文字母或數字開頭，之後可以有 - 或 _，最多 32 個字。
 * 不能有 @——那是區分「研究編號」與「email」的唯一依據。
 */
const PATIENT_REF_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;

export function isValidPatientRef(normalized: string): boolean {
  return PATIENT_REF_PATTERN.test(normalized);
}

export function looksLikeEmail(account: string): boolean {
  return account.includes("@");
}

/** 登入欄位：研究編號或 email。舊版 App 送的是 `email` 欄位，一樣收 */
export const accountField = z.string().trim().min(1, "請輸入研究編號").max(254);

/**
 * 從請求本文取出登入帳號：新版 App 送 `account`，舊版（v0.5.0 以前，已經裝在護理師手機上）
 * 送 `email`。兩個都收，這樣更新後端不會讓還沒更新 App 的人登不進來。
 */
export function readAccount(body: unknown): string {
  const b = (body ?? {}) as { account?: unknown; email?: unknown };
  return accountField.parse(b.account ?? b.email);
}

export async function findUserByAccount(account: string) {
  const trimmed = account.trim();
  if (looksLikeEmail(trimmed)) {
    return prisma.user.findUnique({ where: { email: trimmed } });
  }
  return prisma.user.findUnique({ where: { patientRef: normalizePatientRef(trimmed) } });
}

/**
 * 帳號不存在時也要做一次 bcrypt 比對，讓「帳號不存在」與「密碼錯誤」花一樣久。
 *
 * 以前帳號是 email，猜不太到；現在病人帳號是 P0001、P0002 這種流水號，
 * 如果回應時間能透露「這個編號存在」，就等於把收案名單送給對方。
 */
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", 10);

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  const ok = await bcrypt.compare(password, passwordHash ?? DUMMY_HASH);
  return ok && passwordHash !== null;
}

interface UserLike {
  id: string;
  email: string | null;
  patientRef: string | null;
  displayName: string | null;
  role: string;
}

/** 回傳給 App 的使用者資料。刻意只挑這幾個欄位，不要把 passwordHash 之類的東西整包丟出去 */
export function publicUser(u: UserLike) {
  return { id: u.id, email: u.email, patientRef: u.patientRef, displayName: u.displayName, role: u.role };
}

/** 給人看的帳號名稱：有名字用名字，病人帳號用研究編號 */
export function accountLabel(u: Pick<UserLike, "displayName" | "patientRef" | "email">): string {
  return u.displayName ?? u.patientRef ?? u.email ?? "";
}
