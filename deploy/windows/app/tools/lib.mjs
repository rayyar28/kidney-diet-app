/**
 * 醫院主機上各個工具共用的東西。
 *
 * 資料夾配置（安裝在 %USERPROFILE%\kidney\ 底下）：
 *
 *   kidney\
 *     app\        ← 程式。更新時「整個刪掉、重新解壓縮」也沒關係
 *     config\     ← kidney.env：port、憑證位置、JWT 密鑰。4_setup 第一次執行時產生
 *     certs\      ← server.crt / server.key / ca.crt（從醫院原本那套後端複製來）
 *     data\       ← kidney.db 與照片。**這是病人資料，絕對不能刪**
 *     backups\    ← 8_backup 的輸出
 *     logs\       ← 每天一個 log 檔
 *
 * **為什麼程式跟資料要分開放**：醫院端的更新方式是「解壓縮覆蓋」，而且已經發生過一次
 * 整個資料夾遺失、只好重建 CA 的事（見醫院端的系統資訊）。程式放在 app\ 裡、資料放在外面，
 * 更新時就算有人先把 app\ 刪掉，資料也不會跟著不見。
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const APP_DIR = resolve(here, "..");
export const HOME = resolve(APP_DIR, "..");
export const BACKEND_DIR = join(APP_DIR, "backend");
export const NODE = process.execPath; // 就是 app\node\node.exe
export const CONFIG_FILE = join(HOME, "config", "kidney.env");
export const CERTS_DIR = join(HOME, "certs");
export const DATA_DIR = join(HOME, "data");
export const UPLOADS_DIR = join(DATA_DIR, "uploads");
export const DB_FILE = join(DATA_DIR, "kidney.db");
export const BACKUPS_DIR = join(HOME, "backups");
export const LOGS_DIR = join(HOME, "logs");
export const PRISMA_CLI = join(BACKEND_DIR, "node_modules", "prisma", "build", "index.js");
export const SCHEMA = join(BACKEND_DIR, "prisma", "schema.prisma");

/** Prisma 的 SQLite 網址要用正斜線，反斜線會被當成跳脫字元 */
export const toPrismaFileUrl = (p) => `file:${p.replace(/\\/g, "/")}`;

/** 讀 KEY=VALUE 格式的設定檔（跟 .env 一樣）。不用 dotenv：工具不在 backend 的 node_modules 底下 */
export function readEnvFile(path = CONFIG_FILE) {
  if (!existsSync(path)) return null;
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

export function requireConfig() {
  const cfg = readEnvFile();
  if (!cfg) fail(`找不到設定檔 ${CONFIG_FILE}\n  → 先執行 4_setup.bat`);
  return cfg;
}

/** 給後端程式的環境變數：設定檔 + 幾個由這裡決定、不該讓人手改的值 */
export function backendEnv(cfg) {
  return {
    ...process.env,
    ...cfg,
    // 醫院主機沒有網路：不要讓 Prisma 試著連線回報版本資訊（會卡住等逾時）
    CHECKPOINT_DISABLE: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    APP_VERSION: readVersion(),
  };
}

export function readVersion() {
  const f = join(APP_DIR, "VERSION");
  return existsSync(f) ? readFileSync(f, "utf8").trim() : "unknown";
}

export const ok = (msg) => console.log(`  [OK]   ${msg}`);
export const warn = (msg) => console.log(`  [注意] ${msg}`);
export const bad = (msg) => console.log(`  [問題] ${msg}`);
export const title = (msg) => console.log(`\n===== ${msg} =====`);

export function fail(message) {
  console.error(`\n[失敗] ${message}\n`);
  process.exit(1);
}

/** 防火牆規則的名稱：2_firewall_open 建、2b_firewall_close 刪、10_verify_closed 檢查，三邊要一致 */
export const FIREWALL_RULE = "kidney-diet-backend";
