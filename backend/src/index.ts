import express from "express";
import cors from "cors";
import http from "node:http";
import https from "node:https";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { mealsRouter } from "./routes/meals.routes.js";
import { photosRouter } from "./routes/photos.routes.js";
import { gamificationRouter } from "./routes/gamification.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { staffRouter } from "./routes/staff.routes.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { configureDatabase } from "./prisma.js";
import { loadTls, TlsConfigError } from "./system/tls.js";
import { startKeepAwake } from "./system/keepAwake.js";

const app = express();

/** Capacitor 原生 App 載入本機網頁時使用的 Origin */
const CAPACITOR_ORIGINS = new Set(["https://localhost", "capacitor://localhost", "http://localhost"]);

// 要不要相信 X-Forwarded-For，決定速率限制看到的是「誰」（詳見 config/env.ts 的 resolveTrustProxy）：
// - 在 Render / Caddy 後面：要相信（=1），否則所有病人都會被看成代理那一個 IP，一人觸發限制全部被擋
// - 醫院主機（Node 直接提供 HTTPS，前面沒有代理）：不能相信，否則任何人每次請求換一個假標頭，
//   就能讓每次猜密碼都算成新的 IP，研究編號又是 P0001 這種流水號——等於沒有限流
app.set("trust proxy", env.trustProxy);

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

/**
 * 健康檢查。兩個路徑回一樣的東西：
 * - /api/health：App 的「設定伺服器」畫面與 Render 用的（原本就有）
 * - /health    ：醫院端的慣例——連線測試就是用手機瀏覽器打開 https://主機:9443/health
 *
 * 多帶一個 service 名稱：這台主機以前跑的是醫院那套 FastAPI 後端，用同一個 port。
 * 打開 /health 看到 "kidney-diet" 才能確定接電話的是我們，而不是舊的那套還開著。
 */
const healthBody = { ok: true, service: "kidney-diet", version: process.env.APP_VERSION ?? "dev" };
app.get("/health", (_req, res) => res.json(healthBody));
app.get("/api/health", (_req, res) => res.json(healthBody));

app.use("/api/auth", authRouter);
app.use("/api/meals", mealsRouter);
app.use("/api/photos", photosRouter);
app.use("/api/gamification", gamificationRouter);
app.use("/api/profile", profileRouter);
app.use("/api/staff", staffRouter);

app.use(errorMiddleware);

/** 啟動失敗時給操作的人看的訊息。醫院主機上是在 5_run.bat 的視窗裡看，要講人話 */
function fail(message: string): never {
  console.error(`\n[啟動失敗] ${message}\n`);
  process.exit(1);
}

// 先把憑證檢查完：有問題就不要啟動，免得手機只看到「無法連線」卻不知道為什麼
let server: http.Server | https.Server;
if (env.tls.enabled) {
  try {
    const tls = loadTls({
      certFile: env.tls.certFile,
      keyFile: env.tls.keyFile,
      keyPassphrase: env.tls.keyPassphrase,
      publicHost: env.publicHost,
    });
    for (const w of tls.warnings) console.warn(`[tls] ⚠ ${w}`);
    console.log(`[tls] 憑證：${tls.subject}，有效到 ${tls.validTo.toISOString().slice(0, 10)}`);
    server = https.createServer({ key: tls.key, cert: tls.cert, passphrase: tls.passphrase }, app);
  } catch (err) {
    if (err instanceof TlsConfigError) fail(err.message);
    throw err;
  }
} else {
  server = http.createServer(app);
}

// 先把資料庫設定好再開始收請求：WAL 沒開的話，第一批同時進來的病人會互相卡住
await configureDatabase();

server.on("error", (err: NodeJS.ErrnoException) => {
  // 醫院主機上 8443、8080、8000 都被 Windows 保留或佔用了（見醫院端的系統資訊），
  // 這兩種錯誤很常見，原始的英文錯誤訊息看不出該怎麼辦
  if (err.code === "EADDRINUSE") {
    fail(
      `port ${env.port} 已經被別的程式佔用了。\n` +
        `  → 原本醫院那套後端也用 9443，確認它已經關掉；或改用備用的 18443 / 28443（記得防火牆跟著改）。`
    );
  }
  if (err.code === "EACCES") {
    fail(
      `port ${env.port} 被 Windows 保留，不能使用（這台主機的 8443、8080、8000 都是這樣）。\n` +
        `  → 改用 9443，或備用的 18443 / 28443。`
    );
  }
  throw err;
});

server.listen(env.port, env.host, () => {
  const scheme = env.tls.enabled ? "https" : "http";
  console.log(`API server listening on ${scheme}://${env.host}:${env.port}`);
  console.log(`Storage driver: ${env.storageDriver}`);
  console.log(`Allowed origins: ${env.corsOrigins.join(", ")}`);
  console.log(`Trust proxy: ${env.trustProxy}`);
  console.log(`Public registration: ${env.allowPublicRegistration ? "OPEN（只應該出現在開發機）" : "closed"}`);
  if (env.keepAwake) startKeepAwake();
});
