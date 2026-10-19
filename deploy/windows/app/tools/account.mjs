/**
 * 6_staff_account.bat：在主機上管理帳號（沒有對應的 API，只能坐在這台電腦前面做）。
 *
 *   6_staff_account.bat create-staff <email> <密碼> [名字]   建衛教師帳號
 *   6_staff_account.bat set-role <帳號> <PATIENT|RESEARCHER|ADMIN>
 *   6_staff_account.bat summary                              收了多少帳號與紀錄
 *
 * 病人帳號不在這裡建：衛教師登入 App 後，在「我的 → 衛教師工具 → 幫病人建帳號」建立。
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { BACKEND_DIR, NODE, backendEnv, requireConfig } from "./lib.mjs";

const cfg = requireConfig();
const r = spawnSync(NODE, [join(BACKEND_DIR, "dist", "cli", "account.js"), ...process.argv.slice(2)], {
  cwd: BACKEND_DIR,
  env: backendEnv(cfg),
  stdio: "inherit",
});
process.exitCode = r.status ?? 1;
