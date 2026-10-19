/**
 * 4_setup.bat：第一次安裝、以及每次更新程式之後都要跑一次。
 *
 *   4_setup.bat              自動找這台電腦的 IP
 *   4_setup.bat 192.168.x.x  手動指定（有好幾張網卡、自動判斷不出來時）
 *
 * 會做的事（全部可以重複執行，不會弄壞已有的東西）：
 *   1. 建立 config / certs / data / backups / logs 資料夾
 *   2. 第一次執行時產生設定檔（含隨機的 JWT 密鑰）。已經有了就沿用，不會覆蓋
 *   3. 建立或更新資料庫（套用新版程式帶來的資料表變更）
 *   4. 建立徽章資料
 *
 * 不需要網路、不需要系統管理員。
 */

import { randomBytes, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { join } from "node:path";
import {
  BACKEND_DIR, BACKUPS_DIR, CERTS_DIR, CONFIG_FILE, DATA_DIR, DB_FILE, HOME, LOGS_DIR, NODE, PRISMA_CLI,
  SCHEMA, UPLOADS_DIR, backendEnv, bad, fail, ok, readEnvFile, title, toPrismaFileUrl, warn,
} from "./lib.mjs";

/** 虛擬網卡（WSL、Hyper-V、VMware…）外面連不到，不能拿來當手機要連的位址 */
const VIRTUAL = /vEthernet|VMware|VirtualBox|WSL|Hyper-V|Loopback|Bluetooth|Npcap|TAP-|Tailscale|ZeroTier/i;

function physicalIPv4() {
  const found = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) found.push({ name, address: a.address });
    }
  }
  return found;
}

function decideHost(arg) {
  if (arg) {
    if (!isIP(arg)) fail(`「${arg}」不是 IP 位址`);
    return arg;
  }
  const ips = physicalIPv4();
  if (ips.length === 1) return ips[0].address;
  if (ips.length === 0) fail("找不到實體網卡的 IP（網路線有接上嗎？）。也可以手動指定：4_setup.bat <IP>");
  fail(
    "這台電腦有好幾個 IP，無法判斷手機要連哪一個：\n" +
      ips.map((i) => `    ${i.address}  （${i.name}）`).join("\n") +
      "\n  → 請指定：4_setup.bat <IP>（通常是醫院資訊組設定的那個固定 IP）"
  );
}

function run(label, args, env) {
  const r = spawnSync(NODE, args, { cwd: BACKEND_DIR, env, encoding: "utf8" });
  if (r.status !== 0) {
    bad(`${label}失敗`);
    console.log((r.stderr || r.stdout || "").trim().split("\n").slice(-15).join("\n"));
    process.exit(1);
  }
  ok(label);
}

title("1. 資料夾");
for (const d of [join(HOME, "config"), CERTS_DIR, DATA_DIR, UPLOADS_DIR, BACKUPS_DIR, LOGS_DIR]) mkdirSync(d, { recursive: true });
ok(`安裝位置：${HOME}`);
if (/\\Downloads\\/i.test(HOME)) {
  warn("裝在「下載」資料夾裡。這裡很容易被人清掉，裡面有病人資料，建議搬到 %USERPROFILE%\\kidney");
}

