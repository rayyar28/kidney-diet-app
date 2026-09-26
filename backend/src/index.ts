import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { mealsRouter } from "./routes/meals.routes.js";
import { photosRouter } from "./routes/photos.routes.js";
import { gamificationRouter } from "./routes/gamification.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { staffRouter } from "./routes/staff.routes.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

const app = express();

/** Capacitor 原生 App 載入本機網頁時使用的 Origin */
const CAPACITOR_ORIGINS = new Set(["https://localhost", "capacitor://localhost", "http://localhost"]);

// Render 之類的平台會把服務放在反向代理後面。沒有這一行的話，
// express-rate-limit 會把所有請求都看成來自同一個 IP（代理的 IP），
// 導致一個病人觸發限制、全部病人一起被擋。
app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      // 沒有 Origin header 的請求（健康檢查、curl、同源請求）直接放行
      if (!origin) return callback(null, true);
      if (env.corsOrigins.includes(origin)) return callback(null, true);
      // Cloudflare Quick Tunnel 網址是隨機字串、每次重開都會換，demo/開發階段
      // 直接放行整個 *.trycloudflare.com，不用每次改 .env。網址本身無法猜測，
      // 且僅用於臨時測試，不是正式環境設定。
      if (/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin)) return callback(null, true);
      // 包成 Capacitor 原生 App 後，網頁是從裝置本機載入的，Origin 會是這幾個固定值
      // (Android 預設 https://localhost、iOS 預設 capacitor://localhost)。
      // 這些不是可以被第三方網站冒用的來源：瀏覽器不會讓一般網頁宣稱自己是這些 Origin。
      if (CAPACITOR_ORIGINS.has(origin)) return callback(null, true);
      callback(new Error(`不允許的來源：${origin}`));
    },
    credentials: false,
  })
);

app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/meals", mealsRouter);
app.use("/api/photos", photosRouter);
app.use("/api/gamification", gamificationRouter);
app.use("/api/profile", profileRouter);
app.use("/api/staff", staffRouter);

app.use(errorMiddleware);

app.listen(env.port, () => {
  console.log(`API server listening on port ${env.port}`);
  console.log(`Storage driver: ${env.storageDriver}`);
  console.log(`Allowed origins: ${env.corsOrigins.join(", ")}`);
});
