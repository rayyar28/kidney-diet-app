/**
 * 7_smoke_test.bat：從外面打一次正在執行的後端，確認「手機會看到的東西」都正常。
 *
 *   7_smoke_test.bat                 用設定檔裡的位址與 port
 *   7_smoke_test.bat <IP> <port>     指定（跟醫院端 7_smoke_test 的用法一樣）
 *
 * 用 certs\ca.crt 驗證憑證——也就是 App 裡內建的那一張。這裡通過，代表
 * 「信任這張 CA 的 App」連得上；跟手機瀏覽器會跳憑證警告是兩回事（瀏覽器不認得醫院的 CA）。
 */

import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import { CERTS_DIR, bad, fail, ok, requireConfig, title, warn } from "./lib.mjs";

const cfg = requireConfig();
const host = process.argv[2] ?? cfg.PUBLIC_HOST;
const port = Number(process.argv[3] ?? cfg.PORT);
const caPath = join(CERTS_DIR, "ca.crt");
if (!existsSync(caPath)) {
  fail(`找不到 ${caPath}\n  → 從醫院原本那套後端的 backend\\certs\\ 複製 ca.crt 過來（它是公開的，就是 App 內建的那一張）`);
}
const ca = readFileSync(caPath);

function request(path, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host, port, path, method, ca, timeout: 10000, headers: { "Content-Type": "application/json" } },
      (res) => {
        const cert = res.socket.getPeerCertificate();
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            /* 不是 JSON */
          }
          resolve({ status: res.statusCode, json, cert });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let failures = 0;
title(`對 https://${host}:${port} 做端到端測試`);

try {
  const h = await request("/health");
  if (h.json?.service === "kidney-diet") ok(`HTTPS 連線、憑證驗證、/health 都正常（版本 ${h.json.version}）`);
  else {
    failures++;
    bad(`有東西在回應，但不是我們的後端（${JSON.stringify(h.json)}）。是不是舊的那套後端還開著？`);
  }
  ok(`憑證：${h.cert.subjectaltname ?? h.cert.subject?.CN}，有效到 ${h.cert.valid_to}`);
} catch (e) {
  failures++;
  const code = e.code ?? e.message;
  if (code === "ECONNREFUSED") bad("連不上：後端沒有在執行？（先開 5_run.bat）");
  else if (code === "ETIMEDOUT") bad("逾時：防火牆擋住了，或位址不對（2_firewall_open.bat 開了嗎？）");
  else if (/CERT|SELF_SIGNED|UNABLE_TO|ALTNAME/.test(code)) {
    bad(`憑證驗證失敗（${code}）：ca.crt 跟 server.crt 不是同一套，或憑證不是簽給 ${host}`);
  } else bad(`連線失敗：${code}`);
}

if (failures === 0) {
  try {
    const r = await request("/api/auth/login", { method: "POST", body: { account: "SMOKE-TEST-NOT-A-USER", password: "x" } });
    if (r.status === 401) ok("API 與資料庫正常（測試帳號被正確拒絕）");
    else if (r.status === 429) warn("登入嘗試太頻繁被暫時擋下（正常的保護機制），15 分鐘後再測");
    else {
      failures++;
      bad(`登入 API 回了意料之外的結果：${r.status} ${JSON.stringify(r.json)}`);
    }
  } catch (e) {
    failures++;
    bad(`登入 API 失敗：${e.message}`);
  }
}

title(failures === 0 ? "全部通過" : `${failures} 項有問題`);
if (failures === 0) {
  console.log("  接著用病人會用的那個 Wi-Fi，在手機瀏覽器打開：");
  console.log(`    https://${host}:${port}/health`);
  console.log("  會跳「連線不是私人連線」之類的警告是正常的（瀏覽器不認得醫院自建的 CA，只有 App 認得）。");
  console.log("  看得到警告頁，就代表手機到這台主機的網路是通的；連警告頁都出不來（逾時），就是網路被擋。");
}
process.exitCode = failures === 0 ? 0 : 1;
