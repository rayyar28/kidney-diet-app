import { promises as fs } from "fs";
import path from "path";
import { env } from "../config/env.js";

/**
 * 儲存空間的抽象介面。目前只有 LocalDiskStorage 這個實作 (存到容器內的
 * uploads/ 資料夾)，但所有呼叫端都只認得這個介面，所以未來要換成
 * S3 / GCS / MinIO，只需要新增一個實作這個介面的 class，不需要改動任何
 * 呼叫 storage 的程式碼 (routes/services)。
 */
export interface StorageService {
  /** 儲存檔案，回傳可以拿去查詢/刪除用的 storageKey */
  save(params: { buffer: Buffer; keyHint: string }): Promise<string>;
  /** 依 storageKey 取得檔案的絕對路徑或可讀取的 URL */
  resolvePath(storageKey: string): string;
  read(storageKey: string): Promise<Buffer>;
}

class LocalDiskStorageService implements StorageService {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async save(params: { buffer: Buffer; keyHint: string }): Promise<string> {
    const storageKey = params.keyHint;
    const fullPath = path.join(this.rootDir, storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, params.buffer);
    return storageKey;
  }

  resolvePath(storageKey: string): string {
    return path.join(this.rootDir, storageKey);
  }

  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(storageKey));
  }
}

export const storageService: StorageService = new LocalDiskStorageService(env.uploadDir);
