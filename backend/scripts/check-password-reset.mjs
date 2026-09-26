/**
 * 「忘記密碼」的端到端檢查（含惡意情境）。
 *
 *   npm run check:password-reset
 *
 * 這支腳本會自己起一個後端（MAIL_DRIVER=console，攔截 stdout 取出代碼）、跑完所有檢查、
 * 再把自己建立的測試帳號清乾淨。用的是開發用的資料庫，不會動到既有資料。
 *
 * 為什麼是腳本而不是單元測試：這裡要驗的幾乎都是「跨層」的性質——HTTP 狀態碼、
 * 資料庫實際存了什麼、refresh token 有沒有真的被撤銷、速率限制有沒有生效。
 * 拿真的伺服器配真的資料庫跑一次，比模擬出來的測試更有說服力。
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

const PORT = Number(process.env.CHECK_PORT ?? 4123);
const BASE = `http://127.0.0.1:${PORT}/api`;
const prisma = new PrismaClient();

const results = [];
let serverOut = "";

function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  const mark = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${mark}  ${name}${detail && !passed ? `\n        → ${detail}` : ""}`);
}

/**
 * 後端有 `app.set("trust proxy", 1)`，所以 express-rate-limit 是依 X-Forwarded-For 分桶的。
 * 每次請求預設帶一個新的假 IP，檢查腳本就不會被自己的限流擋住——
 * **不必為了跑檢查在程式裡留一個「關閉限流」的開關**（那種開關萬一被設到正式環境就等於沒有限流）。
 * 限流本身另外用固定 IP 驗（見「7. 速率限制」）。
 */
const freshIp = () =>
  `10.${Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 254)}`;

async function post(path, body, token, ip = freshIp()) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 204 沒有 body */
  }
  return { status: res.status, body: json };
}

/** 等後端把信「寄」出來（console driver 會印在 stdout），從中抓出代碼 */
async function waitForMailedCode(afterOffset) {
  for (let i = 0; i < 40; i += 1) {
    const fresh = serverOut.slice(afterOffset);
    const m = /([2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5})/.exec(fresh);
    if (m) return m[1];
    await sleep(100);
  }
  return null;
}

const rand = () => Math.random().toString(36).slice(2, 10);
const emailFor = (tag) => `pwreset-check-${tag}-${rand()}@example.invalid`;
const createdEmails = [];

