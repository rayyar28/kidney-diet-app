# 部署手冊 — 方案 B（醫院電腦自架，院內 Wi-Fi）

專案：`rayyar28/kidney-diet-app`
撰寫日期：2026-10-01
適用情境：後端 + 資料庫 + 照片全部放在**醫院的一台 Windows 電腦**；病人手機只在**院內 Wi-Fi**
連得到；你對那台機器有**系統管理員權限**；**IRB 還在審查中**（現階段只能放測試資料）。

> 這份文件取代 [DEPLOY.md](./DEPLOY.md)（方案 A：Render + Neon + R2 + Cloudflare Pages）
> 作為目前的部署方向。方案 A 保留作為備案，若資訊室不同意院內自架再回去看它（見第九節）。

---

## 〇、先看懂這個方案改變了什麼

技術上的差別其次，**最大的改變是收案流程**。

| | 方案 A（雲端） | 方案 B（醫院電腦） |
|---|---|---|
| 病人什麼時候能上傳 | 隨時，4G 就可以 | **只有人在醫院、連上院內 Wi-Fi、而且 App 有被打開** |
| 資料放在哪 | 國外機房 | 院內，IRB 比較好過 |
| 誰維護 | 平台 | 你 |
| 月費 | 約 NT$230 | 0（但要一台不能關的電腦） |
| 最大風險 | 境外傳輸、服務到期 | **資料卡在病人手機裡上不來**、那台電腦被重開 / 被還原 / 硬碟壞掉 |

### 這三件事一定要先想清楚

**1. 病人在家記錄的資料，會一直躺在他手機裡。**

App 是離線優先設計：拍照後先寫進手機的 IndexedDB，連得上伺服器才上傳
（見 [ARCHITECTURE.md 的「離線優先設計」](./ARCHITECTURE.md)）。改成院內自架之後，
「連得上伺服器」只會發生在病人回診那幾十分鐘。所以：

- **每次回診，衛教師必須確認那支手機的「待上傳」歸零**，才算真的收到資料。
  這要寫進收案 SOP，不能靠病人自己注意。
- 病人在回診之前換手機、手機壞掉、手滑解除安裝 App，**那段期間的資料就永久消失**，
  而且你不會知道它曾經存在過。
- 兩次回診之間的資料量：壓縮後一張約 180KB，一天 6 張約 1MB，三個月約 110MB。
  手機容量不是問題。

**2. 登入狀態必須撐過整個回診間隔。**

`JWT_REFRESH_EXPIRES_IN` 預設一年，足以涵蓋任何回診間隔，**通常不用動**。
之所以要知道有這個值，是因為設太短會確定出事：病人帶著兩個月的紀錄回來時會發現自己
被登出，而他的密碼是衛教師幫他建的、他多半不知道。

**3. 現在是 IRB 審查中，這台機器上不能有真實病人資料。**

這個階段部署的目的是「把環境弄好、把流程走通」，所有測試都用假帳號
（信箱結尾用 `@example.invalid`）。真的要請護理師看介面，用 App 內建的**試用模式**，
那條路完全不碰伺服器。IRB 通過之後要清庫重來，見第八節。

---

## 一、動手之前：先去問資訊室（這一步最花時間，今天就去問）

就算你對那台電腦有管理員權限，**在醫院網路上架一台存病人照片的伺服器，資訊室一定要知情**。
很多醫院這叫「資訊系統上線申請」或「資安風險評估」，流程兩週到兩個月都有可能。
先問清楚，否則你裝好了才被要求拆掉。

把下面這張表列印出來帶去問：

| 要問的事 | 為什麼要問 | 答案如果是壞的，代表什麼 |
|---|---|---|
| **病人的手機會連哪個 Wi-Fi？訪客網還是員工網？** | 訪客網幾乎都開「用戶端隔離」（AP isolation），手機連得上網際網路，但**連不到同一個網路裡的任何一台電腦** | 整個方案直接不成立，要走第九節的替代方案 |
| **那台電腦和病人手機在不在同一個網段？中間有沒有防火牆？** | 院內通常把行政網、醫療網、訪客網切成不同 VLAN，彼此預設不通 | 同上，或要請資訊室開一條規則 |
| **能不能給那台電腦固定 IP（或 DHCP 保留）？能不能給一個院內 DNS 名稱？** | 後端網址要**寫死在 APK 裡**，IP 一變所有病人的 App 同時失效 | 只能用 IP，而且要盯著它不要變 |
| **我可以在這台機器上裝 Node.js、PostgreSQL、並開一個網路服務嗎？** | 有些醫院的終端機有白名單或應用程式控管 | 要改用資訊室提供的機器或虛擬機 |
| **這台電腦有沒有還原卡／Deep Freeze／系統還原方案？** | 醫院公用電腦很常裝，**重開機會把整顆系統碟還原成原狀** | 你的資料庫和照片會在某次重開後全部消失，且無法復原。這是最致命的一項 |
| **GPO 會不會強制在凌晨自動更新重開？** | 會的話，服務必須設定成開機自動啟動（3.9 做的就是這件事） | 不致命，但代表「開一個終端機跑著」的做法絕對不行 |
| **這台電腦能不能連外網（網際網路）？** | `npm install` 要抓套件 | 要在家先裝好整包帶過去，見 3.4 |
| **防毒／端點防護是什麼？能不能加排除清單？** | 防毒即時掃描會把每張上傳的照片掃一遍，也可能把 node.exe 當成可疑程式 | 上傳會很慢，或服務莫名其妙被終止 |
| **備份可以放哪裡？能不能接外接硬碟？能不能傳到院外？** | 醫療資料外傳通常全面禁止 | 備份只能留在院內，那就要兩份不同的實體位置 |
| **這台電腦斷電過幾次？有沒有 UPS？** | PostgreSQL 突然斷電有機率損毀 | 自己買一台約 NT$2,000 的小 UPS |

