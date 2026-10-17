/**
 * 5_run.bat：啟動後端。視窗要保持開著，關掉視窗後端就停了。
 *
 * 輸出同時印在視窗上、也寫進 logs\backend-YYYY-MM-DD.log——
 * 開機自動啟動（9_autostart_on）時沒有人看著視窗，出事只能看 log。
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BACKEND_DIR, LOGS_DIR, NODE, backendEnv, fail, readVersion, requireConfig } from "./lib.mjs";

const cfg = requireConfig();
if (!existsSync(cfg.TLS_CERT_FILE)) {
  fail(`找不到 ${cfg.TLS_CERT_FILE}\n  → 先把 server.crt / server.key 放進 certs 資料夾（見 4_setup.bat 的說明）`);
}

mkdirSync(LOGS_DIR, { recursive: true });
const day = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD，用本地時間
const log = createWriteStream(join(LOGS_DIR, `backend-${day}.log`), { flags: "a" });
const stamp = () => new Date().toLocaleString("sv-SE");
log.write(`\n---- ${stamp()} 啟動（版本 ${readVersion()}）----\n`);

console.log(`腎臟飲食 App 後端（版本 ${readVersion()}）`);
console.log(`手機要連：https://${cfg.PUBLIC_HOST}:${cfg.PORT}`);
console.log("這個視窗要保持開著；要停止就按 Ctrl+C 或關掉視窗。\n");

const child = spawn(NODE, [join(BACKEND_DIR, "dist", "index.js")], {
  cwd: BACKEND_DIR,
  env: backendEnv(cfg),
  stdio: ["ignore", "pipe", "pipe"],
});
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
}
// Ctrl+C 時把後端一起帶走，不要留下佔著 port 的孤兒程序
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => child.kill());

child.on("exit", (code) => {
  log.write(`---- ${stamp()} 結束（代碼 ${code}）----\n`);
  log.end(() => process.exit(code ?? 1));
});
