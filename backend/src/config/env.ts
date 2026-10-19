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

const tlsCertFile = process.env.TLS_CERT_FILE ?? "";
const tlsKeyFile = process.env.TLS_KEY_FILE ?? "";
if (Boolean(tlsCertFile) !== Boolean(tlsKeyFile)) {
  // 只設一個多半是打錯字。默默退回 HTTP 的話，手機會因為連不上 https 而一直失敗，很難查
  throw new Error("TLS_CERT_FILE 與 TLS_KEY_FILE 要嘛都設、要嘛都不設（現在只設了其中一個）");
}
/** 由這個程式自己提供 HTTPS（醫院主機），而不是躲在 Caddy / Render 之類的代理後面 */
const servingTlsDirectly = Boolean(tlsCertFile && tlsKeyFile);

/**
 * 要不要相信 X-Forwarded-For 標頭（express 的 "trust proxy"）。
 *
 * 只有「前面真的有一台反向代理」時才能相信它。速率限制是依來源 IP 計算的，
 * 如果前面沒有代理卻相信這個標頭，任何人每次請求都換一個假的 X-Forwarded-For，
 * 就能讓每一次猜密碼都算成「新的 IP」——限流形同虛設。
 * 醫院主機是 Node 直接面對手機，前面沒有代理，所以預設不相信。
 *
 *   沒設定 → 自己提供 HTTPS 時是 false，否則是 1（維持 Render / Docker+Caddy 原本的行為）
 *   TRUST_PROXY=false 或 0 → 不相信
 *   TRUST_PROXY=1（或其他正整數）→ 相信前面幾層代理
 */
function resolveTrustProxy(raw: string | undefined): number | false {
  if (raw === undefined || raw.trim() === "") return servingTlsDirectly ? false : 1;
  const v = raw.trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  const n = Number(v);
  if (Number.isInteger(n) && n > 0) return n;
  throw new Error(`無法解析的 TRUST_PROXY: "${raw}"（可用 false / 1 / 2 …）`);
}

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

  /** 監聽哪個網路介面。預設所有介面；真正擋人的是防火牆規則（只開給病人 Wi-Fi 網段） */
  host: process.env.HOST ?? "0.0.0.0",

  /**
   * 自己提供 HTTPS（醫院主機用）。憑證是醫院端自建 CA 簽的那一張 server.crt / server.key，
   * 跟醫院原本那套後端用的是同一組，不必另外產生，也不會出現第二張 CA。
   * 兩個都沒設就是一般 HTTP（開發、Docker+Caddy、Render）。
   */
  tls: {
    enabled: servingTlsDirectly,
    certFile: tlsCertFile,
    keyFile: tlsKeyFile,
    /** server.key 有設密碼時才需要 */
    keyPassphrase: process.env.TLS_KEY_PASSPHRASE ?? "",
  },

  /**
   * 手機用來連這台主機的位址（通常就是主機 IP）。有設的話，啟動時會檢查
   * 憑證是不是簽給這個位址——簽錯位址的憑證，手機會直接拒絕連線，而且錯誤訊息很難看懂。
   */
  publicHost: (process.env.PUBLIC_HOST ?? "").trim(),

  trustProxy: resolveTrustProxy(process.env.TRUST_PROXY),

  /**
   * 執行期間不讓 Windows 進入睡眠（醫院主機用）。診間電腦預設閒置一陣子就會睡，
   * 睡著的時候病人在候診區怎麼按都傳不上來。只在這個程式執行期間有效，不會改電源設定。
   */
  keepAwake: process.env.KEEP_AWAKE === "true",

  /**
   * 開放「任何人自己註冊帳號」。**預設關閉。**
   *
   * 收案的帳號一律由衛教師建立（研究編號 + 初始密碼）。開放註冊的話，
   * 院內訪客 Wi-Fi 上任何拿到 APK 的人都能開帳號、上傳照片到研究資料庫。
   * 只有本機開發、或跑會自己註冊測試帳號的檢查腳本時才打開。
   */
  allowPublicRegistration: process.env.ALLOW_PUBLIC_REGISTRATION === "true",

  /**
   * 開放「寄信到信箱」找回密碼。**預設關閉。**
   *
   * 醫院主機寄不出信（MAIL_DRIVER=console），但這條路如果開著，系統照樣會產生重設代碼，
   * 只是把它印進主機的 log 檔：看得到 log 的人就能用它重設別人的密碼，
   * 病患則會看到「已寄出」卻永遠收不到。所以寄不出信的地方，這條路要整個關掉；
   * 病患忘記密碼一律由衛教師當面開代碼（staff.routes.ts）。
   */
  allowEmailPasswordReset: process.env.ALLOW_EMAIL_PASSWORD_RESET === "true",

  databaseUrl: required("DATABASE_URL"),

  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  jwtRefreshSecret: required("JWT_REFRESH_SECRET"),
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? "15m",
  /**
   * 登入狀態可以維持多久沒有連上伺服器。**預設一年，通常不需要動它。**
   *
   * 這不是一個安全參數，是一個可用性參數。縮短它在這個系統裡幾乎沒有防護價值：
   * 資料庫存的是雜湊不是 token 本身、每次換發都會輪替（偷到一組只能用一次）、
   * 前端沒有 XSS 注入面，而真正的威脅（有人拿到病人沒鎖的手機）直接開 App 就看得到全部。
   * 要停掉某個人的存取是用 revokedAt 撤銷或刪帳號，不是等它過期。
   *
   * 反過來，設太短會**確定**出事：一般門診病人 2~3 個月才回診一次，如果憑證先過期，
   * 他會在回診現場發現被登出——而他的帳號是衛教師建的，他可能從來不知道密碼。
   * 一年比任何回診間隔都長，但仍然有界限，手機放著不用總會失效。
   */
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? "365d",
  // 資料庫那一筆 refresh token 的到期時間，一定要跟上面的 JWT 效期算出同一個值。
  // 啟動時就解析，設定寫錯會立刻失敗，而不是等到有人登入才出問題。
  jwtRefreshExpiresMs: parseDurationMs(process.env.JWT_REFRESH_EXPIRES_IN ?? "365d"),

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

  // ---------------------------------------------------------------------
  // 忘記密碼
  // ---------------------------------------------------------------------
  /**
   * 重設代碼的有效時間。設太短，年長病人還沒去信箱找就過期了；
   * 設太長，代碼被別人看到的風險窗口就變大。一小時是兩者的折衷。
   */
  passwordResetExpiresMs: parseDurationMs(process.env.PASSWORD_RESET_EXPIRES_IN ?? "60m"),

  /**
   * 前端網址，用來組出信件裡的重設連結（例如 https://kidney-diet.pages.dev）。
   * 沒設定就不放連結，信裡只有代碼——App 使用者本來就是用打代碼的，不影響功能。
   */
  appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),

  mail: {
    // "console"（印在 log，開發用）或 "resend"（真的寄出去，正式用）
    driver: (process.env.MAIL_DRIVER ?? "console") as "console" | "resend",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    // 寄件者，例如 "腎臟飲食小幫手 <noreply@你的網域>"。網域必須在 Resend 驗證過，
    // 否則信會被當成垃圾信（或直接被退回）。
    from: process.env.MAIL_FROM ?? "",
  },
};