> **怎麼開口**：不要說「我要架一台伺服器」，說
> 「我是成大資工的學生，跟 ◯◯ 醫師做一個腎臟病飲食紀錄的研究專題，
> IRB 審查中。需要在 ◯◯ 衛教室的這台電腦上跑一個只在院內使用的小程式，
> 病人回診時用手機連上來同步資料，資料不會離開醫院。想請教幾個網路和資安的問題。」
> 帶一份一頁的系統說明（可以用 [REPORT.md](./REPORT.md) 改）過去，會順很多。

---

## 二、第一天就該做的連線測試（還不用裝任何東西）

上面那張表裡**前兩項是 showstopper**，而且不用等資訊室回覆就能自己測。
帶一台筆電和一支 Android 手機去醫院，20 分鐘就能知道這個方案走不走得通。

### 2.1 測「手機看不看得到那台電腦」

在那台醫院電腦（或你的筆電，接同一條線）上開一個臨時的 HTTP 服務：

```powershell
# 在醫院電腦上，開一個最陽春的網頁伺服器
cd $env:TEMP
"hello" | Out-File -Encoding ascii index.html
python -m http.server 8080
# 沒有 python 的話：npx --yes http-server -p 8080
```

查這台電腦的 IP：

```powershell
ipconfig | Select-String "IPv4"
```

然後**用病人會用的那個 Wi-Fi** 把手機連上，瀏覽器開 `http://<那個IP>:8080`。

| 結果 | 意義 | 下一步 |
|---|---|---|
| 看到 hello | 通了，這個方案可行 | 繼續 2.2 |
| 一直轉圈 / 無法連線 | 用戶端隔離、VLAN 隔離，或 Windows 防火牆擋住 | 先關 Windows 防火牆再測一次。還是不通就是網路隔離，走第九節 |

> Windows 防火牆的臨時測試：`New-NetFirewallRule -DisplayName "temp-test" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow`，測完記得 `Remove-NetFirewallRule -DisplayName "temp-test"`。

### 2.2 測「連線穩不穩、會不會被踢掉」

醫院訪客 Wi-Fi 常常要每天重新認證（輸入手機號碼收簡訊）。年長病人不會自己弄。

- 手機連上之後放著 10 分鐘，看會不會被斷
- 問問櫃台：訪客 Wi-Fi 的密碼多久換一次、要不要每次重新登入

這會決定收案 SOP 裡「衛教師要幫病人做哪些事」。

### 2.3 測「IP 會不會變」

隔天再去一次，`ipconfig` 看 IP 是不是同一個。如果變了，**一定要跟資訊室要固定 IP 或 DNS 名稱**，
否則三個月內你會重打包 APK 好幾次，而每一次都要把 30 位病人找回來重裝。

---

## 三、在醫院電腦上安裝

以下假設：

- 安裝位置 `D:\kidney`（**路徑全英文**。專案路徑含中文會讓 Android 建置失敗，
  資料庫和 Node 雖然不受影響，但統一用英文路徑省得之後踩坑）
- 院內網址 `kidney.hosp.local`（請自行替換成資訊室給你的名稱或 IP）

```
D:\kidney\
  app\        ← 專案程式碼（git clone 或拷貝過來的）
  data\       ← PostgreSQL 的資料
  uploads\    ← 病人照片
  certs\      ← HTTPS 憑證
  logs\       ← 服務的輸出
  backup\     ← 每日備份（最好放在另一顆實體硬碟）
  public\     ← 給病人下載 APK 用
```

### 3.1 Node.js

