/**
 * 醫院主機設定的端到端檢查：用「跟醫院主機一樣的設定」實際啟動後端，從外面打它。
 *
 *   npm run check:hospital
 *
 * 跟 check-password-reset.mjs 的差別：那支測的是忘記密碼的邏輯（用 http、開放註冊）；
 * 這支測的是**醫院主機那種跑法**——Node 自己提供 HTTPS、前面沒有代理、不開放註冊、
 * 病人用研究編號登入。兩種設定的行為刻意不同（例如 X-Forwarded-For 要不要相信），
 * 所以要分開驗。
 *
 * 每次都用一個全新的暫存資料庫（從 migrations 建起來），也就順便驗了
 * 「在一台全新的主機上，資料庫可以從零建好」。開發機上的資料完全不會被碰到。
 *
 * 需要 openssl 產生一張測試用 CA（Git for Windows 有附）。CA 用完即丟，跟醫院那張無關。
 */

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.CHECK_PORT ?? 4443);
const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed });
  const mark = passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${mark}  ${name}${detail && !passed ? `\n        → ${detail}` : ""}`);
}
function skip(name, why) {
  console.log(`  \x1b[33mSKIP\x1b[0m  ${name}（${why}）`);
}
const section = (t) => console.log(`\n=== ${t} ===`);

// ---------------------------------------------------------------------------
// 測試用 CA 與憑證
// ---------------------------------------------------------------------------

function findOpenssl() {
  const candidates = ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe"];
  for (const c of candidates) {
    const r = spawnSync(c, ["version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return null;
}

/** 用設定檔而不是 -subj：Git for Windows 的 openssl 會把 "/CN=..." 當成路徑亂轉 */
function makeCerts(openssl, dir) {
  const run = (args) => execFileSync(openssl, args, { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "ca.cnf"), "[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3_ca\n[dn]\nCN=kidney-diet check CA (throwaway)\n[v3_ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n");
  writeFileSync(join(dir, "server.cnf"), "[req]\nprompt=no\ndistinguished_name=dn\n[dn]\nCN=127.0.0.1\n");
  writeFileSync(join(dir, "ext.cnf"), "subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
  run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.crt", "-days", "30", "-config", "ca.cnf"]);
  run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "server.key", "-out", "server.csr", "-config", "server.cnf"]);
  run(["x509", "-req", "-in", "server.csr", "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", "server.crt", "-days", "30", "-extfile", "ext.cnf"]);
  run(["genrsa", "-out", "other.key", "2048"]); // 不成對的 key，測「拿錯檔案」
  return {
    ca: readFileSync(join(dir, "ca.crt")),
    cert: join(dir, "server.crt"),
    key: join(dir, "server.key"),
    otherKey: join(dir, "other.key"),
  };
}

// ---------------------------------------------------------------------------
// 啟動後端
// ---------------------------------------------------------------------------

const children = new Set();
function killAll() {
  for (const c of children) c.kill();
}
process.on("exit", killAll);
process.on("SIGINT", () => {
  killAll();
  process.exit(130);
});

/**
 * 用醫院主機的設定啟動後端。刻意把每個相關設定都寫死在這裡，
 * 不要讓開發者 .env 裡的值（例如開放註冊、TRUST_PROXY）混進來影響結果。
 */
function startBackend({ dbUrl, uploadDir, tls, extraEnv = {} }) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      TLS_CERT_FILE: tls.cert,
      TLS_KEY_FILE: tls.key,
      TLS_KEY_PASSPHRASE: "",
      PUBLIC_HOST: "127.0.0.1",
      TRUST_PROXY: "", // 不設定 → 自己提供 HTTPS 時應該自動是 false
      ALLOW_PUBLIC_REGISTRATION: "false",
      ALLOW_EMAIL_PASSWORD_RESET: "false",
      STORAGE_DRIVER: "local",
      UPLOAD_DIR: uploadDir,
      MAIL_DRIVER: "console",
      KEEP_AWAKE: "false",
      JWT_ACCESS_SECRET: "check-hospital-access-secret-not-for-production",
      JWT_REFRESH_SECRET: "check-hospital-refresh-secret-not-for-production",
      ...extraEnv,
    },
  });
  children.add(child);
  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  child.once("exit", () => children.delete(child));
  return {
    child,
    output: () => output,
    exited,
    /**
     * 等到啟動訊息全部印完；如果先結束了就回傳 false。
     * 要等的是最後一行（Public registration），不是第一行（listening on）：
     * 那幾行是分開 console.log 的，stdout 可能分好幾次送到，只等第一行的話，
     * 後面檢查「Trust proxy: false」時那一行可能還沒收到——實際發生過，會隨機失敗。
     */
    async ready(timeoutMs = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (/Public registration: /.test(output)) return true;
        if (child.exitCode !== null) return false;
        await new Promise((r) => setTimeout(r, 150));
      }
      return false;
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill();
      await exited;
    },
    /**
     * 給「應該拒絕啟動」的檢查用：等它自己結束，最多等 timeoutMs。
     * 時間到還活著 = 它其實成功啟動了（也就是該擋的沒擋），砍掉並回傳 "still-running"。
     * 不能無限期等：變異測試時真的發生過——檢查被拿掉後伺服器正常啟動，腳本就永遠卡住。
     */
    async exitCode(timeoutMs = 20000) {
      const timer = new Promise((r) => setTimeout(() => r("still-running"), timeoutMs));
      const result = await Promise.race([exited, timer]);
      if (result === "still-running") {
        child.kill();
        await exited;
      }
      return result;
    },
  };
}

// ---------------------------------------------------------------------------
// HTTPS 請求（要能指定信任哪張 CA，fetch 做不到）
// ---------------------------------------------------------------------------

function request(path, { method = "GET", body, token, ca, headers = {}, plain = false } = {}) {
  const lib = plain ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path,
        method,
        ...(plain ? {} : { ca }),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        timeout: 15000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            /* 不是 JSON */
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** 讀取整台電腦目前的執行狀態旗標（不需要系統管理員） */
function systemExecutionState() {
  const probe = [
    "Add-Type -Namespace Probe -Name P -MemberDefinition '[DllImport(\"powrprof.dll\")] public static extern uint CallNtPowerInformation(int level, System.IntPtr inBuf, uint inLen, out uint outBuf, uint outLen);'",
    "$s = 0",
    "[void][Probe.P]::CallNtPowerInformation(16, [System.IntPtr]::Zero, 0, [ref]$s, 4)",
    "Write-Output $s",
  ].join("; ");
  return Number(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", probe], { encoding: "utf8" }).trim());
}

// ---------------------------------------------------------------------------

async function main() {
  const openssl = findOpenssl();
  if (!openssl) {
    console.error("找不到 openssl（Git for Windows 有附）。沒有它就沒辦法產生測試用的憑證。");
    process.exit(1);
  }

  const work = mkdtempSync(join(tmpdir(), "kidney-hospital-check-"));
  const dbFile = join(work, "check.db").replace(/\\/g, "/");
  const dbUrl = `file:${dbFile}`;
  const uploadDir = join(work, "uploads");
  try {
    const tls = makeCerts(openssl, work);

    // ---- 全新資料庫（從 migrations 建起來）----
    section("1. 在全新的主機上建資料庫");
    const migrate = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: dbUrl, CHECKPOINT_DISABLE: "1" },
      encoding: "utf8",
    });
    check("prisma migrate deploy 從零建好資料庫", migrate.status === 0, (migrate.stderr || migrate.stdout).slice(-400));

    // ---- 憑證有問題時，拒絕啟動，而且講清楚原因 ----
    section("2. 憑證有問題時拒絕啟動，並說明原因");
    {
      const b = startBackend({ dbUrl, uploadDir, tls, extraEnv: { PUBLIC_HOST: "10.9.9.9" } });
      const code = await b.exitCode();
      check("憑證不是簽給 PUBLIC_HOST → 拒絕啟動", code === 1, `exit=${code}`);
      check("並說明是「憑證不是簽給 10.9.9.9」", /不是簽給 10\.9\.9\.9/.test(b.output()), b.output().slice(-300));
    }
    {
      const b = startBackend({ dbUrl, uploadDir, tls: { ...tls, key: tls.otherKey } });
      const code = await b.exitCode();
      check("key 跟 cert 不是同一組 → 拒絕啟動", code === 1 && /不是同一組/.test(b.output()), b.output().slice(-300));
    }
    {
      const b = startBackend({ dbUrl, uploadDir, tls: { ...tls, cert: join(work, "missing.crt") } });
      const code = await b.exitCode();
      check("找不到憑證檔 → 拒絕啟動，並說明要從哪裡複製", code === 1 && /找不到伺服器憑證/.test(b.output()), b.output().slice(-300));
    }
    {
      // 過期 / 還沒生效 / 快過期：直接呼叫檢查函式，給它一個假的「現在」
      const { loadTls } = await import("../src/system/tls.ts");
      const base = { certFile: tls.cert, keyFile: tls.key, publicHost: "127.0.0.1" };
      const throwsWith = (now, pattern) => {
        try {
          loadTls({ ...base, now });
          return false;
        } catch (e) {
          return pattern.test(e.message);
        }
      };
      check("憑證已過期 → 拒絕", throwsWith(new Date(Date.now() + 60 * 86400000), /已經在 .* 過期/));
      check("憑證還沒生效（多半是電腦時鐘錯了）→ 拒絕並提示檢查時間", throwsWith(new Date(Date.now() - 2 * 86400000), /檢查電腦的日期時間/));
      const ok = loadTls(base);
      check("剩不到 30 天 → 照常啟動但提醒續簽", ok.warnings.some((w) => /就過期/.test(w)), JSON.stringify(ok.warnings));
    }

    // ---- 正常啟動 ----
    section("3. 用醫院設定啟動：Node 自己提供 HTTPS");
    const server = startBackend({ dbUrl, uploadDir, tls });
    const up = await server.ready();
    check("後端以 HTTPS 啟動", up && /listening on https:\/\/127\.0\.0\.1/.test(server.output()), server.output().slice(-500));
    if (!up) throw new Error("後端沒有起來，後面的檢查無法進行");
    check("沒有設定 TRUST_PROXY 時，自己提供 HTTPS → 自動不相信 X-Forwarded-For", /Trust proxy: false/.test(server.output()));
    check("公開註冊是關閉的", /Public registration: closed/.test(server.output()));

    const health = await request("/health", { ca: tls.ca }).catch((e) => ({ status: 0, json: null, error: String(e.code ?? e.message) }));
    if (health.error) check("用內建的 CA 連得上 HTTPS", false, health.error);
    check("GET /health（醫院端慣用的連線測試路徑）", health.status === 200 && health.json?.ok === true);
    check("/health 回報 service = kidney-diet（分得出不是舊的 FastAPI 在接）", health.json?.service === "kidney-diet");
    const apiHealth = await request("/api/health", { ca: tls.ca });
    check("GET /api/health 照舊可用（App 的設定畫面在用）", apiHealth.status === 200 && apiHealth.json?.ok === true);

    // 不信任測試 CA 的客戶端（就像一支沒有內建醫院 CA 的手機）。
    // 要確認是「因為憑證」被拒，而不是因為別的原因連不上——Node 的憑證錯誤代碼長這樣：
    // UNABLE_TO_VERIFY_LEAF_SIGNATURE（實測是這個）/ UNABLE_TO_GET_ISSUER_CERT_LOCALLY /
    // SELF_SIGNED_CERT_IN_CHAIN / DEPTH_ZERO_SELF_SIGNED_CERT
    let untrustedOutcome = "連上了（不應該）";
    try {
      await request("/health");
    } catch (e) {
      untrustedOutcome = String(e.code ?? e.message);
    }
    check(
      "沒有內建這張 CA 的客戶端 → 因為憑證被拒（憑證確實有在用）",
      /^(UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT)$/.test(
        untrustedOutcome
      ),
      untrustedOutcome
    );

    let plaintextServed = false;
    try {
      const r = await request("/health", { plain: true });
      plaintextServed = r.json?.ok === true;
    } catch {
      /* 預期：連線被中斷 */
    }
    check("同一個 port 不會用明文 http 回應", !plaintextServed);

    // ---- 帳號 ----
    section("4. 帳號：研究編號、只有衛教師能建");
    const reg = await request("/api/auth/register", {
      method: "POST",
      ca: tls.ca,
      body: { email: "someone@example.invalid", password: "12345678", displayName: "路人" },
    });
    check("自己註冊 → 403，並說明要找衛教師", reg.status === 403 && /衛教師/.test(reg.json?.error ?? ""), JSON.stringify(reg));

    const staffEmail = `staff-${Date.now()}@example.invalid`;
    const cli = spawnSync(process.execPath, ["--import", "tsx", "src/cli/account.ts", "create-staff", staffEmail, "staffpass123", "測試衛教師"], {
      env: { ...process.env, DATABASE_URL: dbUrl },
      encoding: "utf8",
    });
    check("主機上的帳號工具可以建衛教師帳號（grant-role 修好了）", cli.status === 0 && /已建立衛教師帳號/.test(cli.stdout), cli.stderr || cli.stdout);

    // 登入次數有限（同一個 IP 15 分鐘 10 次），下面每一次都算數，最後一節刻意把它用完
    let logins = 0;
    const login = (body) => {
      logins++;
      return request("/api/auth/login", { method: "POST", ca: tls.ca, body });
    };

    const staff = await login({ account: staffEmail, password: "staffpass123" });
    check("衛教師用 email 登入", staff.status === 200 && staff.json?.user?.role === "RESEARCHER", JSON.stringify(staff.json));
    const staffToken = staff.json?.accessToken;

    const created = await request("/api/staff/patients", { method: "POST", ca: tls.ca, token: staffToken, body: { patientRef: "p0012", password: "20261018" } });
    check("衛教師建病人帳號；小寫 p0012 存成 P0012", created.status === 201 && created.json?.user?.patientRef === "P0012", JSON.stringify(created));
    check("病人帳號沒有姓名、沒有 email", created.json?.user?.displayName === null && created.json?.user?.email === null);

    const fullWidth = await request("/api/staff/patients", { method: "POST", ca: tls.ca, token: staffToken, body: { patientRef: "Ｐ００１３", password: "20261018" } });
    check("全形的 Ｐ００１３ 存成 P0013（注音輸入法常打出全形）", fullWidth.json?.user?.patientRef === "P0013", JSON.stringify(fullWidth.json));

    const dup = await request("/api/staff/patients", { method: "POST", ca: tls.ca, token: staffToken, body: { patientRef: "P0012", password: "20261018" } });
    check("同一個研究編號不能建第二次 → 409", dup.status === 409, JSON.stringify(dup));

    const bad = await request("/api/staff/patients", { method: "POST", ca: tls.ca, token: staffToken, body: { patientRef: "P@12", password: "20261018" } });
    check("研究編號有 @ 之類的字元 → 400（@ 是用來分辨 email 的）", bad.status === 400, JSON.stringify(bad));

    const anon = await request("/api/staff/patients", { method: "POST", ca: tls.ca, body: { patientRef: "P0099", password: "20261018" } });
    check("沒登入不能建帳號 → 401", anon.status === 401);

    const patient = await login({ account: "p0012", password: "20261018" });
    check("病人用小寫 p0012 登入", patient.status === 200 && patient.json?.user?.patientRef === "P0012", JSON.stringify(patient.json));
    const asPatient = await request("/api/staff/patients", { method: "POST", ca: tls.ca, token: patient.json?.accessToken, body: { patientRef: "P0099", password: "20261018" } });
    check("病人不能建帳號 → 403", asPatient.status === 403);

    const fw = await login({ account: "Ｐ００１２", password: "20261018" });
    check("病人用全形 Ｐ００１２ 也能登入", fw.status === 200);
    const legacy = await login({ email: "P0012", password: "20261018" });
    check("舊版 App 送的 email 欄位也收（已經裝在護理師手機上的 v0.5.0）", legacy.status === 200);

    const t0 = Date.now();
    const unknown = await login({ account: "P9999", password: "20261018" });
    const unknownMs = Date.now() - t0;
    const wrong = await login({ account: "P0012", password: "wrong-password" });
    check("不存在的編號 與 密碼錯誤 → 同樣是 401、同一句話", unknown.status === 401 && wrong.status === 401 && unknown.json?.error === wrong.json?.error);
    // bcrypt cost 10 約 50ms 以上；沒有做假比對的話，不存在的帳號會在幾毫秒內就回來
    check(`不存在的編號也做了密碼比對，回應時間不會洩漏哪些編號已收案（${unknownMs}ms）`, unknownMs >= 30);

    const reset = await request("/api/staff/password-resets", { method: "POST", ca: tls.ca, token: staffToken, body: { account: "p0012" } });
    check("衛教師用研究編號幫病人開重設代碼", reset.status === 200 && /^\d{4} \d{4}$/.test(reset.json?.code ?? "") && reset.json?.user?.patientRef === "P0012", JSON.stringify(reset.json));

    const profile = await request("/api/profile", { ca: tls.ca, token: patient.json?.accessToken });
    check("個人資料回傳研究編號、沒有姓名", profile.json?.user?.patientRef === "P0012" && profile.json?.user?.displayName === null);

    // ---- 照片隱私與 email 找回密碼（IRB 技術章節要寫的兩件事）----
    section("4b. 照片不帶 GPS、email 找回密碼確實關閉");
    {
      // 一張帶著 EXIF 的照片：直拍（Orientation=6，像素是橫的、要轉 90 度才是正的）＋可辨識的 EXIF 文字
      const { default: sharp } = await import("sharp");
      const MARK = "check-hospital-exif-marker";
      const original = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#c0392b" } })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .withExif({ IFD0: { Artist: MARK, ImageDescription: "GPS test image" } })
        .toBuffer();
      const before = await sharp(original).metadata();
      const hadExif = Boolean(before.exif) && original.includes(Buffer.from(MARK));
      check("（前提）測試照片確實帶著 EXIF 與方向資訊", hadExif && before.orientation === 6, JSON.stringify({ exif: !!before.exif, o: before.orientation }));

      // 跟 App 一樣用 multipart 上傳餐前照
      const boundary = "----checkhospital" + Date.now();
      const field = (name, value) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      const mealId = crypto.randomUUID();
      const body = Buffer.concat([
        Buffer.from(
          field("id", mealId) +
            field("mealType", "LUNCH") +
            field("capturedAt", new Date().toISOString()) +
            field("tzOffsetMinutes", "-480") +
            `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="gps.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`
        ),
        original,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const up = await new Promise((resolve, reject) => {
        const req = https.request(
          {
            host: "127.0.0.1",
            port: PORT,
            path: "/api/meals/pre-meal",
            method: "POST",
            ca: tls.ca,
            headers: {
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              "Content-Length": body.length,
              Authorization: `Bearer ${patient.json?.accessToken}`,
            },
          },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(data || "null") }));
          }
        );
        req.on("error", reject);
        req.end(body);
      });
      check("帶 EXIF 的照片可以正常上傳", up.status === 201, JSON.stringify(up));

      const storageKey = up.json?.photo?.storageKey;
      const stored = storageKey ? readFileSync(join(uploadDir, storageKey)) : Buffer.alloc(0);
      const after = stored.length ? await sharp(stored).metadata() : {};
      check(
        "伺服器存下來的照片沒有任何 EXIF（GPS 不會進研究資料庫）",
        stored.length > 0 && !after.exif && !stored.includes(Buffer.from(MARK)),
        JSON.stringify({ exif: !!after.exif, marker: stored.includes(Buffer.from(MARK)) })
      );
      check(
        "照片已依原本的方向轉正（400×200 的直拍照片存成 200×400），去掉 EXIF 不會讓照片橫躺",
        after.width === 200 && after.height === 400 && up.json?.photo?.widthPx === 200 && up.json?.photo?.heightPx === 400,
        JSON.stringify({ w: after.width, h: after.height })
      );
    }
    {
      const h = await request("/health", { ca: tls.ca });
      check("/health 告訴 App：email 找回密碼是關的（忘記密碼頁不顯示那一欄）", h.json?.features?.emailPasswordReset === false, JSON.stringify(h.json));
      const before = server.output().length;
      const fp = await request("/api/auth/forgot-password", { method: "POST", ca: tls.ca, body: { email: staffEmail } });
      check("寄信找回密碼 → 403，請病患找衛教師", fp.status === 403 && /衛教師/.test(fp.json?.error ?? ""), JSON.stringify(fp));
      const unknown = await request("/api/auth/forgot-password", { method: "POST", ca: tls.ca, body: { email: "nobody@example.invalid" } });
      check("不存在的信箱也是同一個回應（關閉時一樣不能透露帳號存不存在）", unknown.status === fp.status && unknown.json?.error === fp.json?.error);
      await new Promise((r) => setTimeout(r, 500));
      check("重設代碼沒有被印進主機的 log", !/密碼重設信/.test(server.output().slice(before)), server.output().slice(before, before + 300));
    }

    // ---- 限流不能被假的 X-Forwarded-For 繞過 ----
    section("5. 前面沒有代理時，假的 X-Forwarded-For 繞不過限流");
    let got429 = false;
    let attempts = 0;
    for (; attempts < 15 && !got429; attempts++) {
      const r = await request("/api/auth/login", {
        method: "POST",
        ca: tls.ca,
        headers: { "X-Forwarded-For": `10.0.${attempts}.${attempts + 1}` }, // 每次都換一個假 IP
        body: { account: "P0012", password: `guess-${attempts}` },
      });
      logins++;
      if (r.status === 429) got429 = true;
    }
    check(`每次都換假的 X-Forwarded-For，第 ${logins} 次登入嘗試仍然被擋（429）`, got429 && logins <= 11, `logins=${logins}`);

    await server.stop();

    // ---- port 被佔用 ----
    section("6. port 被佔用時講人話");
    {
      const first = startBackend({ dbUrl, uploadDir, tls });
      await first.ready();
      const second = startBackend({ dbUrl, uploadDir, tls });
      const code = await second.exitCode();
      check("port 已被佔用 → 拒絕啟動，並提到 18443 / 28443 備用 port", code === 1 && /已經被別的程式佔用/.test(second.output()) && /18443/.test(second.output()), second.output().slice(-300));
      await first.stop();
    }

    // ---- 防睡眠 ----
    section("7. 執行期間不讓 Windows 睡眠");
    if (process.platform !== "win32") {
      skip("防睡眠", "不是 Windows");
    } else {
      const before = systemExecutionState();
      if (before & 1) {
        skip("防睡眠", "這台電腦已經有其他程式要求系統保持清醒，無法分辨是誰");
      } else {
        const b = startBackend({ dbUrl, uploadDir, tls, extraEnv: { KEEP_AWAKE: "true" } });
        await b.ready();
        const start = Date.now();
        while (Date.now() - start < 15000 && !/keep-awake\] 已要求/.test(b.output())) {
          await new Promise((r) => setTimeout(r, 200));
        }
        const during = systemExecutionState();
        check("後端執行中：系統處於「不可睡眠」狀態", (during & 1) === 1, `flags=0x${during.toString(16)}；${b.output().slice(-200)}`);
        await b.stop();
        // PowerShell 每 20 秒檢查一次後端還在不在；正常結束時是直接收掉，應該很快
        let after = systemExecutionState();
        for (let i = 0; i < 25 && after & 1; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          after = systemExecutionState();
        }
        check("後端結束後：不再阻止睡眠（不會留下孤兒程序）", (after & 1) === 0, `flags=0x${after.toString(16)}`);
      }
    }
  } finally {
    killAll();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(work, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed} / ${results.length} 項通過`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  killAll();
  process.exitCode = 1;
});
