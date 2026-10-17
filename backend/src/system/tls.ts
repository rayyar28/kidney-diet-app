import { readFileSync } from "node:fs";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { isIP } from "node:net";

/**
 * 讀取並檢查醫院主機的 HTTPS 憑證（server.crt / server.key）。
 *
 * 這些憑證是醫院端自建 CA 簽的（CA 私鑰離線保管，不在主機上），跟醫院原本那套後端
 * 用的是同一組。我們不自己產生憑證，也不另外建 CA——多一張 CA 就要多改一次 App。
 *
 * **為什麼要在啟動時檢查這麼多**：憑證有問題時，手機那一端只會看到「無法連線」，
 * 不會告訴你是過期、簽錯 IP、還是 key 拿錯了。30 位病人同時傳不上來才發現，
 * 跟啟動視窗裡直接寫出原因，差的是一整天。所以能在這裡擋的，全部在這裡擋。
 */

export interface TlsMaterial {
  key: Buffer;
  cert: Buffer;
  passphrase?: string;
  /** 給啟動訊息用的摘要 */
  subject: string;
  validTo: Date;
  /** 不致命、但要讓操作的人知道的事 */
  warnings: string[];
}

export class TlsConfigError extends Error {}

const DAY_MS = 86_400_000;
/** 剩不到這麼多天就提醒續簽。醫院端的續簽流程要找到離線保管的 CA 私鑰，給一個月緩衝 */
const RENEW_WARNING_DAYS = 30;

function readOrExplain(path: string, what: string): Buffer {
  try {
    return readFileSync(path);
  } catch {
    throw new TlsConfigError(
      `找不到${what}：${path}\n` +
        `  → 從醫院主機原本那套後端的 backend\\certs\\ 複製 server.crt 與 server.key 過來。` +
        `（ca.key 不需要、也不應該放在這台主機上）`
    );
  }
}

export function loadTls(opts: {
  certFile: string;
  keyFile: string;
  keyPassphrase?: string;
  publicHost?: string;
  now?: Date;
}): TlsMaterial {
  const now = opts.now ?? new Date();
  const cert = readOrExplain(opts.certFile, "伺服器憑證");
  const key = readOrExplain(opts.keyFile, "伺服器私鑰");
  const passphrase = opts.keyPassphrase || undefined;

  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(cert);
  } catch {
    throw new TlsConfigError(`${opts.certFile} 不是可以讀的 PEM 憑證（檔案壞了，或拿錯檔案？）`);
  }

  let privateKey;
  try {
    privateKey = createPrivateKey({ key, passphrase });
  } catch {
    throw new TlsConfigError(
      `${opts.keyFile} 讀不出私鑰。` + (passphrase ? "密碼（TLS_KEY_PASSPHRASE）是不是錯了？" : "如果這把 key 有設密碼，要填 TLS_KEY_PASSPHRASE。")
    );
  }
  if (!x509.checkPrivateKey(privateKey)) {
    throw new TlsConfigError(
      `server.key 跟 server.crt 不是同一組（${opts.keyFile} / ${opts.certFile}）。\n` +
        `  → 兩個檔案要從同一次簽發一起複製過來。`
    );
  }

  const validFrom = new Date(x509.validFrom);
  const validTo = new Date(x509.validTo);
  if (now < validFrom) {
    // 憑證「還沒生效」幾乎都是這台電腦的時鐘錯了，而不是憑證錯了
    throw new TlsConfigError(
      `憑證要到 ${validFrom.toISOString()} 才生效，但這台電腦現在是 ${now.toISOString()}。\n` +
        `  → 先檢查電腦的日期時間。時鐘錯了，手機也會拒絕連線，而且照片的拍攝時間會全部記錯。`
    );
  }
  if (now >= validTo) {
    throw new TlsConfigError(
      `憑證已經在 ${validTo.toISOString()} 過期了，手機會拒絕連線。\n` +
        `  → 依醫院端文件的續簽流程重簽 server.crt（只換伺服器憑證，App 不用重新安裝）。`
    );
  }

  const warnings: string[] = [];
  const daysLeft = Math.floor((validTo.getTime() - now.getTime()) / DAY_MS);
  if (daysLeft < RENEW_WARNING_DAYS) {
    warnings.push(`憑證再 ${daysLeft} 天就過期（${validTo.toISOString().slice(0, 10)}），請盡快續簽。`);
  }

  if (opts.publicHost) {
    const host = opts.publicHost;
    const matches = isIP(host) ? x509.checkIP(host) !== undefined : x509.checkHost(host) !== undefined;
    if (!matches) {
      throw new TlsConfigError(
        `憑證不是簽給 ${host} 的（憑證上的名稱：${x509.subjectAltName ?? x509.subject}）。\n` +
          `  → 手機連 ${host} 時會拒絕這張憑證。確認 PUBLIC_HOST 是主機目前的 IP，` +
          `或請醫院端用這個 IP 重簽 server.crt。`
      );
    }
  } else {
    warnings.push("沒有設定 PUBLIC_HOST，無法確認憑證是不是簽給手機要連的那個位址。");
  }

  return {
    key,
    cert,
    passphrase,
    subject: x509.subjectAltName ?? x509.subject,
    validTo,
    warnings,
  };
}