async function register(email, password = "Password123") {
  createdEmails.push(email);
  const res = await post("/auth/register", { email, password, displayName: "檢查用帳號" });
  if (res.status !== 201) throw new Error(`註冊失敗 ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function login(email, password) {
  return post("/auth/login", { email, password });
}

async function run() {
  console.log("\n=== 1. 不洩漏「這個信箱有沒有註冊」 ===");
  {
    const known = emailFor("enum");
    await register(known);
    const a = await post("/auth/forgot-password", { email: known });
    const b = await post("/auth/forgot-password", { email: `nobody-${rand()}@example.invalid` });
    check("已註冊與未註冊的信箱回同樣的狀態碼", a.status === 204 && b.status === 204, `${a.status} vs ${b.status}`);
    check("回應沒有 body（沒有任何可比對的差異）", a.body === null && b.body === null);

    const ghost = await prisma.passwordResetToken.count({
      where: { user: { email: { startsWith: "nobody-" } } },
    });
    check("未註冊的信箱不會在資料庫留下任何代碼", ghost === 0, `找到 ${ghost} 筆`);
  }

  console.log("\n=== 2. 正常流程 ===");
  let flowEmail;
  {
    flowEmail = emailFor("flow");
    await register(flowEmail);
    const before = serverOut.length;
    await post("/auth/forgot-password", { email: flowEmail });
    const code = await waitForMailedCode(before);
    check("信件裡有一組 XXXXX-XXXXX 的代碼", Boolean(code), String(code));
    if (!code) return;

    const stored = await prisma.passwordResetToken.findFirst({
      where: { user: { email: flowEmail } },
      orderBy: { createdAt: "desc" },
    });
    check("資料庫存的是雜湊，不是代碼本身", Boolean(stored) && !JSON.stringify(stored).includes(code.replace("-", "")));
    check("來源標記為 SELF_SERVICE", stored?.source === "SELF_SERVICE", stored?.source);

    // 先登入拿一組 refresh token，待會驗證重設後會不會被撤銷
    const session = await login(flowEmail, "Password123");
    const oldRefresh = session.body.refreshToken;

    const reset = await post("/auth/reset-password", { code, password: "BrandNew456" });
    check("用代碼重設密碼成功", reset.status === 204, `${reset.status} ${JSON.stringify(reset.body)}`);

    const withNew = await login(flowEmail, "BrandNew456");
    check("新密碼可以登入", withNew.status === 200, String(withNew.status));
    const withOld = await login(flowEmail, "Password123");
    check("舊密碼不能再登入", withOld.status === 401, String(withOld.status));

    const refreshed = await post("/auth/refresh", { refreshToken: oldRefresh });
    check("重設前發出的 refresh token 已失效", refreshed.status === 401, String(refreshed.status));

    const reuse = await post("/auth/reset-password", { code, password: "Another789" });
    check("同一組代碼不能用第二次", reuse.status === 400, String(reuse.status));
    const stillNew = await login(flowEmail, "BrandNew456");
    check("重送失敗後密碼沒有被改掉", stillNew.status === 200, String(stillNew.status));
  }

  console.log("\n=== 3. 代碼輸入的容錯 ===");
  {
    const email = emailFor("format");
    await register(email);
    const before = serverOut.length;
    await post("/auth/forgot-password", { email });
    const code = await waitForMailedCode(before);
    const messy = ` ${code.replace("-", "").toLowerCase()} `; // 小寫、沒有連字號、前後有空白
    const res = await post("/auth/reset-password", { code: messy, password: "Sloppy12345" });
    check("小寫 / 沒打連字號 / 前後空白照樣可以用", res.status === 204, `${res.status} 送出的是「${messy}」`);
  }

  console.log("\n=== 4. 猜不到、也繞不過 ===");
  {
    const email = emailFor("guess");
    await register(email);
    const before = serverOut.length;
    await post("/auth/forgot-password", { email });
    const code = await waitForMailedCode(before);

    const bogus = await post("/auth/reset-password", { code: "AAAAA-BBBBB", password: "Whatever123" });
    check("亂猜一組合法格式的代碼會被拒絕", bogus.status === 400, String(bogus.status));

    const tooShort = await post("/auth/reset-password", { code: "ABC", password: "Whatever123" });
    check("長度不對的代碼會被拒絕", tooShort.status === 400, String(tooShort.status));

    const illegal = await post("/auth/reset-password", { code: "OOOOO-IIIII", password: "Whatever123" });
    check("含排除字元（O/I）的代碼會被拒絕", illegal.status === 400, String(illegal.status));

    const messages = new Set([bogus.body?.error, tooShort.body?.error, illegal.body?.error]);
    check("各種失敗回同一句話，問不出代碼是否存在", messages.size === 1, [...messages].join(" / "));

    const weak = await post("/auth/reset-password", { code, password: "short" });
    check("密碼太短會被擋下", weak.status === 400, String(weak.status));
    const stillUsable = await post("/auth/reset-password", { code, password: "LongEnough123" });
    check("被擋下時代碼沒有被消耗掉（還能再用）", stillUsable.status === 204, String(stillUsable.status));
  }

  console.log("\n=== 5. 有效期與唯一性 ===");
  {
    const email = emailFor("expiry");
    await register(email);

    const before1 = serverOut.length;
    await post("/auth/forgot-password", { email });
    const first = await waitForMailedCode(before1);
    const before2 = serverOut.length;
    await post("/auth/forgot-password", { email });
    const second = await waitForMailedCode(before2);
    check("兩次申請拿到不同代碼", first !== second, `${first} / ${second}`);

    const oldOne = await post("/auth/reset-password", { code: first, password: "Replaced123" });
    check("重新申請之後，前一組代碼立刻失效", oldOne.status === 400, String(oldOne.status));

    // 把這一組直接改成過期，驗證過期檢查真的有生效
    await prisma.passwordResetToken.updateMany({
      where: { user: { email }, usedAt: null },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const expired = await post("/auth/reset-password", { code: second, password: "Replaced123" });
    check("過期的代碼不能用", expired.status === 400, String(expired.status));
    const after = await login(email, "Password123");
    check("過期代碼送出後密碼沒有被改", after.status === 200, String(after.status));
  }

  console.log("\n=== 6. 衛教師代開（權限） ===");
  {
    const patient = emailFor("staffpatient");
    await register(patient);
    const staff = emailFor("staff");
    const staffSession = await register(staff);

    const anon = await post("/staff/password-resets", { email: patient });
    check("沒有登入 → 401", anon.status === 401, String(anon.status));

    const asPatient = await post("/staff/password-resets", { email: patient }, staffSession.accessToken);
    check("一般病人身分 → 403", asPatient.status === 403, String(asPatient.status));

    // 升級成研究人員之後要重新登入，權限是寫在 access token 裡的
    await prisma.user.update({ where: { email: staff }, data: { role: "RESEARCHER" } });
    const reSignedIn = await login(staff, "Password123");
    const issued = await post("/staff/password-resets", { email: patient }, reSignedIn.body.accessToken);
    check("研究人員可以開立", issued.status === 200, `${issued.status} ${JSON.stringify(issued.body)}`);
    check("回應裡有代碼與有效期", Boolean(issued.body?.code && issued.body?.expiresAt));

    const row = await prisma.passwordResetToken.findFirst({
      where: { user: { email: patient } },
      orderBy: { createdAt: "desc" },
    });
    check("來源標記為 STAFF", row?.source === "STAFF", row?.source);
    check("有記錄是哪位工作人員開的", Boolean(row?.issuedById), String(row?.issuedById));

    const used = await post("/auth/reset-password", { code: issued.body.code, password: "StaffIssued123" });
    check("病人可以用這組代碼重設", used.status === 204, String(used.status));
    const ok = await login(patient, "StaffIssued123");
    check("重設後新密碼可以登入", ok.status === 200, String(ok.status));

    const notFound = await post(
      "/staff/password-resets",
      { email: `ghost-${rand()}@example.invalid` },
      reSignedIn.body.accessToken
    );
    check("查無帳號時明確回 404（操作者已驗證身分，沒有列舉風險）", notFound.status === 404, String(notFound.status));
  }

  console.log();
  console.log("=== 7. 速率限制 ===");
  {
    // 固定同一個假 IP，模擬同一個人連續嘗試
    const attackerIp = "203.0.113.77";
    let forgotBlocked = false;
    for (let i = 0; i < 8; i += 1) {
      const res = await post("/auth/forgot-password", { email: `probe-${i}@example.invalid` }, null, attackerIp);
      if (res.status === 429) {
        forgotBlocked = true;
        break;
      }
    }
    check("連續申請重設會被擋下（429）", forgotBlocked);

    const guesserIp = "203.0.113.99";
    let resetBlocked = false;
    for (let i = 0; i < 14; i += 1) {
      const res = await post("/auth/reset-password", { code: "AAAAA-BBBBB", password: "Whatever123" }, null, guesserIp);
      if (res.status === 429) {
        resetBlocked = true;
        break;
      }
    }
    check("連續猜代碼會被擋下（429）", resetBlocked);
  }
}

async function cleanup() {
  if (createdEmails.length === 0) return;
  // PasswordResetToken / RefreshToken 都是 onDelete: Cascade，刪帳號就一起清掉
  const { count } = await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  console.log(`\n清理：刪除 ${count} 個測試帳號`);
}

async function startServer() {
  // 不能用 shell:true：在 Windows 上那樣 spawn 出來的是 cmd.exe，child.kill() 只殺得到殼層，
  // 真正的 node 行程會留下來佔著連接埠，下一次跑這支腳本就會起不來。
  // `node --import tsx` 直接就是我們要殺的那個行程。
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      MAIL_DRIVER: "console",
      APP_URL: "",
    },
  });
  child.stdout.on("data", (d) => {
    serverOut += d.toString();
  });
  child.stderr.on("data", (d) => {
    serverOut += d.toString();
  });

  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return child;
    } catch {
      /* 還沒起來 */
    }
    await sleep(200);
  }
  child.kill();
  throw new Error(`後端在 20 秒內沒有起來（連接埠 ${PORT} 是不是被佔著？）。輸出：\n${serverOut.slice(-2000)}`);
}

const server = await startServer();
// 中途被 Ctrl+C 或例外中斷時也要把後端收掉，不然連接埠會被佔著
const stopServer = () => {
  if (!server.killed) server.kill();
};
process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

try {
  await run();
} catch (err) {
  check("腳本本身執行完成", false, String(err));
} finally {
  await cleanup().catch((e) => console.error("清理失敗", e));
  await prisma.$disconnect();
  server.kill();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length} / ${results.length} 項通過`);
if (failed.length > 0) {
  console.log("\n沒通過的項目：");
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  process.exit(1);
}
process.exit(0);
