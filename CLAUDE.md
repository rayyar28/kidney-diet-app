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
| `docs/DEPLOY_HOSPITAL.md` | **現行部署方向**：醫院電腦自架 + 院內 Wi-Fi。含資訊室要問什麼、HTTPS/憑證、服務化、APK 打包、備份、故障排除 |
| `docs/MEETING_0930.md` | 最新進度、卡住的決定 |

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
  程式裡有三道獨立防線，`frontend/src/trial/trialMode.test.ts` 守著，不要為了「順便也傳上去」而拆掉。
- **帳號是衛教師在收案時幫病人建的**，不是病人自己註冊。所以：病人可能從沒打過自己的密碼、
  填的信箱可能收不到信。任何「寄信給病人」的設計都不能當成唯一出路。
- **不做安全問答找回密碼。** 年長者答不出自己填的答案的機率，比攻擊者猜對還高。
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
# 前端：測試（158 項）／建置
cd frontend && npm test
cd frontend && npm run build

# 後端：建置
cd backend && npm run build

# 忘記密碼的端到端檢查（36 項，含惡意情境）— 動到 auth 相關就跑一次
cd backend && npm run check:password-reset

# 把帳號升級成衛教師/研究人員（改完要重新登入才生效）
cd backend && npm run grant-role -- nurse@hospital.tw RESEARCHER

# 一次啟動資料庫 + 後端 + 前端
./start-dev.ps1
```

測試用的假帳號請用 `@example.invalid` 結尾，並在用完後刪掉。
