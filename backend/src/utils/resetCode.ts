import crypto from "crypto";

/**
 * 密碼重設代碼。
 *
 * 為什麼是「代碼」而不是網址裡的長 token：使用者是年長的腎臟病人，而且找回密碼有兩條路——
 * 病人自己收信，或衛教師當面口頭告訴他。後者代表這組代碼必須**唸得出來、打得進去**，
 * 64 個十六進位字元做不到這件事。
 *
 * 字母表刻意去掉 0/O、1/I/L 這些在紙上或口頭上會搞混的字元，剩下 31 個。
 * 10 個字元 = 31^10 ≈ 8.2×10^14 種組合（約 49.5 bits），配合「一次性、有效期一小時、
 * 每個帳號同時只有一組、而且有速率限制」，暴力猜測不可行。
 */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 10;

/** 產生一組新代碼，顯示成 XXXXX-XXXXX（中間的連字號只是為了好唸，不算在代碼裡） */
export function generateResetCode(): string {
  // crypto.randomInt 是均勻分布的；用 % 取餘數會讓前幾個字元機率略高
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    raw += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return formatResetCode(raw);
}

/** 把代碼排版成人看的樣子 */
export function formatResetCode(raw: string): string {
  const clean = raw.replace(/-/g, "");
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}

/**
 * 把使用者輸入的代碼正規化成比對用的形式：去掉空白與連字號、轉大寫。
 * 病人可能會連著打、分開打、或不小心打出小寫，這些都應該通過。
 */
export function normalizeResetCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** 正規化之後的代碼看起來是不是一組合法的代碼（長度與字元都對） */
export function isWellFormedResetCode(normalized: string): boolean {
  if (normalized.length !== CODE_LENGTH) return false;
  for (const ch of normalized) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}

/**
 * 資料庫裡只存這個雜湊，不存代碼本身。
 * 用 sha256 而不是 bcrypt：代碼是我們自己產生的高熵隨機值（不是使用者想的密碼），
 * 不怕字典攻擊，而每次驗證都要能用 O(1) 的唯一索引查出來。
 */
export function hashResetCode(normalized: string): string {
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
