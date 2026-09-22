import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

/**
 * CORS_ORIGIN 支援用逗號分隔多個來源，例如：
 *   CORS_ORIGIN="https://kidney-diet.pages.dev,https://preview.kidney-diet.pages.dev"
 * 這樣正式網址與 Cloudflare Pages 的預覽網址可以同時運作。
 */
function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const storageDriver = (process.env.STORAGE_DRIVER ?? "local") as "local" | "r2";

/**
 * 把 jsonwebtoken 格式的效期字串換算成毫秒（"30d" / "15m" / "3600s"，純數字視為秒）。
 *
 * 為什麼需要這個：refresh token 有「兩個」到期時間——JWT 本身的、以及資料庫
 * refresh_tokens.expiresAt 那一筆。兩者必須一致，否則會出現「JWT 還有效但資料庫
 * 判定過期」（或反過來）的狀況，使用者就換發不了、被迫重新登入。
 * 原本資料庫那邊是寫死 30 天，只要改了環境變數就會不一致，這個函式讓兩邊共用同一個值。
 */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(value.trim());
  if (!match) {
    throw new Error(`無法解析的效期設定: "${value}"（可用格式：30d / 12h / 15m / 3600s）`);
  }
  const amount = Number(match[1]);
  const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] ?? "s"]!;
  return amount * unitMs;
}

export const env = {
  // Render / Cloud Run 等平台會自己注入 PORT，一定要讀它而不是寫死
  port: Number(process.env.PORT ?? 4000),

  databaseUrl: required("DATABASE_URL"),

  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "30d",
  // 資料庫那一筆 refresh token 的到期時間，一定要跟上面的 JWT 效期算出同一個值。
  // 啟動時就解析，設定寫錯會立刻失敗，而不是等到有人登入才出問題。
  jwtRefreshExpiresMs: parseDurationMs(process.env.JWT_REFRESH_EXPIRES_IN ?? "30d"),

  corsOrigins: parseOrigins(process.env.CORS_ORIGIN ?? "http://localhost:5173"),

  // 儲存後端："local"（本機磁碟，開發用）或 "r2"（Cloudflare R2，正式用）
  storageDriver,
  uploadDir: process.env.UPLOAD_DIR ?? "./uploads",
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: process.env.R2_BUCKET ?? "",
  },

  // 簽名網址的有效秒數。設短一點比較安全，但太短的話病人網路慢就會載入失敗。
  signedUrlTtlSeconds: Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300),
};
