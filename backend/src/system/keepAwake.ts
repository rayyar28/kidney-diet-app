import { spawn, type ChildProcess } from "node:child_process";

/**
 * 伺服器執行期間不讓 Windows 進入睡眠（醫院主機用，KEEP_AWAKE=true 才會啟動）。
 *
 * **為什麼需要**：醫院主機是醫師的診間電腦，支援 S3 睡眠（見醫院端的環境報告）。
 * Windows 預設閒置一陣子就會睡——醫師去吃午餐，半小時後候診區的病人怎麼按都傳不上來，
 * 而且看起來跟「沒有網路」一模一樣，沒人會想到是電腦睡著了。
 *
 * **做法**：開一個背景的 PowerShell，呼叫 Windows 的 SetThreadExecutionState
 * （ES_CONTINUOUS | ES_SYSTEM_REQUIRED）。這跟「播影片時電腦不會睡」是同一個機制：
 *   - **不需要系統管理員**，也**不會改電源設定**——只在這個程式執行期間有效
 *   - 螢幕照樣會關（沒有要求 ES_DISPLAY_REQUIRED），只是系統不睡
 *   - 程式結束，這個要求就自動消失
 *
 * 這個 PowerShell 每 20 秒檢查一次後端還在不在，後端當掉它就自己結束，
 * 不會留下一個讓電腦永遠不睡的孤兒程序。
 *
 * 已在開發機實測（不用系統管理員，用 CallNtPowerInformation 讀系統狀態）：
 * 執行前 ES_SYSTEM_REQUIRED=0、執行中=1、結束後=0。
 *
 * 可能失敗的情況：主機被資安政策鎖成 Constrained Language Mode 時 Add-Type 不能用。
 * 那只會印一行警告、後端照常運作，此時要改請資訊室把電源計畫的「睡眠」設成「永不」。
 */

// 0x80000001 = ES_CONTINUOUS | ES_SYSTEM_REQUIRED。用十進位寫：PowerShell 會把 0x8000_0001
// 這種十六進位字面值當成有號 Int32（變成負數），轉成 uint32 會失敗。
const ES_CONTINUOUS_SYSTEM_REQUIRED = "2147483649";
const READY_MARK = "KEEPAWAKE_OK";

export function startKeepAwake(log: (msg: string) => void = console.log): ChildProcess | null {
  if (process.platform !== "win32") {
    log("[keep-awake] 不是 Windows，略過");
    return null;
  }

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -Namespace KidneyDiet -Name Power -MemberDefinition " +
      "'[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
    `[void][KidneyDiet.Power]::SetThreadExecutionState([uint32]${ES_CONTINUOUS_SYSTEM_REQUIRED})`,
    `Write-Output '${READY_MARK}'`,
    // 同一條執行緒一直待著，要求才會持續有效；後端不見了就結束
    `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 20 }`,
  ].join("; ");

  // -Command（而不是 -File 執行 .ps1）不受 PowerShell 執行原則限制；
  // 也刻意不用 -EncodedCommand：醫院的資安系統常把它當成惡意程式的特徵。
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let ready = false;
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    if (!ready && chunk.toString().includes(READY_MARK)) {
      ready = true;
      log("[keep-awake] 已要求 Windows 在後端執行期間不要睡眠（螢幕仍會照常關閉）");
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.on("error", (err) => {
    log(`[keep-awake] ⚠ 無法啟動 PowerShell，電腦閒置時仍可能睡著：${err.message}`);
  });
  child.on("exit", (code) => {
    if (!ready) {
      log(
        `[keep-awake] ⚠ 沒有成功（結束代碼 ${code}）。電腦閒置時仍可能睡著，` +
          `請資訊室把電源計畫的睡眠設為「永不」。${stderr ? "\n  " + stderr.trim().split("\n")[0] : ""}`
      );
    }
  });

  // 後端正常結束時一併收掉（當掉的情況由上面 PowerShell 自己的檢查處理）
  process.once("exit", () => child.kill());
  return child;
}
