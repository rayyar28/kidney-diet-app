# 腎臟病飲食紀錄 App

幫助慢性腎臟病（CKD）病人記錄三餐、未來可辨識鈉/鉀/磷攝取量並給予飲食建議的
專題 App。**目前階段的目標：把「拍照記錄飲食」這個核心功能做扎實**，辨識模型
之後再接（資料庫已預留位置，接上時不需要改 schema）。

病人的使用流程只有三步：**選餐別 → 拍餐前照 →（用餐）→ 拍餐後照**，
兩張照片的時間差就是用餐時長，完成後給點數、連續天數與徽章。

## 目前狀態

| 項目 | 狀態 |
|---|---|
| 拍照記錄飲食（核心功能） | ✅ 完成 |
| 離線使用、有網路自動補傳 | ✅ 完成 |
| 遊戲化（點數 / 連續天數 / 13 種徽章） | ✅ 完成 |
| 為年長使用者設計的介面 | ✅ 完成 |
| 正式環境部署（Render + Neon + R2 + Pages） | 📝 設定與手冊已就緒，尚未實際開通帳號 |
| 食物辨識模型 | ⏳ 尚未選定模型（資料庫已預留） |
| Android APK / iOS | ⏳ 規劃中（先 Android 直接發 APK） |

## 文件

