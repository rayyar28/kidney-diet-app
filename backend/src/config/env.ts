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

export const env = {
  // Render / Cloud Run 等平台會自己注入 PORT，一定要讀它而不是寫死
  port: Number(process.env.PORT ?? 4000),

  databaseUrl: required("DATABASE_URL"),

  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "30d",

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
