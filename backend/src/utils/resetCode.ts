import crypto from "crypto";

/**
 * 密碼重設代碼。
 *
 * **8 位數字**，顯示成 `4728 1935`。
 *
 * 為什麼是數字而不是英數字母：使用者是年長的腎臟病人，很多人手會抖、有老花、不熟悉
 * 手機鍵盤。要他們打 `H4N74-M6EB6` 得切換大小寫、找連字號、而且打錯了自己看不出來；
 * 純數字可以叫出手機的數字鍵盤（鍵大、只有 10 個），難度差非常多。
 *
 * 而且這個 App 的帳號是衛教師在收案時幫病人建的，病人可能從頭到尾沒打過自己的密碼，
 * 所以「輸入代碼」往往是他第一次、也是唯一一次要在這個 App 裡打一串東西。
 *
 * ### 為什麼是 8 位、不是簡訊常見的 6 位
 *
 * 簡訊驗證碼之所以 6 位就夠，是因為**你已經先輸入了手機號碼**——那組代碼只對你的帳號有效，
 * 伺服器可以精準地算「這個帳號猜錯幾次了」。
 *
 * 我們的代碼沒有這個前提：病人只打代碼，不打帳號（帳號是衛教師建的，他可能根本不知道），
 * 所以收到一組不存在的代碼時，伺服器**無法判斷對方在猜誰**，也就做不出可靠的每帳號次數限制。
 * （試過「把所有有效代碼都加一次」，那會變成「任何人送幾組亂碼就能讓全系統正在重設的病人
 * 一起作廢」的阻斷服務漏洞。）
 *
 * 既然不能靠次數，就得靠亂度：8 位數 = 1 億種組合。配合 IP 速率限制（15 分鐘 10 次）、
 * 一小時過期、一次性、每個帳號同時只有一組，亂猜在實務上不可行。
 *
 * 多兩位對使用者幾乎沒有代價——數字鍵盤上打 8 個數字，比打 10 個要切換大小寫的英數字母
 * 輕鬆太多了（電話號碼本來就有 10 位）。
 */

export const CODE_LENGTH = 8;
const MAX_CODE = 10 ** CODE_LENGTH;

/** 產生一組新代碼，顯示成「4728 1935」（中間的空格只是為了好唸，不算在代碼裡） */
export function generateResetCode(): string {
  // randomInt 是均勻分布的；用 % 取餘數會讓某些數字機率略高
  return formatResetCode(String(crypto.randomInt(MAX_CODE)).padStart(CODE_LENGTH, "0"));
}

/** 把代碼排版成人看的樣子：四個一組，唸的人跟聽的人都比較不會跳行 */
export function formatResetCode(raw: string): string {
  const clean = raw.replace(/\D/g, "");
  return `${clean.slice(0, 4)} ${clean.slice(4)}`;
}

/**
 * 把使用者輸入的代碼正規化成比對用的形式：只留數字。
 * 病人可能連著打、中間空格、或不小心多打一個連字號，這些都應該通過。
 */
export function normalizeResetCode(input: string): string {
  return input.replace(/\D/g, "");
}

/** 正規化之後看起來是不是一組合法的代碼 */
export function isWellFormedResetCode(normalized: string): boolean {
  return normalized.length === CODE_LENGTH;
}

/**
 * 資料庫裡只存這個雜湊，不存代碼本身。
 *
 * 用 sha256 而不是 bcrypt：驗證時要能用唯一索引 O(1) 查出來。
 * 注意 8 位數字的搜尋空間（1 億）對離線暴力破解來說並不大，所以這個雜湊擋的是
 * 「資料庫外流時沒辦法直接讀出還有效的代碼」，不是「拿到雜湊也永遠算不出來」。
 * 真正的防線是一小時過期、一次性、以及線上的速率限制。
 */
export function hashResetCode(normalized: string): string {
  return crypto.createHash("sha256").update(normalized).digest("hex");
}