| 文件 | 內容 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 整體架構、為什麼這樣選型、離線優先設計、未來怎麼接辨識模型 |
| [docs/DATABASE.md](docs/DATABASE.md) | 資料庫每張表的設計理由、ER 圖、研究用欄位的用途 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 正式環境部署手冊（Render + Neon + R2 + Cloudflare Pages）與費用試算 |
| [docs/REPORT.md](docs/REPORT.md) | 給醫師/老師看的進度報告（2026-09-11 版本） |
| [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | 對外試用前的系統檢查報告（2026-09-11 版本） |

## 技術棧

- **前端**：React + TypeScript + Vite，做成 PWA（可以「加到主畫面」，不用上架）
- **離線層**：IndexedDB 本機儲存 + 背景同步佇列（`frontend/src/offline/`）
- **後端**：Node.js + Express + TypeScript
- **資料庫**：PostgreSQL，透過 Prisma ORM 管理
- **照片儲存**：`StorageService` 介面，兩種實作可用環境變數切換
  - `STORAGE_DRIVER=local`：存本機磁碟（開發用）
  - `STORAGE_DRIVER=r2`：存 Cloudflare R2，後端簽發短效直連網址（正式用）

## 本機啟動

環境需求：**Node.js 20+**（開發機目前是 24）與 **PostgreSQL 17**，原生安裝、不需要 Docker。

> 為什麼不用 Docker：這台開發機的 Docker Desktop 有個修不掉的系統層問題
> （AF_UNIX socket 殘留檔案）完全無法啟動，所以改成原生安裝。PostgreSQL 的資料放在
> `.devdata/pgdata`，是用 `pg_ctl` 手動啟動的獨立叢集（不裝進 Windows 服務，
> 因此不需要系統管理員權限）。`docker-compose.yml` 仍保留在專案裡，
> 在 Docker 正常的電腦（Linux / Mac）上可以直接用。

第一次啟動：

```powershell
cp backend/.env.example backend/.env
cd backend; npm install; npx prisma generate; npx prisma migrate deploy; npm run seed
cd ../frontend; npm install
```

之後每次啟動，執行專案根目錄的 [start-dev.ps1](start-dev.ps1)，它會依序啟動
PostgreSQL、後端、前端：

```powershell
.\start-dev.ps1
```

> 如果出現「因為這個系統上已停用指令碼執行」的錯誤，是 Windows 的指令碼執行原則
> 擋住了，改用這一行執行（只影響這一次，不會改動系統設定）：
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
> ```

啟動後：

- App：http://localhost:5173
- API 健康檢查：http://localhost:4000/api/health

手機要測的話，可以用 Cloudflare Quick Tunnel 取得一個臨時的 HTTPS 網址
（不需要帳號，關掉就失效）：

```powershell
cloudflared tunnel --url http://localhost:5173
```

## 常用指令

```powershell
# 前端：自動化測試（離線同步邏輯 104 項）
cd frontend; npm test

# 前端：正式建置（含型別檢查）
cd frontend; npm run build

# 後端：型別檢查 / 建置
cd backend; npm run build

# 後端：資料庫 GUI
cd backend; npm run prisma:studio

# 後端：改完 schema 後套用變更
cd backend; npm run prisma:migrate

# 停掉資料庫
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" -D ".devdata\pgdata" stop
```

## 已完成的功能

**核心記錄**
- Email + 密碼註冊/登入（JWT access token + 可撤銷的 refresh token）
- 一次用餐 = 餐前照 + 餐後照，自動算出用餐時長
- 頁面內即時相機（`getUserMedia`）＋ 高解析度拍照，也可從相簿選擇
- 每張照片記錄時間、像素尺寸、檔案大小、雜湊、裝置資訊等研究用中繼資料
- 病人可刪除自己的紀錄（**軟刪除**：App 上看不到，但研究資料完整保留）

**離線優先**（見 [ARCHITECTURE.md 的「離線優先設計」](docs/ARCHITECTURE.md)）
- 拍照先存進手機，**沒有網路也能繼續記錄**，有網路時背景自動補傳
- 上傳佇列依「拍照時間」排序，確保連續天數的計算正確
- 用餐紀錄 ID 由前端產生，網路不穩時重送不會產生重複資料或重複點數
- 上傳失敗會明確告知並提供「重試 / 捨棄」，不會默默丟掉病人的照片

**遊戲化**
- 點數（事件帳本，只增不改）、連續紀錄天數、13 種徽章、完成用餐的慶祝畫面

**介面（為年長使用者設計）**
- 正文 18px 起、按鈕 21px、數字 34px，全站無小於 16px 的字
- 每個畫面都設計成在小螢幕手機（375×667）內看完，主要操作固定在畫面底部
- 用大圖示代替文字說明：📷 拍照、🖼️ 相簿
- 首頁永遠只有一個大動作：該拍餐前照、還是該拍餐後照

## 尚未做的事（刻意先不做）

- **食物辨識模型**：資料庫已預留 `NutritionEstimate` 表，接上模型時只要新增一個
  背景工作程序把 `NOT_STARTED` 的照片處理成 `COMPLETED`，前端與現有 API 都不用改
- 忘記拍餐後照的**推播提醒**（目前只有 App 內的提示）
- 研究人員 / 衛教師後台（`User.role` 已預留 `RESEARCHER` / `ADMIN`）
- 檢驗數據（血鈉/血鉀/血磷）與飲食紀錄的相關性分析

## 已知限制

- **照片沒有壓縮**：離線累積多天的照片可能到數十 MB，補傳較慢也較耗流量。
- **相簿選的照片時間不精確**：即時相機拍的是「按下快門的當下」，但從相簿挑選的
  照片只能用「選取當下的時間」近似，尚未解析 EXIF 拍攝時間。正式收案前建議補上。
- **不解析 EXIF**：刻意的隱私考量（避免記錄到病人住家 GPS 座標），詳見
  [DATABASE.md](docs/DATABASE.md)。
- **完全離線冷啟動未實測**：還沒在真實手機上驗證「先開飛航模式再開 App」的情境。
- **iPhone 畫質較差**：高解析度靜態拍照用的 `ImageCapture` API iOS Safari 不支援，
  會退回畫面截圖。

## 授權 / 使用範圍

大學專題作品，目前僅供研究與教學用途。**尚未取得 IRB 核准，請勿用於真實病人收案。**
正式收案前必須完成的項目列在 [docs/DEPLOY.md](docs/DEPLOY.md) 的「已知問題與後續工作」。
