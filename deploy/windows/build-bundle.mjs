/**
 * 在開發機上產生「醫院主機用的離線安裝包」。
 *
 *   node deploy/windows/build-bundle.mjs
 *   → release/kidney-hospital-<版本>.zip
 *
 * **為什麼要事先包好**：醫院主機不是系統管理員、而且連不到 npm / PyPI（見醫院端的環境報告），
 * 所以在那台電腦上什麼都裝不了——不能裝 Node、不能 npm install、不能 docker pull。
 * 這個安裝包裡已經有它需要的一切：可攜版 node.exe、編譯好的後端、所有套件
 * （含 Prisma 與 sharp 的 Windows 原生檔），解壓縮就能跑。
 *
 * 必須在 Windows x64 上執行：Prisma 查詢引擎、sharp 都是原生檔，在哪個平台裝，
 * 就只能在哪個平台跑。醫院主機是 Windows x64。
 *
 * 安裝包裡**不會**有：任何設定檔、密鑰、憑證、資料庫、照片。那些在醫院主機上由 4_setup 產生、
 * 或由操作的人放進 certs\。所以這個 zip 可以放心交給別人，也不怕更新時覆蓋掉資料。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BACKEND = join(REPO, "backend");
const RELEASE = join(REPO, "release");
const STAGE = join(RELEASE, "stage");
const APP = join(STAGE, "app");
// 直接用 node 跑 npm-cli.js，不經過 npm.cmd：Node 24 要求 .cmd 一定要透過 shell 執行，
// 而經過 shell 的參數不會被跳脫（會出現 DEP0190 警告）
const NPM_CLI = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");

function step(msg) {
  console.log(`\n▶ ${msg}`);
}
function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} 失敗（${r.status}）`);
}
const npm = (args, cwd) => sh(process.execPath, [NPM_CLI, ...args], cwd);

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error(`要在 Windows x64 上建置（現在是 ${process.platform}/${process.arch}）：原生檔必須跟醫院主機同一個平台`);
}

// 版本：git 的 commit + 日期，醫院端回報問題時看 /health 或 VERSION 就知道是哪一版
const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--", "backend", "deploy"], { cwd: REPO, encoding: "utf8" }).trim();
const date = new Date().toLocaleDateString("sv-SE").replace(/-/g, "");
const version = `${date}-${commit}${dirty ? "-dirty" : ""}`;
if (dirty) console.warn("⚠ backend/ 或 deploy/ 有還沒 commit 的變更，版本會標成 -dirty");

step("編譯後端");
npm(["run", "build"], BACKEND);

step("準備暫存資料夾");
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(join(APP, "node"), { recursive: true });

step(`可攜版 Node（${process.version}，就是現在這一支）`);
cpSync(process.execPath, join(APP, "node", "node.exe"));
const nodeLicense = join(dirname(process.execPath), "LICENSE");
if (existsSync(nodeLicense)) cpSync(nodeLicense, join(APP, "node", "LICENSE"));

step("後端程式");
const B = join(APP, "backend");
cpSync(join(BACKEND, "dist"), join(B, "dist"), { recursive: true, filter: (p) => !p.endsWith(".map") });
cpSync(join(BACKEND, "prisma", "schema.prisma"), join(B, "prisma", "schema.prisma"));
cpSync(join(BACKEND, "prisma", "migrations"), join(B, "prisma", "migrations"), { recursive: true });
cpSync(join(BACKEND, "scripts", "backup-db.mjs"), join(B, "scripts", "backup-db.mjs"));
cpSync(join(BACKEND, "package.json"), join(B, "package.json"));
cpSync(join(BACKEND, "package-lock.json"), join(B, "package-lock.json"));

// seed.ts → seed.mjs：主機上沒有 tsx，只做語法轉換（前端的徽章測試讀的是 seed.ts，所以原檔不動）
const ts = createRequire(join(BACKEND, "package.json"))("typescript");
const seedJs = ts.transpileModule(readFileSync(join(BACKEND, "prisma", "seed.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
writeFileSync(join(B, "prisma", "seed.mjs"), seedJs);

step("安裝正式環境的套件（在開發機上做，因為醫院主機沒有網路）");
npm(["ci", "--omit=dev", "--no-audit", "--no-fund"], B);
sh(process.execPath, [join(B, "node_modules", "prisma", "build", "index.js"), "generate", "--schema", join(B, "prisma", "schema.prisma")], B);
// 確認原生檔真的在：少了任何一個，主機上就是一啟動就當掉，而且那邊沒網路補裝
const engines = readdirSync(join(B, "node_modules", ".prisma", "client")).filter((f) => f.endsWith(".node"));
if (!engines.some((f) => /windows/.test(f))) throw new Error("沒有 Prisma 的 Windows 查詢引擎");
const schemaEngine = readdirSync(join(B, "node_modules", "@prisma", "engines")).filter((f) => /schema-engine.*windows/.test(f));
if (schemaEngine.length === 0) throw new Error("沒有 Prisma 的 Windows schema 引擎（migrate deploy 需要）");
if (!existsSync(join(B, "node_modules", "@img", "sharp-win32-x64"))) throw new Error("沒有 sharp 的 Windows 原生檔");
console.log(`  Prisma 引擎：${engines.join(", ")}、${schemaEngine.join(", ")}；sharp：win32-x64`);

step("操作腳本與工具");
cpSync(join(REPO, "deploy", "windows", "app"), APP, { recursive: true });
writeFileSync(join(APP, "VERSION"), version + "\n");

// 路徑太長的話，Windows 檔案總管的「解壓縮全部」會失敗（MAX_PATH 260）。
// 主機上的位置是 C:\Users\<帳號>\kidney\app\...，給前面留 60 個字元
function longest(dir) {
  let max = "";
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    const r = relative(STAGE, p);
    if (r.length > max.length) max = r;
    if (e.isDirectory()) {
      const m = longest(p);
      if (m.length > max.length) max = m;
    }
  }
  return max;
}
const deepest = longest(APP);
console.log(`  最長的路徑 ${deepest.length} 字元：${deepest}`);
if (deepest.length > 195) throw new Error("有路徑太長，醫院主機上用檔案總管解壓縮會失敗");

step("壓縮");
mkdirSync(RELEASE, { recursive: true });
const zip = join(RELEASE, `kidney-hospital-${version}.zip`);
rmSync(zip, { force: true });
// 用 Windows 內建的 tar（bsdtar），-a 會依副檔名做成 zip；不要用 Git Bash 的 tar（那支不會做 zip）
execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, "-C", STAGE, "app"]);

const bytes = statSync(zip).size;
const sha = createHash("sha256").update(readFileSync(zip)).digest("hex");
console.log(`\n✅ ${relative(REPO, zip)}`);
console.log(`   ${(bytes / 1048576).toFixed(1)} MB　SHA-256 ${sha}`);
console.log("   在醫院主機上：解壓縮到 %USERPROFILE%\\kidney\\（會產生 app 資料夾）→ 依序執行 1、4、5、7");
