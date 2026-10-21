# 給 Claude 的專案指示

慢性腎臟病（CKD）病人的飲食紀錄 App。**使用者是年長的腎臟病人**，收案在醫院、由衛教師帶著進行。
這個設定幾乎決定了每一個設計取捨，不確定的時候回到這一句。

---

## 先讀這些，不要重新發明

| 檔案 | 內容 |
|---|---|
| `README.md` | 目前狀態、怎麼啟動、怎麼打包 APK |
| `docs/ARCHITECTURE.md` | 架構與**每個決定的理由**（離線優先、試用模式、忘記密碼、存相簿） |
| `docs/DATABASE.md` | 每張表為什麼長這樣 |
| `docs/DEPLOY.md` | 部署手冊（方案 A：雲端，**現為備案**）+ **正式收案前必須完成的清單** |
| `docs/HOSPITAL_BACKEND.md` | **醫院主機實際的部署方式**（2026-10-18）：隨附 node.exe 的離線安裝包、用醫院 CA 的憑證、port 9443、研究編號帳號、編號 1～10 的操作腳本。**改後端前先讀**。下一列 DEPLOY_HOSPITAL.md 的**Docker 安裝章節不要照做**（Caddy 自己當 CA、開 8080，跟醫院 CA 與 port 限制衝突；主機其實有網路也有 Docker Desktop，但仍維持原生執行，理由見 HOSPITAL_BACKEND.md「一之一」），其餘章節（要問資訊室什麼、連線測試、IRB 時間線）仍適用 |
| `docs/DEPLOY_HOSPITAL.md` | **現行部署方向**：醫院電腦自架 + 院內 Wi-Fi。含資訊室要問什麼、HTTPS/憑證、服務化、APK 打包、備份、故障排除 |
| `docs/MEETING_1007.md` | 最新進度、卡住的決定（前一期是 `MEETING_0930.md`） |

**過期、不要照著做的文件**（保留是為了歷史紀錄）：

- `Claude outputs/部署指南.md`（2026-09-14）—— 描述的是舊的「學校電腦自架 + Cloudflare Tunnel」方案，
  跟現在的部署方向 **互相矛盾**，以 `docs/DEPLOY_HOSPITAL.md`（現行）與 `docs/DEPLOY.md`（備案）為準
- `Claude outputs/程式碼檢視報告.md`、`docs/REPORT.md`、`docs/SECURITY_AUDIT.md` ——
  都是 9/11–9/14 的快照，之後新增的功能不在範圍內

---

## 不要推翻的決定

這些是使用者明確做過的選擇，或有外部限制。要改之前先問。

- **刪除紀錄一律是軟刪除**（`deletedAt`）。使用者曾經要求硬刪除，後來**自己改成軟刪除**：
  研究資料不能因為病人在 App 上刪掉就真的消失。
- **試用模式的資料絕對不能進到伺服器。** IRB 尚未通過，測試者拍的照片一旦上傳就是違規。
  程式裡有四道獨立防線，`frontend/src/trial/trialMode.test.ts` 守著，不要為了「順便也傳上去」而拆掉。
  第四道是登入後「沿用試用紀錄」那條路：帶進帳號的紀錄標記 `localOnly`，
  `buildEvents` 會跳過它們——**那一行是唯一的守門處**。它們在伺服器上沒有備份，
  所以也絕對不能被 `pruneSyncedMeals` 清掉。
- **帳號是衛教師在收案時幫病人建的**，不是病人自己註冊。所以：病人可能從沒打過自己的密碼、
  填的信箱可能收不到信。任何「寄信給病人」的設計都不能當成唯一出路。
- **不做安全問答找回密碼。** 年長者答不出自己填的答案的機率，比攻擊者猜對還高。
- **病人帳號只有研究編號（`patient_ref`），不存姓名、病歷號、email。** 醫院端的規定，也寫在送資訊室的申請書上。
  病人帳號由衛教師在 App 裡建（`POST /api/staff/patients`）；**公開註冊預設關閉**
  （`ALLOW_PUBLIC_REGISTRATION`，只有開發機與檢查腳本打開）——否則院內訪客 Wi-Fi 上的人拿到 APK 就能上傳到研究資料庫。
  衛教師帳號只能在主機上建（`npm run account -- create-staff`），刻意沒有 API。
