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
