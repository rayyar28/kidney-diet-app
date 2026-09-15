import { promises as fs } from "fs";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

/**
 * 儲存空間的抽象介面。
 *
 * 目前有兩個實作：
 *   - LocalDiskStorageService：存到容器內的 uploads/ 資料夾（本機開發用）
 *   - R2StorageService：存到 Cloudflare R2（正式環境用）
 *
 * 呼叫端（routes / services）只認得這個介面，所以切換儲存後端不需要改任何
 * 業務邏輯，只要改 .env 裡的 STORAGE_DRIVER。
 */
export interface StorageService {
  /** 儲存檔案，回傳可以拿去查詢/刪除用的 storageKey */
  save(params: { buffer: Buffer; keyHint: string; contentType?: string }): Promise<string>;

  /** 依 storageKey 讀回檔案內容 */
  read(storageKey: string): Promise<Buffer>;

  /**
   * 回傳一個短效的、可以直接交給瀏覽器 <img src> 或 fetch 的下載網址。
   *
   * 為什麼需要這個：如果每張照片都要先經過我們的後端再轉送給病人，
   * 所有照片流量都會算在後端主機的頻寬上（Render 會計費，而且慢）。
   * R2 可以簽發一個有時效的直連網址，讓瀏覽器直接跟 R2 拿檔案——
   * 權限檢查仍然在後端做（是後端決定要不要簽這個網址），但檔案本身
   * 不經過後端，而且 R2 不收流量出站費用。
   *
   * 本機磁碟沒有這個能力，所以回傳 null，呼叫端會自動退回成「後端讀檔後送出」。
   */
  getSignedReadUrl(storageKey: string, expiresInSeconds?: number): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// 本機磁碟（開發用）
// ---------------------------------------------------------------------------

class LocalDiskStorageService implements StorageService {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private resolvePath(storageKey: string): string {
    return path.join(this.rootDir, storageKey);
  }

  async save(params: { buffer: Buffer; keyHint: string }): Promise<string> {
    const storageKey = params.keyHint;
    const fullPath = this.resolvePath(storageKey);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, params.buffer);
    return storageKey;
  }

  async read(storageKey: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(storageKey));
  }

  async getSignedReadUrl(): Promise<string | null> {
    return null; // 本機磁碟不支援，呼叫端會退回成直接送檔案
  }
}

// ---------------------------------------------------------------------------
// Cloudflare R2（正式環境用）
//
// R2 相容 S3 API，所以直接用 AWS 的 SDK，只是把 endpoint 指向 R2。
// region 必須寫 "auto"，這是 R2 的規定。
// ---------------------------------------------------------------------------

class R2StorageService implements StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async save(params: { buffer: Buffer; keyHint: string; contentType?: string }): Promise<string> {
    const storageKey = params.keyHint;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: params.buffer,
        ContentType: params.contentType,
      })
    );
    return storageKey;
  }

  async read(storageKey: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey })
    );
    if (!result.Body) {
      throw new Error(`R2 物件沒有內容：${storageKey}`);
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async getSignedReadUrl(storageKey: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }),
      { expiresIn: expiresInSeconds }
    );
  }
}

// ---------------------------------------------------------------------------

function createStorageService(): StorageService {
  if (env.storageDriver === "r2") {
    const { accountId, accessKeyId, secretAccessKey, bucket } = env.r2;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error(
        "STORAGE_DRIVER=r2，但缺少 R2 設定。請確認 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / " +
          "R2_SECRET_ACCESS_KEY / R2_BUCKET 四個環境變數都有設定。"
      );
    }
    return new R2StorageService({ accountId, accessKeyId, secretAccessKey, bucket });
  }
  return new LocalDiskStorageService(env.uploadDir);
}

export const storageService: StorageService = createStorageService();