- **後端自己提供 HTTPS 時，不能相信 `X-Forwarded-For`。** 醫院主機前面沒有代理，相信它等於讓攻擊者自己決定
  限流看到的 IP；研究編號又是流水號。`TRUST_PROXY` 沒設時，有設 TLS 就自動是 false。
  `check:hospital` 有一項專門測這個，變異測試確認拿掉保護後連續 21 次猜密碼都不會被擋。
- **醫院主機的 IP、CA、主機名稱不能進版控**（repo 是公開的）。放在 `deploy/hospital.local.json`（已忽略）；
  打包醫院版 APK 用 `frontend/scripts/hospital-apk.mjs apply` / `restore`，忘記 restore 前端測試會失敗。
- **伺服器存下來的照片一律不含 EXIF**（`photo.service.ts` 的 `stripMetadata`）。手機端重新編碼只是
  「通常會」去掉，解碼失敗時會送原檔；GPS 進研究資料庫等於記下病患家的座標。IRB 文件依賴這一點。
- **email 找回密碼預設關閉**（`ALLOW_EMAIL_PASSWORD_RESET`）。醫院主機寄不出信，開著的話代碼會被印進 log。
  忘記密碼頁依 `/health` 的 `features.emailPasswordReset` 決定要不要顯示那一欄。
- **`appId`（`tw.edu.project.kidneydiet`）發佈後不能改。** 改了就無法覆蓋安裝，
  而解除安裝會清掉手機裡還沒上傳的離線紀錄。
- **遊戲化規則在前後端各有一份**。這是刻意的重複：病人常常是離線的，點數要在手機上
  立刻看得到，不能等連上網路才算。後端算的是研究用的正式數字，前端
  （`frontend/src/gamification/replay.ts`）拿伺服器的結果當基準、把還沒上傳的紀錄接著算下去。
  `replay.test.ts` 有兩個測試直接讀後端程式碼比對防止走鐘。不要「順手」刪掉其中一份。
- **手機上顯示的點數不可以倒退。** 顯示值 ＝ 伺服器摘要 ＋ 還沒上傳的紀錄，所以
  上傳成功的那一瞬間，新的摘要必須比「標記成已同步」更早到（餐前照與餐後照的回應都會帶
  摘要，`syncRunner` 在 `markDone` 之前就更新基準）。拆掉這個順序，點數會掉下去再跳回來。

---

## 介面硬規則

這幾條最常被違反，而且**要用瀏覽器量過才算數，不能用看的**。

- **每一頁在 375×667 都不需要滑動。** 例外只有「某一天的紀錄」那種本質是清單的頁面。
  改完版面一定要實際量：`page.scrollHeight - page.clientHeight` 要是 0。
  已經發生過三次「加一顆按鈕就超出 30px」。
- **全站沒有小於 16px 的字。** 正文 18px、按鈕 21px、數字 34px。
- **用大圖示代替文字說明**（📷 拍照、🖼️ 相簿）。
- **一個畫面只做一件事**，次要功能移到自己的頁面。
- 病人會手抖、有老花：輸入數字時用 `inputMode="numeric"` 叫出數字鍵盤。

---

## 這台電腦的環境（踩過的坑）

- **資料庫是 SQLite**，就是 `backend/data/kidney.db` 一個檔案。**不需要啟動任何資料庫服務**
  （以前是手動 `pg_ctl` 啟動 PostgreSQL，現在不用了）。Prisma 的 SQLite 相對路徑是相對於
  **schema 檔**而不是專案根目錄，所以 `file:../data/kidney.db` 指的是 `backend/data/`。
- **SQLite 的兩個限制**：不支援 enum（schema 裡那些欄位是 `String`，型別定義在
  `src/domain/enums.ts`），不支援 Json（`rawModelOutput` 存 JSON 字串）。
- **不要直接複製 .db 檔當備份**：資料庫開著 WAL，內容分散在 `.db` 與 `.db-wal`，
  複製會拿到不完整的快照。用 `npm run backup:db -- <路徑>`（走 `VACUUM INTO`）。
- **`prisma migrate dev` 不能用**（它要互動輸入）。改用：
  ```bash
  npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
      --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<時間戳>_<名稱>/migration.sql
  npx prisma migrate deploy
  npx prisma generate     # ← 忘了這一步會在執行時噴 500，而且 tsc 不會報錯
  ```
- **Android 建置不能在這個專案路徑跑**（路徑含中文，Android 工具不接受非 ASCII；
  `android.overridePathCheck` 只跳過警告、**不能解決問題**）。從純英文路徑的目錄連結執行：
  ```powershell
  cd D:\kidney-build\frontend\android    # mklink /J 做的連結，指向本專案
  .\gradlew.bat assembleDebug
  ```
  `android/local.properties` 沒進版控，換電腦要自己建，內容是 `sdk.dir=D:/android-sdk`（**斜線**）。
