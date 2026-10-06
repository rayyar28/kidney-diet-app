# 部署手冊 — 方案 A（Render + Neon + R2 + Cloudflare Pages）

專案：`rayyar28/kidney-diet-app`
最後更新：2026-09-14

> **2026-10-01：部署方向已改為「醫院電腦自架、院內 Wi-Fi」，請看 [DEPLOY_HOSPITAL.md](./DEPLOY_HOSPITAL.md)。**
> 這份（方案 A：Render + Neon + R2）保留作為備案，兩份的架構互相排斥，不要混著做。
> 「正式收案前必須完成」那一節仍然有效，兩個方案都適用。

```
病人手機
   │ HTTPS
   ├──────────────► Cloudflare Pages          前端靜態檔（免費、不限流量）
   │                https://xxx.pages.dev
   │
   ├──────────────► Render (Singapore)        Express + Prisma API
   │                https://xxx.onrender.com  US$7/月
   │                        │
   │                        ├──► Neon          PostgreSQL（免費方案）
   │                        └──► Cloudflare R2 照片（簽發短效下載網址）
   │
   └──────────────► Cloudflare R2             照片直接下載，不經過後端
                                              ★ 無流量出站費用
```

**為什麼照片要走 R2 直連**：如果每張照片都經過後端轉送，所有照片流量都會算在 Render 的頻寬上，又慢又要錢。現在後端只負責「決定這個人能不能看這張照片」，通過就簽一個 5 分鐘有效的網址，瀏覽器拿著網址直接跟 R2 要檔案。權限控制沒有變鬆，但流量成本降到零。


> ### ⚠️ 資料庫已改成 SQLite，這份雲端方案需要調整
>
> 專案的資料庫從 PostgreSQL 改成 SQLite（一個檔案）。**Render 的免費方案是 ephemeral
> 檔案系統，每次部署或重啟都會把資料庫檔案清空**，照這份文件直接部署會持續遺失資料。
>
> 真的要走這條路，二選一：掛一個 Render 的 Persistent Disk（付費），或這條路改回
> PostgreSQL + Neon（下方第二節）。`render.yaml` 裡也有同樣的警告。
>
> 目前的部署方向是院內自架，見 [DEPLOY_HOSPITAL.md](./DEPLOY_HOSPITAL.md) 與
> [DEPLOY_DOCKER_WINDOWS.md](./DEPLOY_DOCKER_WINDOWS.md)。

---

## 一、程式碼改動總覽（已經幫你寫進 repo 了）

先跑 `git diff` 看一遍再往下走。

| 檔案 | 改了什麼 |
|---|---|
| `backend/src/services/storage.service.ts` | 新增 R2 實作；介面加上 `getSignedReadUrl()` |
| `backend/src/services/photo.service.ts` | 存檔時帶上 `contentType`（R2 需要） |
| `backend/src/config/env.ts` | 新增 `STORAGE_DRIVER`、R2 四個變數；`CORS_ORIGIN` 改成支援逗號分隔多組 |
| `backend/src/index.ts` | `trust proxy`（Render 在反向代理後面）；CORS 改成白名單比對 |
| `backend/src/routes/photos.routes.ts` | 有簽名網址就 302 轉址；順便補上「軟刪除的照片病人端不可讀」 |
| `backend/package.json` | 新增 `@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner` |
| `backend/Dockerfile.prod` | **新檔**，正式環境用（`npm ci` + build + `migrate deploy`） |
| `backend/Dockerfile` | 維持原本的開發版，`docker compose up` 行為不變 |
| `backend/docker-entrypoint.prod.sh` | **新檔**，跑 `prisma migrate deploy` |
| `frontend/src/api/client.ts` | `API_BASE` 改讀 `VITE_API_BASE_URL`，沒設就用 `/api`（開發不受影響） |
| `frontend/src/vite-env.d.ts` | **新檔**，讓 TypeScript 認得 `import.meta.env` |
| `render.yaml` | **新檔**，Render Blueprint |
| `.gitignore` | 補擋 `.env.*`，但放行 `*.example` |

