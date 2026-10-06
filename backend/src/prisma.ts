import { PrismaClient } from "@prisma/client";

// 單例 PrismaClient，避免 dev 模式下熱重載時開出一堆連線
export const prisma = new PrismaClient();

/**
 * 開啟 SQLite 的 WAL（Write-Ahead Logging）模式。
 *
 * 預設的 journal 模式下，**有人在寫的時候所有讀取都會被擋住**。病人在診間同步時是
 * 「上傳照片 → 寫紀錄 → 算點數」一連串的寫入，同一時間還有別的病人在看紀錄頁，
 * 不開 WAL 會互相卡住。開了之後讀寫可以並行。
 *
 * 這個設定會寫進資料庫檔案本身、之後開啟都有效，所以其實只要跑一次。這裡每次啟動都設，
 * 是為了保證不管那個檔案是誰、在哪台機器上建的都生效（例如從備份還原回來的檔案）。
 *
 * 另外兩個常見的 SQLite 設定**不需要我們管**，實測 Prisma 的 connector 自己會處理：
 * `foreign_keys` 已經是 ON（schema 的 onDelete: Cascade 靠它執行），
 * `busy_timeout` 已經是 5000ms（撞到寫入鎖時會等一下再試，不會立刻丟
 * 「database is locked」）。
 */
export async function configureDatabase(): Promise<void> {
  if (!(process.env.DATABASE_URL ?? "").startsWith("file:")) return; // 不是 SQLite 就跳過
  // 一定要用 $queryRaw 而不是 $executeRaw：這個 PRAGMA 會回傳一列結果（新的模式名稱），
  // 而 SQLite 的 $executeRaw 只要有回傳值就會丟 P2010，整個後端會在啟動時當掉。
  const [{ journal_mode }] = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>(
    "PRAGMA journal_mode = WAL;"
  );
  if (journal_mode.toLowerCase() !== "wal") {
    console.warn(`[db] 無法切換到 WAL 模式（目前是 ${journal_mode}）。讀寫會互相阻塞，請檢查資料庫檔案的權限。`);
  }
}