- **醫院主機用原生執行，不用 Docker**：後端用 `node deploy/windows/build-bundle.mjs` 包成離線 zip
  （含 node.exe 與 Windows 原生檔）帶過去解壓縮。主機**其實連得到外網、也裝了 Docker Desktop**
  （10/18 寫成「沒網路、裝不了」是讀錯環境報告：那行寫 `HTTP 200 -> FAILED`，200 是成功，是檢查腳本判斷寫反）。
  仍維持原生的理由：SQLite WAL 放在 Docker Desktop 的 Windows 掛載上會出鎖定問題、防睡眠要呼叫 Windows API、
  防火牆只放行 `node.exe`、Docker Desktop 一樣要有人登入才啟動、大型機構要付費授權。
  詳見 `docs/HOSPITAL_BACKEND.md`「一之一」。**引用檢查腳本的結論前，先對一下它依據的原始數值。**
  不是系統管理員、8080 不能用，這兩點仍然成立。
- **`deploy/windows/app/*.bat` 只能有 ASCII，而且要 CRLF**：主機主控台是 MS950，`.bat` 裡有中文會壞；
  只有 LF 的 `.bat` 遇到 goto/標籤會出錯（`.gitattributes` 已設 `*.bat eol=crlf`）。中文說明寫在 Node 工具裡。
- **停 dev server 要整棵程序樹一起停**：只砍佔 port 的子程序，`tsx watch` 的父程序會留下來，累積下來會
  佔著 SQLite 的鎖（`database is locked`）。2026-10-18 一次清出 13 個。
- **「應該拒絕啟動」的檢查一定要有逾時**：保護被拿掉時伺服器會正常啟動，沒有逾時的話檢查會永遠卡住而不是失敗。
- **PowerShell 是 5.1**：沒有 `&&`、`??`、三元運算子。
- **主控台編碼是 MS950**：腳本輸出含 emoji 會 `UnicodeEncodeError` 直接中斷。
- **Git Bash 的 `/tmp` 路徑 Windows Python 看不懂**，要先 `cygpath -w` 轉換。

---

## 工作方式

- **改完要在真的瀏覽器裡跑一遍**，不要只讀程式碼就說做好了。曾經有一個「存檔後跳不到下一頁」
  的 bug，讀程式碼完全看不出來，是實際操作才發現的。版面改動要用數字量，不要用「應該可以」。
- **安全相關的檢查要做變異測試**：故意把程式改壞，確認檢查真的會失敗。沒失敗就代表那個檢查沒用。
- **誠實說出沒驗證的部分。** 目前已知未驗證：相機與存相簿**都沒有在實體 Android 裝置上跑過**，
  完全離線冷啟動也沒實測。不要寫成已經可用。
- **語言**：程式註解、文件、UI 文字用繁體中文；commit message 用英文，寫清楚**為什麼**這樣改、
  以及過程中發現或修掉了什麼。
- 動到既有功能時，先看 `docs/ARCHITECTURE.md` 有沒有解釋過當初為什麼這樣做。

---

## 常用指令

```bash
# 前端：測試（188 項）／建置
cd frontend && npm test
cd frontend && npm run build

# 後端：建置
cd backend && npm run build

# 忘記密碼的端到端檢查（36 項，含惡意情境）— 動到 auth 相關就跑一次
cd backend && npm run check:password-reset

# 醫院主機設定的端到端檢查（45 項：HTTPS、研究編號、限流、防睡眠、照片去 EXIF、找回密碼開關）— 動到帳號、啟動、設定就跑一次
# 需要 openssl（Git for Windows 有附）
cd backend && npm run check:hospital

# 帳號工具（主機上是 6_staff_account.bat）
cd backend && npm run account -- create-staff nurse@example.invalid 12345678 王衛教師
cd backend && npm run grant-role -- nurse@example.invalid RESEARCHER   # = account set-role
cd backend && npm run account -- summary

# 醫院主機用的離線安裝包 → release/kidney-hospital-<版本>.zip
node deploy/windows/build-bundle.mjs

# 一次啟動資料庫 + 後端 + 前端
./start-dev.ps1
```

測試用的假帳號請用 `@example.invalid` 結尾，並在用完後刪掉。
