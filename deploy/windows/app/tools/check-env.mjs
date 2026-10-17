/**
 * 1_check_env.bat：檢查這台主機能不能跑後端、哪裡還沒準備好。只讀不改，不需要系統管理員。
 *
 * 每一項都對應醫院端環境報告或系統資訊裡實際遇過的狀況：
 * port 被 Windows 保留、按了「取消」產生封鎖規則、電腦會睡著、IP 改了、憑證簽錯位址…
 */

import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, statSync, statfsSync } from "node:fs";
import { createServer, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  APP_DIR, CERTS_DIR, CONFIG_FILE, DATA_DIR, DB_FILE, FIREWALL_RULE, HOME, bad, ok, readEnvFile, readVersion, title, warn,
} from "./lib.mjs";

const ps = (command) =>
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" }).trim();

title("程式");
ok(`版本 ${readVersion()}，Node ${process.version}（隨附，不需要安裝）`);
ok(`安裝位置：${HOME}`);
const isAdmin = spawnSync("net", ["session"], { stdio: "ignore" }).status === 0;
console.log(`  [資訊] ${isAdmin ? "目前是系統管理員" : "目前不是系統管理員（只有 2_firewall_open / 2b 需要）"}`);

title("設定");
const cfg = readEnvFile();
if (!cfg) {
  bad(`沒有設定檔（${CONFIG_FILE}）→ 先執行 4_setup.bat`);
} else {
  ok(`設定檔：手機連 https://${cfg.PUBLIC_HOST}:${cfg.PORT}`);
  const mine = Object.entries(networkInterfaces()).flatMap(([n, a]) => (a ?? []).map((x) => ({ n, ...x })));
  if (mine.some((a) => a.address === cfg.PUBLIC_HOST)) ok(`${cfg.PUBLIC_HOST} 是這台電腦目前的 IP`);
  else bad(`${cfg.PUBLIC_HOST} 不是這台電腦目前的 IP（IP 改了嗎？）。憑證、App、防火牆都綁著這個 IP`);
}

title("憑證");
if (cfg) {
  if (!existsSync(cfg.TLS_CERT_FILE) || !existsSync(cfg.TLS_KEY_FILE)) {
    bad(`缺少 server.crt / server.key（應該在 ${CERTS_DIR}）`);
  } else {
    try {
      const x = new X509Certificate(readFileSync(cfg.TLS_CERT_FILE));
      const days = Math.floor((new Date(x.validTo).getTime() - Date.now()) / 86_400_000);
      const forHost = isIP(cfg.PUBLIC_HOST) ? x.checkIP(cfg.PUBLIC_HOST) : x.checkHost(cfg.PUBLIC_HOST);
      if (!forHost) bad(`server.crt 不是簽給 ${cfg.PUBLIC_HOST}（${x.subjectAltName}）`);
      else if (days < 0) bad(`server.crt 已過期（${x.validTo}）`);
      else if (days < 30) warn(`server.crt 剩 ${days} 天到期，請續簽`);
      else ok(`server.crt 簽給 ${cfg.PUBLIC_HOST}，剩 ${days} 天`);
    } catch {
      bad("server.crt 讀不出來");
    }
  }
  if (existsSync(join(CERTS_DIR, "ca.key"))) bad("certs 裡有 ca.key（CA 私鑰）！請移走、離線保管");
  if (!existsSync(join(CERTS_DIR, "ca.crt"))) warn("沒有 ca.crt（7_smoke_test 需要）");
}

title("Port");
if (cfg) {
  const port = Number(cfg.PORT);
  const result = await new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", (e) => resolve(e.code));
    srv.listen(port, "0.0.0.0", () => srv.close(() => resolve("free")));
  });
  if (result === "free") ok(`${port} 可以使用（後端目前沒有在跑）`);
  else if (result === "EADDRINUSE") warn(`${port} 已經有程式在用：如果是 5_run.bat 開著就沒問題；不是的話，可能是舊的那套後端還開著`);
  else if (result === "EACCES") bad(`${port} 被 Windows 保留，不能用（這台的 8443/8080/8000 都是）。改用 9443 或 18443 / 28443`);
  else bad(`${port} 無法使用（${result}）`);
}

title("防火牆");
try {
  const node = join(APP_DIR, "node", "node.exe").replace(/'/g, "''");
  // 用 PowerShell 的物件讀規則，不解析 netsh 的文字：那是中文輸出，換一台電腦格式就不一樣
  const rules = JSON.parse(
    ps(
      `@(Get-NetFirewallApplicationFilter -Program '${node}' -ErrorAction SilentlyContinue | Get-NetFirewallRule | ` +
        `Select-Object DisplayName, @{n='Enabled';e={[string]$_.Enabled}}, @{n='Action';e={[string]$_.Action}}, @{n='Direction';e={[string]$_.Direction}}) | ConvertTo-Json -Compress`
    ) || "[]"
  );
  const list = Array.isArray(rules) ? rules : [rules];
  const blocks = list.filter((r) => r.Action === "Block" && r.Enabled === "True" && r.Direction === "Inbound");
  const mine = list.find((r) => r.DisplayName === FIREWALL_RULE);
  if (blocks.length) {
    bad(`有 ${blocks.length} 條「封鎖」node.exe 的規則（${blocks.map((b) => b.DisplayName).join("、")}）`);
    console.log("         後端第一次啟動時，Windows 會問「允許 node.js 存取網路嗎？」——不是系統管理員");
    console.log("         按不了允許，Windows 就自動建立封鎖規則。封鎖規則會蓋過允許規則，手機一定連不上。");
    console.log("         → 用系統管理員執行 2_firewall_open.bat，會先清掉這些封鎖規則再建立允許規則。");
  }
  if (mine) ok(`防火牆規則「${FIREWALL_RULE}」已建立`);
  else warn("還沒有防火牆規則（資訊室開通後，用系統管理員執行 2_firewall_open.bat <病人 Wi-Fi 網段>）");
} catch {
  warn("無法讀取防火牆規則（資安政策限制？）");
}

title("電源");
try {
  const out = execFileSync("powercfg", ["/query", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"], { encoding: "latin1" });
  // 輸出是本地語言，但最後兩個 0x 數值固定是「插電 / 用電池」的秒數
  const hex = out.match(/0x[0-9a-f]+/gi) ?? [];
  const ac = parseInt(hex[hex.length - 2] ?? "0", 16);
  if (ac === 0) ok("插電時不會自動睡眠");
  else {
    warn(`插電時閒置 ${Math.round(ac / 60)} 分鐘會睡眠。5_run.bat 執行期間會自動阻止睡眠，`);
    console.log("         但後端沒開的時候電腦照樣會睡。長期運作建議請資訊室把睡眠設成「永不」。");
  }
} catch {
  warn("無法讀取電源設定");
}

title("資料");
if (existsSync(DB_FILE)) ok(`資料庫 ${(statSync(DB_FILE).size / 1048576).toFixed(1)} MB`);
else warn("還沒有資料庫（4_setup.bat 會建立）");
try {
  const s = statfsSync(DATA_DIR);
  const freeGb = (s.bavail * s.bsize) / 1073741824;
  if (freeGb < 5) bad(`資料所在的磁碟只剩 ${freeGb.toFixed(1)} GB`);
  else ok(`磁碟剩 ${freeGb.toFixed(0)} GB（一張照片約 200 KB，30 人 × 3 個月約 3 GB）`);
} catch {
  /* data 資料夾還沒建 */
}
console.log(`  [資訊] 現在時間 ${new Date().toLocaleString("zh-TW")}（照片時間與憑證效期都靠它，要是對的）`);
