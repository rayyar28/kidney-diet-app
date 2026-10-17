/**
 * 8_backup.bat：備份資料庫與照片到 backups\<日期時間>\。後端開著也可以備份。
 *
 * **不能直接複製 kidney.db**：資料庫開著 WAL 模式，內容分散在 .db 與 .db-wal 兩個檔案，
 * 有人正在上傳時複製，很可能拿到一個還原回來會壞掉的快照——而且是還原那天才會發現。
 * 這裡用 SQLite 內建的 VACUUM INTO 產生一份完整、一致的資料庫檔案。
 *
 * ⚠ 備份裡就是病人資料（照片＋紀錄）。放在同一台電腦上只能防「誤刪」，防不了硬碟壞掉或電腦被偷；
 *   要定期複製到另一個地方（有加密的外接硬碟），而且那個地方一樣要符合 IRB 的資料保護規定。
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BACKEND_DIR, BACKUPS_DIR, NODE, UPLOADS_DIR, backendEnv, fail, ok, requireConfig, title, warn } from "./lib.mjs";

const cfg = requireConfig();
const stamp = new Date().toLocaleString("sv-SE").replace(/[: ]/g, "").replace(/-/g, ""); // 20261018143000
const dest = join(BACKUPS_DIR, stamp.slice(0, 8) + "-" + stamp.slice(8));
mkdirSync(dest, { recursive: true });

title(`備份到 ${dest}`);
const r = spawnSync(NODE, [join(BACKEND_DIR, "scripts", "backup-db.mjs"), join(dest, "kidney.db")], {
  cwd: BACKEND_DIR,
  env: backendEnv(cfg),
  encoding: "utf8",
});
if (r.status !== 0) fail(`資料庫備份失敗：${(r.stderr || r.stdout).trim()}`);
ok(`資料庫 ${(statSync(join(dest, "kidney.db")).size / 1048576).toFixed(1)} MB`);

function sizeOf(dir) {
  let bytes = 0;
  let files = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const s = sizeOf(p);
      bytes += s.bytes;
      files += s.files;
    } else {
      bytes += statSync(p).size;
      files += 1;
    }
  }
  return { bytes, files };
}

if (existsSync(UPLOADS_DIR)) {
  cpSync(UPLOADS_DIR, join(dest, "uploads"), { recursive: true });
  const s = sizeOf(join(dest, "uploads"));
  ok(`照片 ${s.files} 張，${(s.bytes / 1048576).toFixed(0)} MB`);
} else {
  warn("還沒有照片資料夾");
}

const all = readdirSync(BACKUPS_DIR).filter((n) => /^\d{8}-\d{6}$/.test(n));
title("完成");
console.log(`  目前共有 ${all.length} 份備份。不會自動刪舊的——那是病人資料，要刪由人決定。`);
console.log("  ⚠ 這份備份還在同一台電腦上。請複製到另一個地方（有加密的外接硬碟）。");
