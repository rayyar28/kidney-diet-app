import { env } from "../config/env.js";

/**
 * 寄信的抽象介面，做法跟 storage.service.ts 一樣：呼叫端只認得這個介面，
 * 換寄信商只要改 .env 的 MAIL_DRIVER，不必動到任何業務邏輯。
 *
 * 目前兩個實作：
 *   - ConsoleMailer：把信件內容印在後端 log（開發用，不需要任何帳號就能把流程跑完）
 *   - ResendMailer ：呼叫 Resend 的 HTTP API（正式用）
 *
 * 為什麼選 Resend 而不是 SMTP：Resend 是純 HTTP，Node 20 內建的 fetch 就能打，
 * **不需要多裝任何套件**；SMTP 得裝 nodemailer。之後若要改用學校/醫院自己的
 * SMTP 主機，就在這個檔案多一個實作類別。
 */

export interface PasswordResetMail {
  to: string;
  displayName: string;
  /** 已經排版成 XXXXX-XXXXX 的代碼 */
  code: string;
  /** 網頁版的重設網址；沒有設定 APP_URL 時是 null，信裡就只放代碼 */
  resetUrl: string | null;
  expiresInMinutes: number;
}

export interface Mailer {
  sendPasswordReset(mail: PasswordResetMail): Promise<void>;
}

function subject(): string {
  return "重設你的「腎臟飲食小幫手」密碼";
}

function textBody(mail: PasswordResetMail): string {
  const lines = [
    `${mail.displayName} 您好，`,
    "",
    "我們收到重設密碼的要求。請在 App 的「忘記密碼」畫面輸入這組代碼：",
    "",
    `    ${mail.code}`,
    "",
    `這組代碼 ${mail.expiresInMinutes} 分鐘內有效，只能使用一次。`,
  ];
  if (mail.resetUrl) {
    lines.push("", "也可以直接點這個連結重設：", mail.resetUrl);
  }
  lines.push(
    "",
    "如果這不是你本人的要求，請忽略這封信，你的密碼不會有任何變動。",
    "",
    "—— 腎臟飲食小幫手"
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 開發用：印在 log
// ---------------------------------------------------------------------------

class ConsoleMailer implements Mailer {
  async sendPasswordReset(mail: PasswordResetMail): Promise<void> {
    // 開發環境才會看到代碼本身。正式環境用的是 ResendMailer，代碼只會出現在信件裡。
    console.log(
      [
        "",
        "──────── 密碼重設信（MAIL_DRIVER=console，只印出來不寄出）────────",
        `收件者：${mail.displayName} <${mail.to}>`,
        `主旨：${subject()}`,
        "",
        textBody(mail),
        "────────────────────────────────────────────────────────",
        "",
      ].join("\n")
    );
  }
}

// ---------------------------------------------------------------------------
// 正式用：Resend HTTP API
// ---------------------------------------------------------------------------

class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async sendPasswordReset(mail: PasswordResetMail): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.from,
        to: [mail.to],
        subject: subject(),
        text: textBody(mail),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // 這裡的錯誤訊息只會進後端 log，不會回給使用者（否則就洩漏了「這個信箱有註冊」）
      throw new Error(`Resend 回應 ${res.status}: ${detail.slice(0, 300)}`);
    }
  }
}

let cached: Mailer | null = null;

export function getMailer(): Mailer {
  if (cached) return cached;
  if (env.mail.driver === "resend") {
    if (!env.mail.resendApiKey || !env.mail.from) {
      throw new Error("MAIL_DRIVER=resend 需要同時設定 RESEND_API_KEY 與 MAIL_FROM");
    }
    cached = new ResendMailer(env.mail.resendApiKey, env.mail.from);
  } else {
    cached = new ConsoleMailer();
  }
  return cached;
}

/** 測試用：換掉目前的 mailer */
export function setMailerForTests(mailer: Mailer | null): void {
  cached = mailer;
}
