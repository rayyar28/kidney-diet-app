/**
 * 把 SQLite 資料庫備份成一個檔案。
 *
 *   npm run backup:db -- /tmp/kidney.db
 *
 * **為什麼不是直接複製檔案**：資料庫開著 WAL 模式，真正的內容分散在 `kidney.db`、
 * `kidney.db-wal` 兩個檔案裡。在有人正在寫入的時候複製，很可能拿到一個不完整、
 * 還原回來會壞掉的快照——而且你不會當場發現，是還原的那天才發現。
 *
 * `VACUUM INTO` 是 SQLite 內建的線上備份：它在交易保護下把整個資料庫寫成一個**乾淨、
 * 已整理過**的新檔案，過程中不需要停止服務，產出的檔案可以直接拿來用。
 *
 * 用 Node + Prisma 來做而不是 sqlite3 指令，是因為正式環境的容器裡本來就有這兩個，
 * 不必額外安裝任何東西（醫院那台可能連不到外網，裝不了東西）。
 */

import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import path from "node:path";

const dest = process.argv[2];
if (!dest) {
  console.error("用法：npm run backup:db -- <輸出檔案路徑>");
  process.exit(1);
}

// VACUUM INTO 拒絕覆寫已存在的檔案，先講清楚比讓它丟原始錯誤好懂
if (existsSync(dest)) {
  console.error(`輸出檔案已經存在：${dest}（VACUUM INTO 不會覆寫，請先刪掉或換個檔名）`);
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const target = path.resolve(dest).replace(/'/g, "''"); // 單引號在 SQL 字串裡要跳脫
  await prisma.$executeRawUnsafe(`VACUUM INTO '${target}'`);
  console.log(`backup ok: ${dest}`);
} catch (err) {
  console.error("備份失敗:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
