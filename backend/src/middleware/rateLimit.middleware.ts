import rateLimit from "express-rate-limit";

// 防止密碼暴力猜測：同一個 IP 15 分鐘內最多嘗試 10 次登入
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "登入嘗試次數過多，請稍後再試" },
});

// 防止自動化大量灌帳號：同一個 IP 1 小時內最多註冊 5 次
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "註冊次數過多，請稍後再試" },
});

/**
 * 申請重設密碼：同一個 IP 1 小時內最多 5 次。
 * 這個端點對「信箱存不存在」一律回同樣的結果，所以限流主要是防止有人拿它當寄信機器
 * （每次成功都會寄一封信出去，那是要花錢也會被收信端當成濫發的）。
 */
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "申請次數過多，請稍後再試" },
});

/**
 * 送出重設代碼：同一個 IP 15 分鐘內最多 10 次。
 * 代碼本身有 49 bits 的亂度，這層限流是為了讓「一個一個猜」從天文數字變成完全不可能。
 */
export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "嘗試次數過多，請稍後再試" },
});
