# 腎臟病飲食紀錄 App

幫助慢性腎臟病 (CKD) 病人記錄三餐、未來可辨識鈉/鉀/磷攝取量並給予飲食建議的
專題 App。**目前階段的目標：把「拍照記錄飲食」這個核心功能做好**，辨識功能
之後再接。

技術架構與資料庫設計的詳細說明，請看：
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — App 整體架構、為什麼這樣選型
- [docs/DATABASE.md](docs/DATABASE.md) — 資料庫每張表的設計理由、ER 圖

> **目前這台電腦的啟動方式**：因為 Docker Desktop 在這台機器上有個修不好的殘留檔案問題，
> 現在是**原生安裝 Node.js + PostgreSQL**在跑（不透過 Docker），PostgreSQL 的資料放在
> `.devdata/pgdata`（不是裝在 Windows 服務裡，是用 `pg_ctl` 手動啟動的獨立叢集）。
> 之後要啟動時，直接執行專案根目錄的 [start-dev.ps1](start-dev.ps1)：
> ```powershell
> .\start-dev.ps1
> ```
> 它會依序啟動 PostgreSQL、後端、前端，完成後打開 http://localhost:5173 即可。
> 下面的 Docker Compose 說明是原本設計的正式流程，等 Docker 的問題解決後可以換回來用。

## 技術棧

- **前端**：React + TypeScript + Vite，做成 PWA（可以「加到主畫面」，不用上架）
- **後端**：Node.js + Express + TypeScript
- **資料庫**：PostgreSQL，透過 Prisma ORM 管理
- **照片儲存**：本機磁碟（已抽象成介面，未來可換成 S3 等雲端儲存）
- **開發/執行環境**：Docker Compose（因為這台電腦還沒裝 Node.js，用 Docker 最省事）

## 環境需求

- 已安裝 **Docker Desktop** 並且正在執行（本機沒有 Node.js 也沒關係，全部在
  容器裡跑）

## 第一次啟動

1. 複製後端環境變數範本並視需要修改（本機開發用預設值即可）：

```bash
cp backend/.env.example backend/.env
```

2. 啟動整個環境（第一次會需要下載映像檔 + 安裝套件，可能要幾分鐘）：

```bash
docker compose up --build
```

3. 打開瀏覽器：
   - App：http://localhost:5173
   - API 健康檢查：http://localhost:4000/api/health

第一次啟動時，後端容器會自動：
1. 產生 Prisma Client
2. 建立資料庫 migration 並套用到 PostgreSQL
3. 執行 `prisma/seed.ts` 建立徽章目錄初始資料

之後每次 `docker compose up` 都會重複套用 migration（沒有變更時是空操作），
所以不用擔心資料庫沒建好。

## 開發時的慣用指令

```bash
# 看某個服務的 log
docker compose logs -f backend
docker compose logs -f frontend

# 進到後端容器手動跑 Prisma 指令 (例如打開資料庫瀏覽介面)
docker compose exec backend npx prisma studio

# 停止並移除容器（資料庫資料仍保留在 named volume 裡）
docker compose down

# 完全重置（含刪除資料庫資料）
docker compose down -v
```

> **注意**：`backend/src`、`backend/prisma`、`frontend/src` 這幾個資料夾是用
> volume 掛進容器的，改程式碼會自動 hot-reload。但 `package.json` 沒有掛進去，
> 如果你之後要新增 npm 套件，改完 `package.json` 要重新
> `docker compose build backend`（或 `frontend`）。

## 目前已經做好的功能

- Email + 密碼註冊/登入（JWT，含 refresh token）
- 記錄一次用餐：選餐別 → 拍**餐前照** → （用餐）→ 拍**餐後照**，自動算出用餐時長
- 每張照片都記錄時間、像素尺寸、檔案大小、裝置資訊等中繼資料
- 首頁顯示「進行中的用餐」提醒（含即時計時），避免病人忘記拍餐後照
- 遊戲化：點數、連續紀錄天數、13 種徽章、完成用餐後的慶祝畫面與鼓勵文案
- 個人頁：CKD 分期、透析狀態、每日鈉/鉀/磷攝取上限（先讓病人自填，未來也是
  辨識模型比對攝取量的基準）
- 歷史紀錄頁：回顧所有用餐的餐前/餐後照片與用餐時長

## 尚未做的事（刻意先不做）

- **食物辨識模型**：資料庫已經預留 `NutritionEstimate` 表（見
  [docs/DATABASE.md](docs/DATABASE.md#nutritionestimate辨識結果--目前完全是空的預留表)），
  接上模型時不需要改動現有 schema
- 忘記拍餐後照的自動提醒通知（目前只有 App 內的提示卡片，沒有推播）
- 研究人員/衛教師後台（角色欄位已預留，尚未做對應頁面）
- 檢驗數據（血鈉/血鉀/血磷）紀錄與飲食紀錄的相關性分析

## 已知限制

- `capturedAt`（拍攝時間）是「使用者在瀏覽器選好照片的當下時間」，而不是相機
  韌體記下的精確拍攝時間戳記——這是網頁 PWA 用 `<input type="file" capture>`
  的技術限制。如果之後改成原生 App，可以拿到更精確的相機時間戳記。
- 目前沒有解析照片的 EXIF 資訊（刻意的隱私考量，見 DATABASE.md），如果研究上
  真的需要更多影像中繼資料，可以再評估要不要加。