到 [nodejs.org](https://nodejs.org) 下載 **Node.js 20 LTS 的 Windows Installer (.msi)**，
一路下一步。裝完開一個新的 PowerShell 確認：

```powershell
node -v    # 應該是 v20.x
npm -v
```

> 開發機用的也是 Node 20，版本一致可以少掉一類「在我電腦上好好的」問題。

### 3.2 PostgreSQL（這次要裝成 Windows 服務）

到 [enterprisedb.com](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads)
下載 **PostgreSQL 17** 的 Windows installer。

安裝時：

- Data Directory 改成 `D:\kidney\data`
- 設一個 postgres 超級使用者密碼，**記在安全的地方**
- Port 留 5432
- Stack Builder 不用裝

> **跟你開發機的差別**：開發機因為沒有管理員權限，PostgreSQL 是手動 `pg_ctl start` 啟動的
> （見 [CLAUDE.md](../CLAUDE.md)）。醫院這台有管理員權限，installer 會把它**裝成 Windows 服務**，
> 開機自動啟動。這正是我們要的——不要在這台機器上重複開發機那個手動啟動的做法。

裝完**立刻**把資料庫鎖成只聽本機。編輯 `D:\kidney\data\postgresql.conf`：

```
listen_addresses = 'localhost'
```

重啟服務：

```powershell
Restart-Service postgresql-x64-17
```

> 為什麼：後端跟資料庫在同一台機器上，資料庫完全不需要對網路開放。
> 開發用的 `docker-compose.yml` 把 5432 對外開放、密碼寫死在檔案裡，
> 那在一台連著醫院網路的機器上是災難。

建立這個專案要用的使用者和資料庫：

```powershell
$env:PGPASSWORD = "你剛剛設的 postgres 密碼"
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
& $psql -U postgres -h 127.0.0.1 -c "CREATE USER kidney_app WITH PASSWORD 'ThisIsNotTheRealPassword';"
& $psql -U postgres -h 127.0.0.1 -c "CREATE DATABASE kidney_diet OWNER kidney_app;"
Remove-Item Env:\PGPASSWORD
```

產生一個真的隨機密碼來用（跑三次，一個給資料庫、兩個給 JWT）：

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

> ⚠ **資料庫密碼裡如果有 `@` `#` `/` `:` 這些字元，連線字串會解析錯誤**，
> 而錯誤訊息長得像「資料庫連不上」，很難聯想到是密碼的問題。
> 兩種解法：把密碼做 URL 編碼，或乾脆**只用英數字**產生密碼：
> ```powershell
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

### 3.3 時間與時區（不要跳過）

連續天數、「今日三餐全勤」這些都是用伺服器時間算的。時間跑掉，資料就錯，而且錯得很難發現。

```powershell
# 時區設成台北
tzutil /s "Taipei Standard Time"

# 開啟自動校時
Set-Service w32time -StartupType Automatic
Start-Service w32time
w32tm /resync
w32tm /query /status
```

### 3.4 把程式碼和套件弄上去

**如果那台電腦連得上 GitHub：**

```powershell
cd D:\kidney
git clone https://github.com/rayyar28/kidney-diet-app.git app
cd app\backend
npm ci
```

**如果連不上外網（醫院很常見）**，在家先準備好整包再帶過去：

```powershell
# 在你自己的電腦上
cd D:\大學\專題\claude_app\backend
npm ci                 # 確保 node_modules 是乾淨的、跟 package-lock.json 一致
npm run build          # 先建置好，醫院那台就不用再編譯
```

然後把整個 `claude_app` 資料夾（**含 `node_modules` 和 `dist`**，但不要含 `.env`）
壓縮拷到隨身碟，在醫院電腦解壓到 `D:\kidney\app`。

> ⚠ `sharp` 這個套件含平台相依的二進位檔。你的開發機和醫院電腦都是 **Windows x64**，
> 直接複製 `node_modules` 沒問題；但如果醫院那台是 ARM 或 32 位元，就得在那台機器上
> 重新 `npm ci`（也就得有網路）。先用 `node -p "process.arch"` 確認兩邊一致。

### 3.5 建立 `backend\.env`

在 `D:\kidney\app\backend\.env` 建立這個檔案（**絕對不要 commit**，`.gitignore` 已經擋了）：

```bash
# ---- 資料庫（只連本機）----
DATABASE_URL="postgresql://kidney_app:這裡放3.2產生的密碼@127.0.0.1:5432/kidney_diet?schema=public"

# ---- JWT（用 3.2 的指令各產一組，不要跟開發用的一樣）----
JWT_ACCESS_SECRET="第一組隨機字串"
JWT_REFRESH_SECRET="第二組隨機字串"
JWT_ACCESS_EXPIRES_IN="15m"

# ★ 這一項對院內自架方案特別重要 ★
# 病人「最長多久會連上這台伺服器一次」就是回診間隔。只有在院內才連得上，
# 所以這個值必須比回診間隔還大，否則病人帶著累積的紀錄回診時會發現被登出，
# 而他的密碼是衛教師幫他建的、他多半不知道。
# 預設的一年足以涵蓋任何回診間隔，照抄即可。這不是安全參數——縮短它幾乎沒有防護價值
# （token 在資料庫只存雜湊、每次換發都輪替），要停掉某個人的存取是用撤銷而不是等過期。
JWT_REFRESH_EXPIRES_IN="365d"

PORT=4000

# ---- 允許的前端來源 ----
# App（Capacitor）的 Origin 是 https://localhost，後端程式已經內建放行，
# 這裡只需要填「用瀏覽器開後台」會用到的來源。
CORS_ORIGIN="https://kidney.hosp.local"

# ---- 照片存本機磁碟 ----
STORAGE_DRIVER="local"
UPLOAD_DIR="D:/kidney/uploads"
SIGNED_URL_TTL_SECONDS=300

# ---- 忘記密碼 ----
PASSWORD_RESET_EXPIRES_IN="60m"
APP_URL=""
# 院內機器寄不出信（沒有自己的網域、多半也不能連外部 SMTP），
# 所以寄信功能等於關閉，只留「衛教師當面開代碼」那條路。
# 這不是將就：對這個收案情境，當面開代碼本來就是主力（見 MEETING_0930.md 2.5）。
MAIL_DRIVER="console"
```

> `UPLOAD_DIR` 在 Windows 上**用正斜線** `D:/kidney/uploads`。反斜線在這個檔案裡會被當成跳脫字元。
> 這跟 `android/local.properties` 的 `sdk.dir` 是同一個坑。

### 3.6 建資料表、建置、灌徽章

```powershell
cd D:\kidney\app\backend
npx prisma migrate deploy
npx prisma generate
npm run build
npm run seed
```

四個指令都要跑，而且順序不能換：

| 指令 | 為什麼 |
|---|---|
| `prisma migrate deploy` | 套用 `prisma/migrations/` 裡那四個 migration。**不是 `migrate dev`**——`migrate dev` 偵測到不一致會要求重置整個資料庫，而且它需要互動輸入，在服務環境下會卡住 |
| `prisma generate` | 產生 Prisma Client。**忘了這一步會在執行時噴 500，而且 `tsc` 不會報錯**，你會以為程式壞了 |
| `npm run build` | 編譯成 `dist/`。正式環境跑 `node dist/index.js`，不是 `tsx` |
| `npm run seed` | 建立徽章資料。沒跑的話遊戲化功能會正常運作，但**一個徽章都發不出來**，而且不會報錯（`awardBadgeIfNew` 找不到徽章就安靜跳過） |

先用前景模式確認它跑得起來：

```powershell
node dist\index.js
# 應該看到：
#   API server listening on port 4000
#   Storage driver: local
#   Allowed origins: https://kidney.hosp.local
```

另開一個 PowerShell 視窗：

```powershell
Invoke-RestMethod http://127.0.0.1:4000/api/health
# 應該回：ok : True
```

確認完 Ctrl+C 停掉，等 3.9 再變成服務。

### 3.7 開衛教師帳號

衛教師需要 `RESEARCHER` 角色才能幫病人開重設代碼。先用 App 或 API 註冊一個帳號，再升級：

```powershell
cd D:\kidney\app\backend
npm run grant-role -- nurse@hospital.tw RESEARCHER
```

改完**要重新登入才生效**。

### 3.8 HTTPS（這一節不做，App 一定連不上）

**這是整個部署最容易卡住、而且錯誤訊息最誤導的一步，請完整讀完。**

Android 從 9 開始預設封鎖明文 HTTP，而 `capacitor.config.ts` 裡也明確寫了
`allowMixedContent: false`，專案裡**沒有** `network_security_config.xml`。
結果是：App 去打 `http://192.168.x.x:4000/api/...` 會被系統直接擋下，
前端的 `fetch` 收到 `TypeError`，被歸類成 `NetworkError`，
畫面顯示 **「無法連線到伺服器」**。

這句話看起來像網路問題，你會去檢查 Wi-Fi、檢查防火牆、檢查 IP——全部都是對的，
但真正的原因是 `net::ERR_CLEARTEXT_NOT_PERMITTED`，只有接上
`chrome://inspect` 看 WebView 的 console 才看得到。

所以：**後端必須有 HTTPS**，而院內沒有公開網域、不能用 Let's Encrypt。
做法是自己簽一張憑證，再把自己的 CA 打包進 APK。

#### 3.8.1 產生憑證

最簡單的工具是 [mkcert](https://github.com/FiloSottile/mkcert/releases)（單一執行檔，不用安裝）：

```powershell
cd D:\kidney\certs
# 建立你自己的 CA（只影響這台電腦的信任區，不會動到別人的機器）
.\mkcert.exe -install

# 簽一張同時涵蓋名稱和 IP 的憑證
# （兩個都寫進去，之後萬一改用 IP 連也不用重簽）
.\mkcert.exe -cert-file server.pem -key-file server-key.pem kidney.hosp.local 192.168.1.50

# 找出 CA 根憑證的位置，等一下要打包進 APK
.\mkcert.exe -CAROOT
# 會印出一個路徑，裡面的 rootCA.pem 就是你要的
```

> **這張 CA 的私鑰（`rootCA-key.pem`）等同於「可以冒充任何網站」的能力**，
> 不要外流、不要進版控、不要放在共用磁碟。只需要留著 `rootCA.pem` 給 APK 用。

#### 3.8.2 用 Caddy 做 HTTPS 入口

後端程式本身只跑 HTTP（`app.listen`），不要為了 TLS 去改它。
前面放一個反向代理最乾淨，而 [Caddy](https://caddyserver.com/download) 在 Windows 上
就是一個 `.exe`，不需要 Docker（這台機器也別裝 Docker）。

`D:\kidney\Caddyfile`：

```
kidney.hosp.local {
    tls D:\kidney\certs\server.pem D:\kidney\certs\server-key.pem
    encode gzip

    reverse_proxy 127.0.0.1:4000
}

# 給病人下載 APK 用的明文入口。
# 單獨開一個 http 埠是因為：手機的「瀏覽器」不認得我們自己簽的 CA
# （CA 只打包進 App 裡），用 https 下載會跳一堆憑證警告，長輩會直接放棄。
# 這個埠只放 APK 檔，沒有任何病人資料。
:8080 {
    root * D:\kidney\public
    file_server
}
```

> 指定了 `tls <憑證檔>` 之後 Caddy 就不會去找 Let's Encrypt，
> 這點很重要，否則它會在沒有外網的機器上不斷重試並卡住啟動。

先手動跑一次確認：

```powershell
cd D:\kidney
.\caddy.exe run --config Caddyfile
```

### 3.9 全部裝成「開機自動啟動」的服務

**這一步決定了這個方案能不能撐三個月。** 只要是「開著一個終端機視窗跑」，
那麼某次 Windows 更新、某個清潔阿姨關機、某次停電，服務就再也不會回來，
而你可能三天後才從病人的抱怨裡發現。

用 [NSSM](https://nssm.cc/download)（單一執行檔）把兩個程式註冊成服務：

```powershell
cd D:\kidney

# --- 後端 API ---
.\nssm.exe install kidney-api "C:\Program Files\nodejs\node.exe" "D:\kidney\app\backend\dist\index.js"
# ★ 一定要設 AppDirectory：後端用 dotenv 從「工作目錄」讀 .env，
#   沒設的話服務會以 C:\Windows\System32 當工作目錄，找不到 .env 就啟動失敗
.\nssm.exe set kidney-api AppDirectory D:\kidney\app\backend
.\nssm.exe set kidney-api AppStdout D:\kidney\logs\api.log
.\nssm.exe set kidney-api AppStderr D:\kidney\logs\api-error.log
.\nssm.exe set kidney-api AppRotateFiles 1
.\nssm.exe set kidney-api AppRotateBytes 10485760
# 資料庫沒起來就啟動的話後端會直接掛掉，讓它等 PostgreSQL
.\nssm.exe set kidney-api DependOnService postgresql-x64-17
.\nssm.exe set kidney-api Start SERVICE_AUTO_START

# --- Caddy ---
.\nssm.exe install kidney-proxy "D:\kidney\caddy.exe" "run --config D:\kidney\Caddyfile"
.\nssm.exe set kidney-proxy AppDirectory D:\kidney
.\nssm.exe set kidney-proxy AppStdout D:\kidney\logs\caddy.log
.\nssm.exe set kidney-proxy AppStderr D:\kidney\logs\caddy-error.log
.\nssm.exe set kidney-proxy DependOnService kidney-api
.\nssm.exe set kidney-proxy Start SERVICE_AUTO_START

.\nssm.exe start kidney-api
.\nssm.exe start kidney-proxy
```

確認三個服務都在、而且都是「自動」：

```powershell
Get-Service postgresql-x64-17, kidney-api, kidney-proxy | Format-Table Name, Status, StartType
```

**然後做一次真正的測試：把電腦重新開機，不要登入，等三分鐘，再從別的機器確認服務回來了。**
這個測試比任何檢查清單都有用——它同時驗證了自動啟動、相依順序、以及「不需要有人登入」。

### 3.10 防火牆：只開必要的、只開給該開的網段

```powershell
# HTTPS（App 用）— RemoteAddress 換成病人 Wi-Fi 實際的網段
New-NetFirewallRule -DisplayName "Kidney App HTTPS" -Direction Inbound `
  -Protocol TCP -LocalPort 443 -RemoteAddress 192.168.1.0/24 -Action Allow

# APK 下載（只在發放 App 的那幾天開，發完就關掉）
New-NetFirewallRule -DisplayName "Kidney APK download" -Direction Inbound `
  -Protocol TCP -LocalPort 8080 -RemoteAddress 192.168.1.0/24 -Action Allow
```

**不要開 4000（後端）和 5432（資料庫）。** 它們只需要被本機連到。

### 3.11 電源、更新、防毒

| 項目 | 怎麼設 | 為什麼 |
|---|---|---|
| 永不睡眠 | 控制台 → 電源選項 → 變更進階電源設定：睡眠、硬碟、USB 選擇性暫停、網路卡節能全部關掉 | 睡著了手機就連不上，而且病人只會看到「無法連線到伺服器」 |
| 關閉快速啟動 | 電源選項 → 選擇按下電源按鈕時的行為 → 取消「開啟快速啟動」 | 快速啟動的「關機」其實是休眠，會讓某些服務狀態怪異 |
| Windows 更新 | 設定「使用中時間」涵蓋門診時段；但如果有 GPO 強制更新就蓋不掉，所以 3.9 的服務化才是真正的保險 | 半夜重開不可怕，服務起不來才可怕 |
| 自動登入 | 不需要。服務是以系統身分執行的，不用有人登入 | 少一個風險 |
| 防毒排除清單 | 把 `D:\kidney\data`、`D:\kidney\uploads` 加進排除；確認 `node.exe`、`caddy.exe` 沒被封 | 即時掃描會讓每張照片的寫入都慢上好幾倍，資料庫目錄被掃甚至可能損毀 |
| 貼紙條 | 機器上貼「研究進行中，請勿關機／請勿拔網路線，問題請聯絡 張庭瑞 09xx-xxx-xxx」 | 真的有用 |
| UPS | 約 NT$2,000 的小台就夠 | PostgreSQL 突然斷電有機率損毀資料檔 |

---

## 四、打包正式版 APK

目前發出去的三版是**試用版**（第一次開啟會問後端網址）。正式版要把網址寫死，
並且讓 App 信任你自己簽的憑證。

### 4.1 讓 App 信任你的 CA（對應 3.8）

**步驟一**：把 3.8.1 產生的 `rootCA.pem` 複製到

```
frontend/android/app/src/main/res/raw/hospital_ca.pem
```

（`raw` 資料夾目前不存在，自己建。檔名只能用**小寫英文、數字、底線**，
用了大寫或減號 Android 建置會失敗。）

**步驟二**：新增 `frontend/android/app/src/main/res/xml/network_security_config.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!--
        全站仍然禁止明文 http；只是在系統內建的信任清單之外，
        額外信任我們自己簽的那張 CA（院內伺服器用）。
        把 CA 打包進 App，好處是不用在 30 支病人手機上一支一支安裝憑證；
        而且信任範圍只有這個 App，不會影響手機上其他程式。
    -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="@raw/hospital_ca" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

**步驟三**：在 `frontend/android/app/src/main/AndroidManifest.xml` 的 `<application>`
標籤上加一個屬性：

```xml
<application
    android:allowBackup="true"
    android:networkSecurityConfig="@xml/network_security_config"
    ...>
```

> `npx cap copy` 只會覆蓋網頁資源，不會動到這兩個檔案，所以改一次就好。

#### 只在 IRB 前的測試階段：允許明文的簡易版

如果你想先跳過憑證、用 `http://192.168.1.50:4000` 把流程走通（**只能放假資料**），
把 `network_security_config.xml` 換成：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <!-- 僅供 IRB 通過前的測試。收真實病人資料之前一定要換回上面的憑證版本。 -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">192.168.1.50</domain>
    </domain-config>
</network-security-config>
```

這樣病人的帳密和照片會在院內 Wi-Fi 上以明文傳輸。測試階段可以，正式收案不行。

### 4.2 寫死後端網址

`frontend/.env.production`：

```
VITE_API_BASE_URL=https://kidney.hosp.local/api
```

> **結尾要有 `/api`**。設了之後 `needsApiBaseSetup()` 會是 false，
> 病人打開 App 不會看到「伺服器設定」畫面。
>
> ⚠ `VITE_` 開頭的變數是**建置時**寫進 bundle 的。改了值一定要重新 `npm run build`
> 再 `npx cap copy android`，不是改完重開 App 就好。
>
> `.env.production` 被 `.gitignore` 的 `.env.*` 規則擋住、不會進版控，
> 所以換一台電腦建置時要自己重建這個檔案。這是刻意的（避免網址寫進公開的 repo），
> 但要記得，否則會打包出一個沒有網址、開起來又出現「伺服器設定」畫面的 APK。

### 4.3 正式簽章金鑰：現在就要定案

目前的 APK 是 `assembleDebug` 產生的，用的是 Android 的通用 debug 金鑰。
正式版要用自己的金鑰（`assembleRelease`）。

**關鍵時間點**：簽章金鑰一換，Android 就當成「不同來源的 App」，
**已經裝了舊版的手機必須先解除安裝才能裝新版**，而解除安裝會清掉手機裡還沒上傳的離線紀錄。

現在換沒關係（試用版的資料本來就只是測試資料）。**病人開始收案之後就絕對不能換。**
所以現在就把金鑰產生出來、備份好，之後每一版都用它。

```powershell
cd D:\kidney-build\frontend\android
keytool -genkeypair -v -keystore kidney-release.jks -alias kidney `
  -keyalg RSA -keysize 4096 -validity 10000
```

- 金鑰和兩個密碼**存兩份**：一份在你電腦、一份在別的地方（例如加密的隨身碟）
- **不能外流**（別人可以冒名發佈更新），**不能弄丟**（弄丟就無法覆蓋安裝）
- `frontend/android/.gitignore` 已經擋掉 `*.jks` / `*.keystore`，
  所以**金鑰檔要放在 `frontend/android/` 底下**（上面的指令就是在那裡產生的）。
  放到 repo 的其他地方不會被擋到，`git status` 會看到它——看到了就代表位置錯了

### 4.4 建置

記得專案路徑含中文會讓 Android 工具失敗，要從純英文路徑的目錄連結執行：

```powershell
# 第一次才需要建連結
cmd /c 'mklink /J "D:\kidney-build" "D:\大學\專題\claude_app"'

cd D:\kidney-build\frontend
npm run build
npx cap copy android
cd android
.\gradlew.bat assembleRelease
```

產出在 `frontend/android/app/build/outputs/apk/release/`。

### 4.5 怎麼把 APK 發到病人手機上

APK 放到 `D:\kidney\public\app.apk`，病人用手機瀏覽器開：

```
http://kidney.hosp.local:8080/app.apk
```

做一張 QR code 印出來貼在衛教室，病人掃了就能下載。

**現場一定要衛教師幫忙做的事**（不要指望病人自己完成）：

1. 手機連上院內 Wi-Fi
2. 掃 QR code 下載
3. 跳出「基於安全考量，無法安裝未知來源的應用程式」→ 點「設定」→ 開啟「允許來自此來源」
4. 安裝、開啟、**當場登入一次**
5. **當場完整拍一餐**（餐前照 + 餐後照），確認上傳成功
6. 給他一張名片大小的紙本帳密卡：網址、帳號、密碼、聯絡方式

---

## 五、驗收清單（在醫院現場、用真的手機，不要在宿舍測）

照順序做，每一項失敗都指向不同的原因。

### 5.1 在那台電腦上

- [ ] `Get-Service postgresql-x64-17, kidney-api, kidney-proxy` 三個都是 Running、StartType 都是 Automatic
- [ ] `Invoke-RestMethod http://127.0.0.1:4000/api/health` 回 `ok : True`
- [ ] `Invoke-RestMethod https://kidney.hosp.local/api/health` 回 `ok : True`（走 Caddy，憑證正確）
- [ ] **重新開機，不要登入，等三分鐘，再測一次上面兩項**

### 5.2 用手機（連病人會用的那個 Wi-Fi）

- [ ] 瀏覽器開 `http://kidney.hosp.local:8080/app.apk` → 下載得到檔案（代表網路通）
- [ ] 裝好 App，開啟後**不應該**出現「伺服器設定」畫面（代表 4.2 設對了）
- [ ] 用測試帳號登入成功 ← **這一關過了，表示 HTTPS + 憑證 + CORS 全部正確**
- [ ] 拍一張餐前照 → 上傳成功；到 `D:\kidney\uploads` 看得到那個檔案
- [ ] 拍餐後照 → 完成，出現點數和用餐時長
- [ ] 歷史頁（月曆）看得到剛才那兩張照片
- [ ] 個人頁拿得到徽章 ← 沒有的話是 `npm run seed` 忘了跑

### 5.3 離線情境（這個方案的核心，一定要測）

- [ ] 開飛航模式 → 完整記錄一餐 → App 顯示「待上傳 1 筆」
- [ ] 關掉飛航模式、連回院內 Wi-Fi → App 回到前景 → 自動上傳、計數歸零
- [ ] 飛航模式下記錄**三餐**、跨兩天 → 恢復連線後全部上傳，而且連續天數算對
      （同步引擎是依「動作實際發生的時間」排序上傳的，這一項在驗證那個邏輯）
- [ ] 走出醫院（離開 Wi-Fi 範圍）→ App 不會當掉、不會跳錯誤、紀錄還在

### 5.4 實機項目（目前還沒驗證過，一併做掉）

[README 的「已知限制」](../README.md#已知限制) 裡列著三項從未在實體 Android 裝置上驗證過的功能，
趁這次帶手機去醫院一起測：

- [ ] WebView 內的即時相機真的開得起來、拍得到照片
- [ ] 照片有另存到手機相簿「腎臟飲食紀錄」，檔名正確
- [ ] 完全離線冷啟動（先開飛航模式再開 App）不會白畫面

### 5.5 怎麼看 App 裡面到底發生什麼事

手機接 USB 到電腦，Chrome 開 `chrome://inspect`，就能看到 WebView 的 console 和 network。
**排查「無法連線到伺服器」只能靠這個**，請務必在發 APK 之前先確認你會用。

> release 版預設不能 inspect。留一份 debug 版（`assembleDebug`，但 `.env.production`
> 和憑證設定都一樣）在身上專門用來除錯。

---

## 六、備份：三個月收案的生死問題

**一台電腦上的資料等於沒有備份。** 硬碟壞掉、誤刪一個資料夾、還原卡把系統碟還原，
三個月的收案就沒了，而且病人不可能再吃一次那些飯。

### 6.1 每日備份腳本

`D:\kidney\backup.ps1`：

```powershell
# 注意：主控台編碼是 MS950，腳本輸出不要放 emoji，會 UnicodeEncodeError 直接中斷
$ErrorActionPreference = "Stop"
$date = Get-Date -Format "yyyyMMdd"
$dest = "E:\kidney-backup\$date"      # ← 另一顆實體硬碟，不是同一顆的別的分割區
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# 1. 資料庫
$env:PGPASSWORD = "資料庫密碼"
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -U kidney_app -h 127.0.0.1 `
  -d kidney_diet -f "$dest\db.sql"
Remove-Item Env:\PGPASSWORD

# 2. 照片（robocopy /MIR 會鏡像，含刪除；用 /E 只增量複製比較安全）
robocopy "D:\kidney\uploads" "$dest\uploads" /E /R:2 /W:5 /NFL /NDL | Out-Null

# 3. 設定檔（.env 裡有密碼，這份備份也要當機密資料保管）
Copy-Item "D:\kidney\app\backend\.env" "$dest\env.backup"

# 4. 只保留 30 天
Get-ChildItem "E:\kidney-backup" -Directory |
  Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Recurse -Force

Write-Output "backup done: $dest"
```

用工作排程器設每天凌晨三點執行（「不論使用者是否登入均執行」+「以最高權限執行」）：

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
           -Argument "-NoProfile -ExecutionPolicy Bypass -File D:\kidney\backup.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "kidney-backup" -Action $action -Trigger $trigger `
  -RunLevel Highest -User "SYSTEM"
```

### 6.2 異地備份

醫院多半不允許把資料傳到院外雲端。可行的做法：

- 一顆**加密的外接硬碟**（BitLocker To Go），每週帶去醫院同步一次、放在實驗室
- 或請資訊室給一個院內的網路磁碟機當第二份

無論哪種，**檔案要加密**。研究資料外洩的責任是你和指導教授的。

### 6.3 每個月實際還原一次

沒有驗證過的備份不算備份。找一台別的電腦（或你的開發機）：

```powershell
# 建一個空庫把備份倒回去，確認資料真的完整
createdb -U postgres kidney_restore_test
psql -U postgres -d kidney_restore_test -f "E:\kidney-backup\20261101\db.sql"
```

然後隨便挑三筆紀錄，確認照片檔案在 `uploads` 備份裡也找得到。

---

## 七、可能發生的狀況與處理

### 7.1 最常見的那一個：「無法連線到伺服器」

這句話是前端對所有「連不上」的統稱，背後至少有六個不同的原因。**照這個順序查**：

| 先測這個 | 結果 | 代表 |
|---|---|---|
| 電腦上 `Invoke-RestMethod http://127.0.0.1:4000/api/health` | 失敗 | 後端沒起來 → 看 `D:\kidney\logs\api-error.log` |
| 電腦上 `Invoke-RestMethod https://kidney.hosp.local/api/health` | 失敗 | Caddy 或憑證問題 → 看 `caddy-error.log` |
| 手機瀏覽器開 `http://kidney.hosp.local:8080/app.apk` | 下載不了 | 網路不通：用戶端隔離、VLAN、或防火牆 |
| 手機瀏覽器開 `https://kidney.hosp.local/api/health` | 憑證警告但按「繼續」後看得到 `{"ok":true}` | 網路通、服務正常，**問題在 App 的憑證信任**（瀏覽器不認得你的 CA 是正常的，App 應該要認得） |
| `chrome://inspect` 看 console | `ERR_CLEARTEXT_NOT_PERMITTED` | 4.1 沒做，或 App 連的是 http 網址 |
| 同上 | `ERR_CERT_AUTHORITY_INVALID` | CA 沒打包進 APK，或 `rootCA.pem` 放錯位置／檔名有大寫 |
| 同上 | `ERR_NAME_NOT_RESOLVED` | 手機解析不到 `kidney.hosp.local`，院內 DNS 沒設定 → 先改用 IP 驗證 |
| 後端 log 出現「不允許的來源：...」 | | CORS。Capacitor 的 `https://localhost` 已內建放行，會看到這行通常是你用瀏覽器開後台 → 把那個網址加進 `CORS_ORIGIN` |

### 7.2 其他狀況

| 症狀 | 可能原因 | 怎麼確認 | 處理 |
|---|---|---|---|
| **某天早上全部病人都上傳失敗** | 電腦半夜重開，服務沒自動起來 | `Get-Service kidney-api, kidney-proxy, postgresql-x64-17` | 三個都要是 Automatic；`DependOnService` 設對（3.9）。這就是為什麼要先做過一次「重開機不登入」的測試 |
| **同上，但服務都是 Running** | 電腦的 IP 變了 | `ipconfig` 比對 APK 裡寫死的位址 | 要固定 IP 或院內 DNS。只能用 IP 的話，每次開工先確認 |
| **病人回診時發現被登出** | refresh token 過期 | 後端 log 的 401 | `JWT_REFRESH_EXPIRES_IN` 要大於回診間隔，預設一年（3.5）。⚠ 改了只對**之後的登入**生效，已經發出去的憑證不會延長 |
| **病人說「我記錄了很多但你那邊沒有」** | 他回診時沒連 Wi-Fi，或沒打開 App 等它傳完 | App 首頁的待上傳筆數 | 收案 SOP：每次回診衛教師確認歸零。這是這個方案最大的資料流失來源 |
| **照片上傳回「無法解析這張圖片」** | sharp 解不開檔案 | `api-error.log` | Android 端前端已經把照片壓成 JPEG 才上傳，理論上不會發生；真的遇到，請把那張原始檔留下來 |
| **上傳很慢（一張要十幾秒）** | 防毒即時掃描 uploads、或 Wi-Fi 訊號弱 | 工作管理員看磁碟使用率 | 把 `D:\kidney\uploads` 和 `D:\kidney\data` 加進防毒排除清單（3.11） |
| **後端啟動就掛掉，log 說資料庫連不上** | 密碼含特殊字元沒做 URL 編碼 | `api-error.log` | 換成純英數密碼（3.2） |
| **後端啟動就掛掉，log 說 Missing required env var** | 服務的工作目錄不對，讀不到 `.env` | `nssm edit kidney-api` 看 AppDirectory | 設成 `D:\kidney\app\backend` |
| **API 回 500，但 TypeScript 編譯沒問題** | 改了 schema 之後忘了 `npx prisma generate` | `api-error.log` | 跑一次 generate 再重啟服務 |
| **連續天數 / 今日全勤算錯** | 伺服器時間或時區不對 | `w32tm /query /status`、`Get-Date` | 3.3 的設定；時區必須是 Taipei |
| **磁碟滿了** | 照片 + log + 備份 | `Get-PSDrive D` | 30 人 3 個月的照片約 3GB，但 log 和備份會長大。保持 50GB 以上可用空間，並把備份放別顆硬碟 |
| **資料庫損毀，起不來** | 突然斷電 | PostgreSQL 服務起不來 | 從最近一次 `pg_dump` 還原（6.3）。這就是 UPS 的用途 |
| **某次重開後整台機器回到原狀、程式都不見了** | 還原卡 / Deep Freeze | 問資訊室 | 這台機器不能用。第一節第五個問題就是在防這個 |

### 7.3 要怎麼知道服務掛了

院內機器連不到外網的話，UptimeRobot 這類外部監測用不了。替代做法：

- **最低限度**：請衛教師每天上班時用手機開一下 App，看得到首頁就代表活著
- **好一點**：在你自己的筆電上設一個工作排程，每小時打一次
  `https://kidney.hosp.local/api/health`，失敗就寄信給自己（只在你人在院內時有效）
- **再好一點**：那台電腦上設一個排程，`/api/health` 失敗就自動重啟服務並寫進 log

```powershell
# D:\kidney\watchdog.ps1 — 每 10 分鐘執行一次
try {
    $r = Invoke-RestMethod "http://127.0.0.1:4000/api/health" -TimeoutSec 10
    if (-not $r.ok) { throw "health not ok" }
} catch {
    Add-Content "D:\kidney\logs\watchdog.log" "$(Get-Date -Format s) restart: $_"
    Restart-Service kidney-api
}
```

---

## 八、IRB 的時間線：現在能做什麼、通過後要做什麼

### 8.1 現在（審查中）

這個階段部署的目的是**把環境和流程弄好**，不是收資料。規矩：

- 這台機器上**只能有測試資料**。測試帳號信箱一律用 `@example.invalid` 結尾
- **不要把正式版 APK 發給真的病人**。要請護理師看介面，用 App 內建的
  [試用模式](../README.md#給護理師試用不需要架伺服器)——那條路同步引擎完全不啟動，
  照片不會離開測試者的手機
- 可以、而且應該做完的事：第一節的資訊室溝通、第二節的連線測試、
  第三節的整套安裝、第五節的驗收（用假資料）

### 8.2 IRB 通過之後、開始收第一位病人之前

**清庫重來**，把測試階段的痕跡清乾淨：

```powershell
Stop-Service kidney-api
$env:PGPASSWORD = "postgres 密碼"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h 127.0.0.1 -c "DROP DATABASE kidney_diet;"
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h 127.0.0.1 -c "CREATE DATABASE kidney_diet OWNER kidney_app;"
Remove-Item Env:\PGPASSWORD
Remove-Item "D:\kidney\uploads\*" -Recurse -Force
cd D:\kidney\app\backend
npx prisma migrate deploy
npm run seed
Start-Service kidney-api
```

並且把 `.env` 裡的兩組 JWT secret **換成新的**（測試期間它們可能出現在截圖、報告、
跟同學的對話裡）。

### 8.3 還沒做完、但收案前必須完成的程式面項目

這幾項在 [DEPLOY.md 的「正式收案前必須完成」](./DEPLOY.md) 有完整說明，這裡只列清單：

- [ ] **EXIF 拍攝時間**（`exifCapturedAt` + `captureSource`）— 否則從相簿選的照片時間不可信，
      而你的研究要談用餐時長。⚠ 必須在壓縮之前讀取，壓縮會把 EXIF 移除
- [ ] `participantCode` 假名化欄位
- [ ] 同意書欄位 `consentedAt` / `consentVersion` / `withdrawnAt`
- [ ] 幫衛教師開好 `RESEARCHER` 帳號（3.7）

### 8.4 同意書要寫到的事（院內自架版本）

方案改成院內自架之後，同意書的內容也要跟著改：

- 照片和紀錄存在**醫院內部的一台電腦**，不會傳到境外或商業雲端服務
  （這一點對 IRB 是加分項，記得寫清楚）
- 病人在 App 上「刪除」一筆紀錄，是從他的畫面移除，**資料仍會保留供研究使用**（軟刪除）
- App 會把拍的照片另存一份到**病人自己手機的相簿**，而多數手機會自動備份相簿到雲端；
  這些照片**不含 GPS 座標**（壓縮時已移除），但是否需要說明請 IRB 判斷
  （見 [MEETING_0930.md 5.2](./MEETING_0930.md)）
- 會蒐集哪些中繼資料（拍攝時間、裝置型號、用餐時長）

---

## 九、如果第二節測不通 / 資訊室不同意

照「最容易成功」排序：

### 9.1 用那台電腦自己開一個 Wi-Fi 熱點（推薦先試這個）

Windows 的「行動熱點」或接一個 USB Wi-Fi 網卡，讓那台電腦自己發出一個 SSID。
病人回診時連那個熱點來同步。

| 優點 | 缺點 |
|---|---|
| **完全不碰院內網路**，資訊室通常容易同意（等於只是兩台裝置直連） | 訊號範圍小，只能在衛教室裡面用 |
| Windows ICS 的閘道 IP 固定是 `192.168.137.1`，**永遠不會變**，寫死在 APK 裡很安全 | 熱點要有人記得開著 |
| 沒有用戶端隔離問題 | 病人連上後沒有網際網路，要跟他說明 |

憑證就簽給 `192.168.137.1`（mkcert 支援 IP），`.env.production` 填
`https://192.168.137.1/api`。

> 要先確認那台電腦有 Wi-Fi 網卡、而且 GPO 沒有禁止建立熱點。
> 另外**不要自己插一台無線 AP 到院內網路**——那在多數醫院是明文禁止的行為。

### 9.2 換一台專用機

跟實驗室或教授申請一台小主機（迷你 PC 約 NT$8,000），放在衛教室，
不走醫院的公用電腦。這樣就沒有還原卡、GPO、別人關機的問題，
但網路問題還是要資訊室協助。

### 9.3 回去用方案 A（雲端）

[DEPLOY.md](./DEPLOY.md) 還在。病人可以在家隨時上傳，資料流失風險最低，
但資料在境外，IRB 可能有意見——這正是當初 [MEETING_0930.md 5.1](./MEETING_0930.md)
那個還沒決定的問題。

### 9.4 混合：主機在雲端、備份在院內

主機放 Render，每週 `pg_dump` 一份加密後存到醫院/實驗室的機器。
兩邊的優點都拿到一些，但境外傳輸的問題沒有解決。

---

## 十、一句話總結這份手冊

**技術上最容易卡住的是 3.8（HTTPS／憑證），因為錯誤訊息會騙你；
流程上最容易出事的是「病人的資料一直留在手機裡沒上傳」，因為它不會報錯。
而最該今天就去做的，是第一節跟資訊室談、第二節帶手機去測連線——
那兩件事決定這個方案到底成不成立，而且不需要寫任何程式。**
