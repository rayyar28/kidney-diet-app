/**
 * 10_verify_closed.bat：測試結束後，確認開過的東西都已經關掉。
 *
 * 醫院端的習慣是「測完就全部關掉」：防火牆規則、執行中的服務、開機自動啟動。
 * 還沒核准正式運作之前，主機上不應該留著任何對外開放的東西。
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { FIREWALL_RULE, bad, ok, readEnvFile, title } from "./lib.mjs";

const cfg = readEnvFile() ?? { PORT: "9443" };
let open = 0;
title("檢查開過的東西是否都已關閉");

try {
  const n = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `@(Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue).Count`],
    { encoding: "utf8" }
  ).trim();
  if (Number(n) > 0) {
    open++;
    bad(`防火牆規則「${FIREWALL_RULE}」還在（用系統管理員執行 2b_firewall_close.bat）`);
  } else ok("防火牆規則已移除");
} catch {
  bad("無法讀取防火牆規則");
  open++;
}

const listening = await new Promise((resolve) => {
  const s = connect({ host: "127.0.0.1", port: Number(cfg.PORT) });
  s.once("connect", () => {
    s.destroy();
    resolve(true);
  });
  s.once("error", () => resolve(false));
  s.setTimeout(3000, () => {
    s.destroy();
    resolve(false);
  });
});
if (listening) {
  open++;
  bad(`port ${cfg.PORT} 還有程式在聽（5_run.bat 的視窗關了嗎？）`);
} else ok(`port ${cfg.PORT} 沒有程式在聽`);

const startup = join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "kidney-diet-backend.bat");
if (existsSync(startup)) {
  open++;
  bad("開機自動啟動還開著（執行 9b_autostart_off.bat）");
} else ok("開機自動啟動已關閉");

title(open === 0 ? "ALL CLEAR" : `還有 ${open} 項沒關`);
process.exitCode = open === 0 ? 0 : 1;