title("2. 設定檔");
let cfg = readEnvFile();
if (cfg) {
  ok(`沿用既有的設定檔（${CONFIG_FILE}）`);
} else {
  const host = decideHost(process.argv[2]);
  const secret = () => randomBytes(48).toString("base64url");
  const content = [
    "# 腎臟飲食 App 後端：醫院主機設定（4_setup 第一次執行時產生）",
    "# ⚠ 裡面有 JWT 密鑰：外流的話，任何人都能偽造任何病人的登入。不要複製到別台電腦、不要寄出去。",
    "",
    "# 手機要連的位址與 port（要跟憑證、防火牆、資訊室申請的內容一致）",
    `PUBLIC_HOST=${host}`,
    "PORT=9443",
    "HOST=0.0.0.0",
    "",
    "# HTTPS：用醫院 CA 簽的伺服器憑證（從醫院原本那套後端的 backend\\certs\\ 複製過來）",
    `TLS_CERT_FILE=${join(CERTS_DIR, "server.crt")}`,
    `TLS_KEY_FILE=${join(CERTS_DIR, "server.key")}`,
    "TLS_KEY_PASSPHRASE=",
    "",
    "# 資料：資料庫與照片都在 data 資料夾",
    `DATABASE_URL=${toPrismaFileUrl(DB_FILE)}`,
    "STORAGE_DRIVER=local",
    `UPLOAD_DIR=${UPLOADS_DIR}`,
    "",
    `JWT_ACCESS_SECRET=${secret()}`,
    `JWT_REFRESH_SECRET=${secret()}`,
    "",
    "# 執行期間不讓電腦睡眠（不會改電源設定，關掉後端就恢復）",
    "KEEP_AWAKE=true",
    "# 帳號由衛教師建立，不開放自己註冊",
    "ALLOW_PUBLIC_REGISTRATION=false",
    "# 院內電腦寄不出信：忘記密碼一律由衛教師當面開代碼，「寄到信箱」整條路關閉",
    "MAIL_DRIVER=console",
    "ALLOW_EMAIL_PASSWORD_RESET=false",
    "",
  ].join("\r\n");
  writeFileSync(CONFIG_FILE, content);
  cfg = readEnvFile();
  ok(`已產生設定檔（${CONFIG_FILE}）`);
  ok(`手機要連的位址：https://${host}:9443`);
}

title("3. 憑證");
const certFile = cfg.TLS_CERT_FILE;
if (!existsSync(certFile) || !existsSync(cfg.TLS_KEY_FILE)) {
  warn(`還沒放憑證。從醫院原本那套後端的 backend\\certs\\ 複製這三個檔案到 ${CERTS_DIR}：`);
  console.log("           server.crt、server.key（後端用）、ca.crt（7_smoke_test 用）");
  console.log("           ca.key 不要複製——那是 CA 的私鑰，醫院端是離線保管的");
} else {
  try {
    const x = new X509Certificate(readFileSync(certFile));
    const daysLeft = Math.floor((new Date(x.validTo).getTime() - Date.now()) / 86_400_000);
    const forHost = isIP(cfg.PUBLIC_HOST) ? x.checkIP(cfg.PUBLIC_HOST) : x.checkHost(cfg.PUBLIC_HOST);
    if (!forHost) bad(`server.crt 不是簽給 ${cfg.PUBLIC_HOST} 的（${x.subjectAltName}），手機會拒絕連線`);
    else ok(`server.crt 簽給 ${cfg.PUBLIC_HOST}，還有 ${daysLeft} 天到期`);
  } catch {
    bad("server.crt 讀不出來，檔案是不是壞了？");
  }
  if (!existsSync(join(CERTS_DIR, "ca.crt"))) warn("沒有 ca.crt：後端照樣能跑，但 7_smoke_test 需要它來驗證憑證");
  if (existsSync(join(CERTS_DIR, "ca.key"))) bad("certs 裡有 ca.key！那是 CA 私鑰，外流就能冒充這台伺服器。請移走、離線保管");
}

title("4. 資料庫");
const env = backendEnv(cfg);
const firstTime = !existsSync(DB_FILE);
run(firstTime ? "建立資料庫" : "更新資料庫結構（沒有變更就什麼都不做）", [PRISMA_CLI, "migrate", "deploy", "--schema", SCHEMA], env);
run("徽章資料", [join(BACKEND_DIR, "prisma", "seed.mjs")], env);

title("完成");
console.log("  下一步：");
console.log("    1. 憑證放好之後，執行 5_run.bat 啟動後端");
console.log("    2. 另開一個視窗執行 7_smoke_test.bat 確認一切正常");
console.log("    3. 建第一個衛教師帳號：6_staff_account.bat create-staff <email> <密碼> <名字>");