### 動手前先做這一步

```powershell
cd D:\大學\專題\claude_app\backend
npm install
```

這會把兩個新套件裝起來並**更新 `package-lock.json`**。正式環境的 Dockerfile 用 `npm ci`，它要求 lock 檔跟 `package.json` 完全一致，沒跑這一步部署會直接失敗。

然後在本機確認沒改壞：

```powershell
cd D:\大學\專題\claude_app
docker compose up --build
```

`STORAGE_DRIVER` 預設是 `local`，所以本機行為跟以前一樣，照片還是存在 `uploads/`。

---

## 二、Neon（PostgreSQL）

1. 到 [neon.tech](https://neon.tech) 用 GitHub 帳號註冊
2. Create project：
   - Region 選 **AWS ap-southeast-1 (Singapore)**（離台灣最近）
   - Postgres 版本選 16，跟你本機的 `postgres:16-alpine` 一致
3. 建好之後複製 **Connection string**，長得像：
   ```
   postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   這串等一下要填進 Render，先存好。

⚠️ Prisma 連 Neon 要保留 `?sslmode=require`，拿掉會連不上。

免費方案給 0.5GB 儲存。你的資料（用餐紀錄 + 照片中繼資料，照片本身不在這裡）大概只會用到幾十 MB，非常夠。

---

## 三、Cloudflare R2（照片儲存）

1. 註冊 [Cloudflare](https://dash.cloudflare.com) 帳號
2. 左側選 **R2** → 第一次使用要綁信用卡（**但 10GB 儲存以內免費，流量出站永遠免費**）
3. **Create bucket**：
   - 名稱：`kidney-diet-photos`
   - Location：**APAC**
4. 進到 bucket → **Settings**，確認 Public access 是**關閉**的
   （照片一律透過簽名網址存取，絕對不要開公開讀取）
5. 回到 R2 首頁 → **Manage R2 API Tokens** → **Create API Token**
   - Permissions 選 **Object Read & Write**
   - Specify bucket：只勾 `kidney-diet-photos`（不要給整個帳號的權限）
   - 建立後會顯示 **Access Key ID** 和 **Secret Access Key**，
     **Secret 只會出現這一次**，馬上存起來
6. 記下 **Account ID**（在 R2 頁面右側，或網址列 `dash.cloudflare.com/<這一串>`）

你會得到四個值：`R2_ACCOUNT_ID`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`。

---

## 四、Render（後端 API）

1. 先把改動推上 GitHub：
   ```powershell
   git add -A
   git commit -m "feat: 支援 Cloudflare R2 儲存與正式環境部署設定"
   git push
   ```
2. 到 [render.com](https://render.com) 用 GitHub 登入 → **New** → **Blueprint**
3. 選你的 repo，Render 會讀到 `render.yaml` 並建立服務
4. 它會要你填 `sync: false` 的那幾個環境變數：

   | 變數 | 值 |
   |---|---|
   | `DATABASE_URL` | Neon 的 connection string |
   | `CORS_ORIGIN` | 先隨便填 `https://example.com`，第五步拿到 Pages 網址再回來改 |
   | `R2_ACCOUNT_ID` | Cloudflare Account ID |
   | `R2_ACCESS_KEY_ID` | R2 API Token 的 Access Key ID |
   | `R2_SECRET_ACCESS_KEY` | R2 API Token 的 Secret |
   | `R2_BUCKET` | `kidney-diet-photos` |
   | `MAIL_DRIVER` | `resend`（不設的話會變成只印在 log，病人收不到重設信） |
   | `RESEND_API_KEY` | Resend 後台產生的 API Key |
   | `MAIL_FROM` | 例如 `腎臟飲食小幫手 <noreply@你的網域>` |
   | `APP_URL` | 前端網址，信裡的重設連結會用它組出來。不設就只寄代碼 |

   `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` 設成 `generateValue: true`，Render 會自己產生隨機值，你不用管。

   > **寄信要注意**：`MAIL_FROM` 的網域必須先在 Resend 驗證過（加 SPF / DKIM 記錄），
   > 否則信會進垃圾信匣或直接被退回。免費方案每月 3000 封，對這個規模綽綽有餘。
   > 沒有自己的網域就沒辦法通過驗證——這也是「要不要買網域」那個決定的影響之一。

5. 部署完成後（第一次約 5–10 分鐘），確認健康檢查：
   ```
   https://kidney-diet-api.onrender.com/api/health
   ```
   應該回 `{"ok":true}`

6. **建立徽章資料**（只需做一次）。Render Dashboard → 你的服務 → **Shell**：
   ```sh
   npx tsx prisma/seed.ts
   ```
   沒跑這一步的話，遊戲化功能會正常運作但一個徽章都發不出來（`awardBadgeIfNew` 找不到徽章就安靜跳過）。

⚠️ **方案一定要用 Starter（US$7/月）**。Free 方案閒置 15 分鐘就休眠，病人早上打開 App 要等 30 秒以上，正式收案不能接受。

---

## 五、Cloudflare Pages（前端）

1. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 選你的 repo，設定：

   | 欄位 | 值 |
   |---|---|
   | Framework preset | `Vite` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory | `frontend` |

3. **Environment variables** 加一個：
   ```
   VITE_API_BASE_URL = https://kidney-diet-api.onrender.com/api
   ```
   （換成你第四步實際拿到的網址，**結尾要有 `/api`**）

4. 部署完成後會得到 `https://kidney-diet-app.pages.dev` 這樣的網址，**HTTPS 已經內建，網址永遠不變**。

5. **回到 Render** 把 `CORS_ORIGIN` 改成這個 Pages 網址：
   ```
   https://kidney-diet-app.pages.dev
   ```
   改完 Render 會自動重新部署。沒改的話前端會全部收到 CORS 錯誤。

⚠️ `VITE_` 開頭的變數是**建置時**寫進 bundle 的，不是執行時讀的。改了值必須重新 build（在 Pages 按 Retry deployment）才會生效。

---

## 六、驗收清單

用**手機的 4G**（不要用電腦）開 Pages 網址，逐項確認：

- [ ] 登入頁正常顯示，網址列有鎖頭
- [ ] 註冊一個測試帳號 → 成功（代表 CORS 和資料庫都通了）
- [ ] 拍一張餐前照上傳 → 成功
- [ ] 到 Cloudflare R2 的 bucket 裡看得到那個檔案
- [ ] 歷史頁看得到剛才那張照片（代表簽名網址正常）
- [ ] 拍餐後照 → 完成，出現點數和用餐時長
- [ ] Android Chrome：選單有「安裝應用程式」
- [ ] **iPhone Safari**：分享 → 加入主畫面，裝得起來
- [ ] **iPhone 從相簿選一張 HEIC 照片上傳**（見下方，現在應該會成功了，但仍需實測）

---

## 七、已知問題與後續工作

> 更新於 2026-09-23：下面有幾項在這份文件寫成之後已經完成，保留紀錄並標示狀態。

### 已完成

- [x] **照片壓縮** — 上傳前縮到最長邊 1600px、JPEG 0.82。實測 4K 照片 2.76MB → 184KB
      （約 15 倍）。做在前端（`offline/util.ts`），所以手機容量、上傳流量、伺服器儲存同時受惠。
- [x] **GPS 去識別化** — 壓縮時用 canvas 重新編碼，原始 EXIF（含 GPS 座標）整段被移除。
      已用內嵌 GPS 字串的測試檔驗證過輸出確實不含該資訊。
- [x] **HEIC 上傳失敗** — 原因是舊版 `sharp` 的預編譯檔不含 HEIF 解碼。修安全漏洞時
      已升級到 0.35.4，該版本內建 libheif 1.23.2，確認 HEIF 輸入支援為 YES。
      ⚠ 只在 Windows 開發機驗證過，**Linux 容器的預編譯檔可能不同，部署後請用 iPhone 實測一張**。
- [x] **幽靈紀錄** — 上傳流程改成可安全重送，照片處理失敗時剛建立的紀錄會一併撤回，
      不會留下沒有照片的空紀錄（已有整合測試覆蓋）。

- [x] **護理師試用不必等部署** — App 內建「試用模式」：不填網址、不開帳號就能把完整流程
      走完，資料只留在測試者的手機。同步引擎在這個模式下完全不啟動，所以**在 IRB 通過前
      做介面可用性測試，不會有任何資料進到伺服器**。見 [README 的「給護理師試用」](../README.md#給護理師試用不需要架伺服器)。

### 正式收案前必須完成

- [ ] **EXIF 拍攝時間**（`exifCapturedAt` + `captureSource`）— 否則從相簿選的照片時間不可信。
      ⚠ **必須在壓縮之前讀取**，因為壓縮會把 EXIF 移除。
- [ ] `participantCode` 假名化欄位
- [ ] 同意書欄位 `consentedAt` / `consentVersion` / `withdrawnAt`
- [ ] **設定好寄信**（`MAIL_DRIVER=resend` + 已驗證網域）並實際收一封重設信。
      沒設的話病人按「忘記密碼」會看到成功畫面，但信永遠不會到——這是最容易漏掉的一項，
      因為開發時的 console 模式看起來一切正常。
- [ ] **幫衛教師開好 `RESEARCHER` 帳號**（`npm run grant-role`），並確認他們知道
      「病人信箱進不去時可以當面開代碼」這條路。
- [ ] **確認「照片會進到病人的 Google 相簿」要不要寫進同意書**。App 現在會把拍的照片
      另存一份到病人手機的相簿，而多數手機會自動備份相簿到雲端。照片是病人自己拍的、
      存在他自己的帳號，而且我們已經確保**不含 GPS 座標**；但畢竟是研究讓他去拍的，
      是否需要說明請 IRB 判斷。（不想要的話，把 `saveCameraPhotoToGallery` 的呼叫拿掉即可，
      不影響其他功能。）
- [ ] IRB 送審通過

### 建議加上

- [ ] **UptimeRobot** 監測 `/api/health`，服務掛掉寄信通知你
- [ ] **Neon 的備份**：免費方案只有 point-in-time restore 保留很短，建議每週手動 `pg_dump` 一份存到自己電腦
- [ ] **R2 的備份**：R2 本身很可靠，但誤刪是誤刪。開啟 bucket 的版本控制，或定期 `rclone sync` 一份到別的地方
- [ ] `helmet` 安全標頭
- [ ] 照片上傳的 rate limit（目前只有登入/註冊有）
- [ ] 餐後提醒通知

---

## 八、成本

| 項目 | 方案 | 月費 |
|---|---|---|
| Cloudflare Pages | 免費 | US$0 |
| Render Web Service | Starter | US$7 |
| Neon PostgreSQL | 免費（0.5GB） | US$0 |
| Cloudflare R2 | 10GB 內免費，超出 US$0.015/GB | US$0 – 0.3 |
| **合計** | | **約 US$7（NT$230）/月** |

三個月約 NT$700。

**照片壓縮完成後這個估算要往下修**：原本估 30 人 3 個月約 12GB，是以未壓縮的照片計算的。
現在單張約 180KB，30 人 × 3 餐 × 2 張 × 90 天 ≈ 16,200 張 ≈ **約 3GB**，
完全落在 R2 的 10GB 免費額度內，這一項的費用會是 US$0。

**省錢提醒**：收案結束後記得把 Render 的服務降回 Free 或直接刪掉，不然會一直扣款。資料要先 `pg_dump` 匯出留存。
