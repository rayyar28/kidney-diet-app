/**
 * 打包「醫院版」APK 前後用：讓 App 只信任醫院自建的 CA（憑證鎖定），並寫死後端網址。
 *
 *   node scripts/hospital-apk.mjs apply      # 換成醫院設定
 *   npm run build:hospital && npx cap sync android
 *   （到純英文路徑的連結目錄跑 gradlew assembleDebug，見 CLAUDE.md）
 *   node scripts/hospital-apk.mjs restore    # 一定要換回來
 *
 * 讀的設定檔是 deploy/hospital.local.json（不進版控），內容：
 *   { "host": "<主機 IP>", "port": 9443, "caCert": "<ca.crt 的路徑>" }
 *
 * **為什麼要分「套用 / 換回」兩步，而不是直接把醫院設定 commit 進去**：
 * repo 是公開的，醫院主機的 IP 與 CA（上面有醫院的名稱）會指出是哪一家醫院、哪一台電腦。
 * 所以進版控的永遠是不含任何醫院資訊的預設版本，醫院的值只在打包當下放進去。
 *
 * **為什麼是憑證鎖定，而不是「多信任一張 CA」**：醫院端送資訊室的資安措施寫的是
 * 「HTTPS + App 憑證鎖定」。對醫院主機這個位址，App 只接受醫院 CA 簽的憑證，
 * 連手機系統內建的公開 CA 都不接受——就算有人在院內網路架了一台假伺服器、
 * 拿到一張公開 CA 簽的憑證，App 也不會理它。其他網址維持系統預設。
 *
 * ⚠ 尚未在實體手機上驗證：Android WebView 對 network_security_config 裡「IP 位址」的
 *   domain 設定，以及對自訂 trust anchor 的支援，理論上自 Android 7 起都有，但要實機確認。
 */

import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(here, "..");
const REPO = resolve(FRONTEND, "..");
const RES = join(FRONTEND, "android", "app", "src", "main", "res");
const XML_PATH = join(RES, "xml", "network_security_config.xml");
const PEM_PATH = join(RES, "raw", "hospital_ca.pem");
const ENV_PATH = join(FRONTEND, ".env.hospital.local");
const CONFIG_PATH = join(REPO, "deploy", "hospital.local.json");

/** 進版控的預設版本。frontend/src/test/networkSecurityConfig.test.ts 會比對檔案與這段完全一致 */
export const DEFAULT_XML = `<?xml version="1.0" encoding="utf-8"?>
<!--
    預設版本（進版控的就是這一份）：只信任手機系統內建的 CA，全站禁止明文 http。
    行為跟沒有這個檔案時完全一樣。

    打包「醫院版」APK 時，frontend/scripts/hospital-apk.mjs 會暫時把這個檔案換成
    「醫院主機只信任醫院自建 CA」的版本（憑證鎖定），建置完再換回來。
    醫院主機的 IP 與 CA 不能進版控：repo 是公開的，那兩樣東西會指出是哪一家醫院。

    frontend/src/test/networkSecurityConfig.test.ts 會檢查這個檔案維持預設內容，
    忘記換回來就會測試失敗，避免把醫院的設定 commit 出去。
-->
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

function pinnedXml(host) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- 醫院版（由 scripts/hospital-apk.mjs apply 產生，不要 commit） -->
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <!-- 醫院主機：只信任醫院自建的 CA（憑證鎖定），系統內建的 CA 一概不接受 -->
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="false">${host}</domain>
        <trust-anchors>
            <certificates src="@raw/hospital_ca" />
        </trust-anchors>
    </domain-config>
</network-security-config>
`;
}

function fail(message) {
  console.error(`\n[hospital-apk] ${message}\n`);
  process.exit(1);
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    fail(
      `找不到 ${CONFIG_PATH}\n` +
        `  建一個（這個檔案不會進版控）：\n` +
        `  { "host": "<主機 IP>", "port": 9443, "caCert": "<從醫院主機 backend\\certs\\ 複製來的 ca.crt 路徑>" }`
    );
  }
  const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (!cfg.host || (!isIP(cfg.host) && !/^[a-z0-9.-]+$/i.test(cfg.host))) fail(`host 不是 IP 或主機名稱：${cfg.host}`);
  const port = Number(cfg.port ?? 9443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`port 不正確：${cfg.port}`);
  if (!cfg.caCert || !existsSync(cfg.caCert)) fail(`找不到 CA 憑證：${cfg.caCert}`);
  return { host: cfg.host, port, caCert: cfg.caCert };
}

function apply() {
  const { host, port, caCert } = readConfig();
  const pem = readFileSync(caCert);
  let x509;
  try {
    x509 = new X509Certificate(pem);
  } catch {
    fail(`${caCert} 不是 PEM 格式的憑證`);
  }
  // 最常見的拿錯：把 server.crt 當成 ca.crt。那樣 App 只認得那一張伺服器憑證，續簽之後就全部連不上
  if (!x509.ca) fail(`${caCert} 不是 CA 憑證（看起來像伺服器憑證）。要的是 ca.crt，不是 server.crt`);
  if (new Date(x509.validTo) < new Date()) fail(`CA 憑證已經過期（${x509.validTo}）`);
  // 私鑰絕對不能被打包進 App
  if (/PRIVATE KEY/.test(pem.toString())) fail(`${caCert} 裡面有私鑰！App 只需要公開的 ca.crt`);

  mkdirSync(dirname(PEM_PATH), { recursive: true });
  writeFileSync(PEM_PATH, pem);
  writeFileSync(XML_PATH, pinnedXml(host));
  writeFileSync(ENV_PATH, `# 由 scripts/hospital-apk.mjs 產生，不要 commit\nVITE_API_BASE_URL=https://${host}:${port}/api\n`);

  console.log(`[hospital-apk] 已套用醫院設定：https://${host}:${port}（CA：${x509.subject.replace(/\n/g, ", ")}）`);
  console.log("  接下來：");
  console.log("    npm run build:hospital");
  console.log("    npx cap sync android");
  console.log("    （到 D:\\kidney-build\\frontend\\android 跑 .\\gradlew.bat assembleDebug）");
  console.log("    node scripts/hospital-apk.mjs restore     ← 一定要換回來，否則測試會失敗");
}

function restore() {
  writeFileSync(XML_PATH, DEFAULT_XML);
  rmSync(PEM_PATH, { force: true });
  rmSync(ENV_PATH, { force: true });
  console.log("[hospital-apk] 已換回預設設定（不含任何醫院資訊）");
}

// 被測試 import 時不要執行
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "apply") apply();
  else if (cmd === "restore") restore();
  else fail("用法：node scripts/hospital-apk.mjs apply | restore");
}
