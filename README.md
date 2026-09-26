# 腎臟病飲食紀錄 App

幫助慢性腎臟病（CKD）病人記錄三餐、未來可辨識鈉/鉀/磷攝取量並給予飲食建議的
專題 App。**目前階段的目標：把「拍照記錄飲食」這個核心功能做扎實**，辨識模型
之後再接（資料庫已預留位置，接上時不需要改 schema）。

病人的使用流程只有三步：**選餐別 → 拍餐前照 →（用餐）→ 拍餐後照**，
兩張照片的時間差就是用餐時長，完成後給點數、連續天數與徽章。

## 📱 下載試用版 APK

想直接試用不必架伺服器、也不用開帳號——安裝後第一頁按「🧪 直接試用」就能把完整流程走完，
資料只留在那支手機。

| | |
|---|---|
| **直接下載** | [kidney-diet-trial-v0.2.0.apk](https://github.com/rayyar28/kidney-diet-app/releases/download/v0.2.0-trial/kidney-diet-trial-v0.2.0.apk)（3.9 MB，Android） |
| **所有版本** | [Releases](https://github.com/rayyar28/kidney-diet-app/releases) |

安裝時 Android 會擋一次「不允許安裝未知的應用程式」，允許瀏覽器安裝即可。
使用方式與注意事項見下方[給護理師試用](#給護理師試用不需要架伺服器)。

> ⚠️ 大學專題作品，**尚未取得 IRB 核准，請勿用於真實病人收案**。

## 目前狀態

| 項目 | 狀態 |
|---|---|
| 拍照記錄飲食（核心功能） | ✅ 完成 |
| 離線使用、有網路自動補傳 | ✅ 完成 |
| 遊戲化（點數 / 連續天數 / 13 種徽章） | ✅ 完成 |
| 為年長使用者設計的介面 | ✅ 完成 |
| **試用模式（不用伺服器、不用帳號就能用）** | ✅ 完成，見下方「給護理師試用」 |
| 照片壓縮（含 GPS 去識別化） | ✅ 完成 |
| **Android APK（試用版）** | ✅ 可以打包並安裝，見下方「打包 Android APK」 |
| 正式環境部署（Render + Neon + R2 + Pages） | 📝 設定與手冊已就緒，尚未實際開通帳號 |
| 食物辨識模型 | ⏳ 尚未選定模型（資料庫已預留） |
| iOS | ⏳ 尚未開始（同一份程式碼，需要 Mac 與 Apple 開發者帳號） |

## 文件

| 文件 | 內容 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 整體架構、為什麼這樣選型、離線優先設計、未來怎麼接辨識模型 |
| [docs/DATABASE.md](docs/DATABASE.md) | 資料庫每張表的設計理由、ER 圖、研究用欄位的用途 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 正式環境部署手冊（Render + Neon + R2 + Cloudflare Pages）與費用試算 |
| [docs/REPORT.md](docs/REPORT.md) | 給醫師/老師看的進度報告（2026-09-11 版本） |
| [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) | 對外試用前的系統檢查報告（2026-09-11 版本） |

## 使用技術

- **前端**：React + TypeScript + Vite，做成 PWA（可以「加到主畫面」，不用上架）
- **Android App**：Capacitor 把同一份前端包成 APK（`frontend/android/`），不是另外寫的程式
- **離線層**：IndexedDB 本機儲存 + 背景同步佇列（`frontend/src/offline/`）
- **試用模式**：不連伺服器也能完整使用（`frontend/src/trial/`）
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

## 給護理師試用（不需要架伺服器）

要請護理師/衛教師幫忙看「介面好不好用」時，直接把 APK 給他們就好，**不用架後端、
不用給網址、不用幫他們開帳號**。

App 第一次打開會問要走哪一條路，按 **🧪 直接試用** 就能用完整功能：選餐別、拍餐前照、
拍餐後照、算用餐時長、拿點數/連續天數/徽章、看歷史紀錄、填健康資料，全部都在。

差別只有一個：**所有資料都留在那支手機，不會上傳到任何地方**。畫面上會一直顯示
「🧪 試用模式，資料只存在這支手機」，不會讓人誤以為資料已經送出去了。

- 點數與徽章是手機自己算的，規則跟正式版一模一樣（見
  [ARCHITECTURE.md 的「試用模式」](docs/ARCHITECTURE.md)）。
- 換下一位測試者之前，可以到「我的 → 清除試用紀錄」把資料清乾淨。
- 要改連真正的伺服器：「我的 → 結束試用」，就會回到一開始的「開始使用」畫面。

> **為什麼要做這一層**：還沒通過 IRB 之前，試用者拍的照片不能進到伺服器。
> 試用模式下同步引擎完全不會啟動，而且試用資料掛在一個固定的假帳號底下，
> 跟真實帳號的資料天然分開。這幾條在自動化測試裡有守著。

## 打包 Android APK

環境需求：**JDK 17** 與 **Android SDK**（platform-tools、platforms;android-35、build-tools;35.0.0）。
不需要安裝 Android Studio，用 command-line tools 即可。

```powershell
cd frontend
npm run build          # 先產生網頁資源
npx cap copy android   # 複製到 Android 專案
cd android
./gradlew assembleDebug
# 產出：frontend/android/app/build/outputs/apk/debug/app-debug.apk
```

> **⚠ 專案路徑含中文會讓建置失敗。**
> Android 的建置工具不接受非 ASCII 路徑。`gradle.properties` 裡已經加了
> `android.overridePathCheck=true`，但那只跳過警告、不能解決問題——**還是要從純英文路徑執行建置**。
> 做法是建一個目錄連結（不需要系統管理員權限、不會複製檔案）：
> ```powershell
> cmd /c 'mklink /J "D:\kidney-build" "D:\大學\專題\claude_app"'
> cd D:\kidney-build\frontend\android
> ./gradlew assembleDebug
> ```
> 另外 `android/local.properties` 沒有進版控（裡面是這台電腦的 SDK 路徑），
> 換電腦要自己建一個，內容是 `sdk.dir=D:/android-sdk`（**用斜線，不要用反斜線**）。

### 試用版與正式版的差別

目前打包出來的是**試用版**：第一次開啟會出現「伺服器設定」畫面，讓測試者自己填後端網址。
這是因為後端還沒有固定位置，如果把網址寫死，網址一變整包 APK 就失效。

正式發給病人的版本要在建置時寫死網址（跟市面上的 App 一樣，使用者不會看到設定畫面）：

```powershell
# 在 frontend/.env.production 設定，或用環境變數
VITE_API_BASE_URL=https://你的網域/api npm run build
```

設了之後 `needsApiBaseSetup()` 會是 false，設定畫面不會出現。

> **正式版還需要自己的簽章金鑰**（`assembleRelease`）。那把金鑰**不能外流**
> （別人可以冒名發佈更新）也**不能弄丟**（換金鑰就無法覆蓋安裝，病人得先解除安裝，
> 而解除安裝會清掉手機裡還沒上傳的離線紀錄）。`.gitignore` 已經擋掉 `*.jks` / `*.keystore`。

## 常用指令

```powershell
# 前端：自動化測試（離線同步、試用模式共 135 項）
cd frontend; npm test

# 前端：正式建置（含型別檢查）
cd frontend; npm run build

# 後端：型別檢查 / 建置
cd backend; npm run build

# 後端：資料庫 GUI
cd backend; npm run prisma:studio

# 後端：改完 schema 後套用變更
cd backend; npm run prisma:migrate

# 後端：把某個帳號升級成衛教師/研究人員（改完要重新登入才生效）
cd backend; npm run grant-role -- nurse@hospital.tw RESEARCHER

# 後端：忘記密碼功能的端到端檢查（34 項，含惡意情境）
cd backend; npm run check:password-reset

# 停掉資料庫
& "C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe" -D ".devdata\pgdata" stop
```

## 已完成的功能

**核心記錄**
- Email + 密碼註冊/登入（JWT access token + 可撤銷的 refresh token）
- **忘記密碼**：寄一組代碼到信箱，或由衛教師當面開一組給病人（見
  [ARCHITECTURE.md 的「忘記密碼」](docs/ARCHITECTURE.md)）
- 一次用餐 = 餐前照 + 餐後照，自動算出用餐時長
- 頁面內即時相機（`getUserMedia`）＋ 高解析度拍照，也可從相簿選擇
- 每張照片記錄時間、像素尺寸、檔案大小、雜湊、裝置資訊等研究用中繼資料
- 病人可刪除自己的紀錄（**軟刪除**：App 上看不到，但研究資料完整保留）
- 紀錄頁是**月曆**：一個月一眼看完哪幾天有記錄，點進某一天看那天每一餐的照片

**試用模式**（見上方「給護理師試用」）
- 不填網址、不註冊帳號就能把整個流程走完，資料只留在手機
- 點數/連續天數/徽章在本機用跟後端相同的規則計算，測試者看到的畫面跟正式版一樣
- 提供「清除試用紀錄」與「結束試用」，方便一支手機給多位測試者輪流用

**離線優先**（見 [ARCHITECTURE.md 的「離線優先設計」](docs/ARCHITECTURE.md)）
- 拍照先存進手機，**沒有網路也能繼續記錄**，有網路時背景自動補傳
- 上傳佇列依「拍照時間」排序，確保連續天數的計算正確
- 用餐紀錄 ID 由前端產生，網路不穩時重送不會產生重複資料或重複點數
- 上傳失敗會明確告知並提供「重試 / 捨棄」，不會默默丟掉病人的照片
- 登入狀態可維持的時間由 `JWT_REFRESH_EXPIRES_IN` 決定。**病人多久會連上伺服器一次，
  就決定這個值要設多大**（洗腎病人一週三次 → 30d 夠；一般門診 2~3 個月回診一次 → 要 180d 以上）

**照片壓縮**
- 上傳前縮到最長邊 1600px、JPEG 品質 0.82：實測 4K 照片 2.76MB → 184KB（約 15 倍）
- 目的是離線期間的手機容量：三個月不連網從約 1.6GB 降到約 110MB
- 副作用（正面）：重新編碼會移除 EXIF，**病人住家的 GPS 座標不會被上傳**

**遊戲化**
- 點數（事件帳本，只增不改）、連續紀錄天數、13 種徽章、完成用餐的慶祝畫面

**介面（為年長使用者設計）**
- 正文 18px 起、按鈕 21px、數字 34px，全站無小於 16px 的字
- 每個畫面都設計成在小螢幕手機（375×667）內看完，主要操作固定在畫面底部
  （月曆的格子高度會依當月排數自動分配，4~6 排都不需要滑動）
- 用大圖示代替文字說明：📷 拍照、🖼️ 相簿
- 首頁永遠只有一個大動作：該拍餐前照、還是該拍餐後照

## 尚未做的事（刻意先不做）

- **食物辨識模型**：資料庫已預留 `NutritionEstimate` 表，接上模型時只要新增一個
  背景工作程序把 `NOT_STARTED` 的照片處理成 `COMPLETED`，前端與現有 API 都不用改
- 忘記拍餐後照的**推播提醒**（目前只有 App 內的提示）
- 研究人員 / 衛教師後台（`User.role` 已預留 `RESEARCHER` / `ADMIN`）
- 檢驗數據（血鈉/血鉀/血磷）與飲食紀錄的相關性分析

## 已知限制

- **相簿選的照片時間不精確**：即時相機拍的是「按下快門的當下」，但從相簿挑選的
  照片只能用「選取當下的時間」近似，尚未解析 EXIF 拍攝時間。正式收案前建議補上。
  ⚠ 之後要做這項時，**必須在壓縮之前讀 EXIF**，因為壓縮會把 EXIF 整段移除。
- **所有照片解析度一致**：壓縮後都是最長邊 1600px，因此無法再從收集到的資料研究
  「照片解析度是否影響辨識準確率」。若研究上需要，得另外記錄原始尺寸（要加欄位）。
- **完全離線冷啟動未實測**：還沒在真實手機上驗證「先開飛航模式再開 App」的情境。
- **APK 的相機未在實機驗證**：權限與設定都正確，但開發時沒有實體 Android 裝置，
  WebView 內的相機行為需要實機確認。
- **iPhone 畫質較差**：高解析度靜態拍照用的 `ImageCapture` API iOS Safari 不支援，
  會退回畫面截圖。

## 授權 / 使用範圍

大學專題作品，目前僅供研究與教學用途。**尚未取得 IRB 核准，請勿用於真實病人收案。**
正式收案前必須完成的項目列在 [docs/DEPLOY.md](docs/DEPLOY.md) 的「已知問題與後續工作」。
