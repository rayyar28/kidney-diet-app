# 部署手冊 — 方案 B（醫院電腦自架，院內 Wi-Fi）

專案：`rayyar28/kidney-diet-app`
撰寫日期：2026-10-01｜改寫日期：2026-10-06（改用 Docker + SQLite）
適用情境：後端 + 資料庫 + 照片全部放在**醫院的一台 Windows 電腦**；病人手機只在**院內 Wi-Fi**
連得到；你對那台機器有**系統管理員權限**；**IRB 還在審查中**（現階段只能放測試資料）。

> 這份文件取代 [DEPLOY.md](./DEPLOY.md)（方案 A：Render + Neon + R2 + Cloudflare Pages）
> 作為目前的部署方向。方案 A 保留作為備案，若資訊室不同意院內自架再回去看它（見第九節）。

> **這份是「為什麼這樣做、出事怎麼辦」的完整版。**
> 只想知道要打哪些指令，看 [DEPLOY_DOCKER_WINDOWS.md](./DEPLOY_DOCKER_WINDOWS.md)，
> 那份一頁可以看完。兩份都假設你用 repo 裡的 `docker-compose.prod.yml`、`Caddyfile`、
> `backup.ps1`。

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
| **我可以在這台機器上裝 Docker Desktop、並開一個網路服務嗎？** | 有些醫院的終端機有白名單或應用程式控管；**Docker Desktop 對大型組織要付費訂閱**（見 3.2） | 要改用資訊室提供的機器或虛擬機，或改用免授權費的容器執行環境 |
| **這台電腦有沒有還原卡／Deep Freeze／系統還原方案？** | 醫院公用電腦很常裝，**重開機會把整顆系統碟還原成原狀** | 你的資料庫和照片會在某次重開後全部消失，且無法復原。這是最致命的一項 |
| **GPO 會不會強制在凌晨自動更新重開？** | 會的話，重開之後服務必須自己回來（3.9 在處理這件事） | 不致命，但代表「開一個終端機跑著」的做法絕對不行 |
| **這台電腦能不能連外網（網際網路）？** | 要抓 Docker image 和套件 | 要在家先把 image 匯出帶過去，見 3.4 |
| **防毒／端點防護是什麼？能不能加排除清單？** | 防毒即時掃描會把每張上傳的照片掃一遍，也可能干擾 Docker 的虛擬磁碟 | 上傳會很慢，或容器莫名其妙被終止 |
| **備份可以放哪裡？能不能接外接硬碟？能不能傳到院外？** | 醫療資料外傳通常全面禁止 | 備份只能留在院內，那就要兩份不同的實體位置 |
| **這台電腦斷電過幾次？有沒有 UPS？** | SQLite 開著 WAL 對斷電有相當好的耐受度，但仍不是零風險，而且照片檔案也可能寫到一半 | 自己買一台約 NT$2,000 的小 UPS |

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

> 這一節解釋每一步在幹嘛、為什麼要這樣。**純指令清單看
> [DEPLOY_DOCKER_WINDOWS.md](./DEPLOY_DOCKER_WINDOWS.md)。**

### 3.1 為什麼用 Docker，而不是一個一個裝

這個系統要跑三個東西：後端（Node）、反向代理（Caddy，負責 HTTPS）、資料庫。
在一台不屬於你、你也不會天天在旁邊的醫院電腦上，用 Docker 的理由是：

- **整包一致。** 開發機測過的環境就是醫院機器上跑的環境，不會有「在我電腦上好好的」。
- **重開機會自己回來。** compose 裡的 `restart: always` 就是這件事，不必再學 NSSM
  那類把程式註冊成 Windows 服務的工具（這份手冊的舊版本就是那樣做的，容易出錯的地方很多）。
- **解除乾淨。** 資訊室要你拆掉時，`docker compose down -v` 就沒了，不會在系統裡留下
  一堆服務和登錄檔項目。

**資料庫是 SQLite，所以不用裝。** 整個資料庫就是一個檔案，由後端自己建立，
放在 `db_data` 這個 Docker volume 裡。沒有資料庫服務、沒有 5432 埠、沒有資料庫密碼。

### 3.2 要裝的東西（只做一次，要系統管理員）

1. [Git for Windows](https://git-scm.com/download/win)
2. [Docker Desktop](https://www.docker.com/products/docker-desktop/)，安裝時勾 **WSL 2**

> ⚠️ **Docker Desktop 的授權**：對「員工 250 人以上或年營收 1000 萬美元以上」的組織
> 需要付費訂閱。醫院一定超過這個門檻。**裝之前先跟資訊室確認**——這是第一節那張表裡
> 「可不可以裝」那一題的一部分。真的不行的話，替代方案是 Rancher Desktop 或
> 在一台 Linux 虛擬機上跑 Docker Engine（本身是免授權費的）。

### 3.3 讓它在重開機後自己回來

Docker Desktop 是桌面程式，**沒有人登入它就不會啟動**——這是 Windows 版 Docker 唯一
比較彆扭的地方。兩個設定都要做：

1. Docker Desktop → Settings → General → 勾 **Start Docker Desktop when you sign in**
2. `netplwiz` → 取消「必須輸入使用者名稱和密碼」→ 設定自動登入

> 半夜 GPO 強制更新重開之後，這兩項決定了隔天早上病人上不上傳得了。
> 設完一定要做 5.1 的「重開機不登入」測試，不要相信它應該會動。

### 3.4 時間與時區（不要跳過）

```powershell
tzutil /s "Taipei Standard Time"
w32tm /resync
# 確認自動校時是開的
w32tm /query /status
```

時間錯了，連續天數和「今日三餐全勤」會算錯，而且**不會報錯**，你只會在分析資料時
覺得數字怪怪的。容器內的時區由 compose 的 `TZ: Asia/Taipei` 設定，但那只影響 log 的
時間顯示——真正用來算日期的是手機回報的時區偏移（見 ARCHITECTURE）。

### 3.5 取得程式碼

```powershell
mkdir D:\kidney
cd D:\kidney
git clone https://github.com/rayyar28/kidney-diet-app.git app
cd app
```

> **路徑不要有中文。**（開發機上的專案路徑有中文，所以 Android 建置要另外做目錄連結；
> 這台機器直接用英文路徑就好。）

**如果這台電腦連不到外網**，在家先把 image 匯出帶過去：

```powershell
# 在家（有網路的機器上）
docker compose -f docker-compose.prod.yml build
docker save kidney-diet-app-backend caddy:2-alpine -o kidney-images.tar

# 在醫院那台
docker load -i kidney-images.tar
```

程式碼本身用隨身碟拷貝整個資料夾過去即可（含 `.git` 的話之後還能 `git pull`）。

### 3.6 建立 `.env`

```powershell
copy .env.example .env
notepad .env
```

每一項的意義：

| 變數 | 填什麼 | 為什麼 |
|---|---|---|
| `JWT_ACCESS_SECRET`<br>`JWT_REFRESH_SECRET` | 各跑一次下面的指令產生 | 這兩個外流，任何人都能偽造任何病人的登入憑證。**不要跟開發環境用同一組** |
| `JWT_REFRESH_EXPIRES_IN` | `365d`（照抄就好） | 見第〇節第 2 點。只有在院內才連得上，所以這個值必須大於回診間隔 |
| `SERVER_NAME` | 這台機器對外的名稱或 IP，例如 `192.168.1.50` | **這個值會寫死進病人的 APK，之後不能改**。先確定它不會變 |
| `CORS_ORIGIN` | `https://<SERVER_NAME>` | App（Capacitor）的 Origin 是 `https://localhost`，後端已內建放行；這裡只是給「用瀏覽器開」的情況 |

```powershell
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> 用 hex 不用 base64：base64 會出現 `@ # / :` 這些字元，放進設定檔或連線字串時容易被誤解析，
> 而錯誤訊息通常跟真正的原因差很遠。

**資料庫不需要密碼**，照片路徑、寄信方式這些都由 compose 直接給定，不用在 `.env` 裡填。

> **為什麼寄信是關掉的**（`MAIL_DRIVER=console`）：院內機器沒有自己的網域、多半也不能連
> 外部 SMTP，寄不出去。所以「忘記密碼」只留**衛教師當面開代碼**那條路。
> 這不是將就——對這個收案情境，當面開代碼本來就是主力
> （帳號是衛教師建的，病人的信箱不見得通，見 [MEETING_0930.md 2.5](./MEETING_0930.md)）。

### 3.7 啟動

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

第一次約 3–5 分鐘。資料表由容器啟動時自己 `prisma migrate deploy` 建好。

**徽章資料要手動灌一次**：

```powershell
docker compose -f docker-compose.prod.yml exec backend npm run seed
```

不跑的話遊戲化會「正常運作」但一個徽章都發不出來，**而且不會報任何錯**——
這是最容易漏掉又最難發現的一步。

確認活著：

```powershell
docker compose -f docker-compose.prod.yml ps        # 兩個容器都要是 running
curl.exe -k https://localhost/api/health            # 應該回 {"ok":true}
```

### 3.8 開衛教師帳號

角色不能自助申請（註冊一律是病人），要由你在伺服器上開：

```powershell
# 先讓那位衛教師用 App 或瀏覽器註冊一個帳號，然後：
docker compose -f docker-compose.prod.yml exec backend `
  npm run grant-role -- nurse@hospital.tw RESEARCHER
```

> 權限寫在登入憑證裡，**改完要請他重新登入一次才會生效**。
> 之後他的「我的」頁面會多一顆「🔑 協助病人重設密碼」。

### 3.9 HTTPS 與憑證（這一節不做，App 一定連不上）

Caddy 用 `tls internal` 自己當 CA 簽了一張憑證。Android 預設封鎖明文 http，也不認得
這張自簽憑證，所以**必須把 Caddy 的根憑證打包進 APK**（做法在 4.1）。

把根憑證抓出來：

```powershell
docker compose -f docker-compose.prod.yml cp `
  caddy:/data/caddy/pki/authorities/local/root.crt D:\kidney\root.crt
```

> ⚠️ **絕對不要刪掉 `caddy_data` 這個 volume。** 那張 CA 的私鑰在裡面。刪了等於換一張 CA，
> 已經裝在病人手機上的 App 會**全部同時連不上**，而且只能重新打包 APK、請 30 位病人重裝。
> `docker compose down` 不會刪 volume；`down -v` 會。**不要打 `-v`。**

為什麼不用瀏覽器信任的正式憑證：那需要一個公開網域和能從網際網路連到的伺服器，
而這個方案刻意不對外。把 CA 打包進 App 的好處是不用在 30 支手機上一支一支安裝憑證，
而且信任範圍只有這個 App，不會影響手機上其他程式。

### 3.10 防火牆：只開必要的、只開給該開的網段

```powershell
# 443 給 App；RemoteAddress 換成病人 Wi-Fi 實際的網段
New-NetFirewallRule -DisplayName "Kidney HTTPS" -Direction Inbound -Protocol TCP `
  -LocalPort 443 -RemoteAddress 192.168.1.0/24 -Action Allow

# 8080 給病人下載 APK，發完 App 就可以 Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "Kidney APK" -Direction Inbound -Protocol TCP `
  -LocalPort 8080 -RemoteAddress 192.168.1.0/24 -Action Allow
```

後端在 compose 裡沒有開 port（只有 Caddy 進得來），所以**不需要也不應該開 4000**。
8080 那個埠只放 APK 檔，沒有任何病人資料；它是明文的，因為手機的瀏覽器不認得我們自己
簽的 CA，用 https 下載會跳一堆憑證警告，長輩會直接放棄。

### 3.11 電源、更新、防毒

- **UPS**：約 NT$2,000 的小台就夠。SQLite 開著 WAL 對斷電耐受度不錯，但照片檔案可能寫到一半。
- **Windows Update**：不要關，但把重開時間設在門診時段之外。
- **防毒排除清單**：把 Docker 的資料目錄（通常是
  `C:\Users\<你>\AppData\Local\Docker`）和 `D:\kidney` 加進去。即時掃描會讓照片上傳
  慢到病人等不下去，也可能干擾容器的虛擬磁碟。
- **不要讓別人用這台電腦**。貼一張紙：「研究用主機，請勿關機」。

---

## 四、打包正式版 APK

目前發出去的三版是**試用版**（第一次開啟會問後端網址）。正式版要把網址寫死，
並且讓 App 信任 Caddy 的那張 CA。

### 4.1 讓 App 信任那張 CA（對應 3.9）

**步驟一**：把 3.9 抓出來的 `root.crt` 複製到開發機的

```
frontend/android/app/src/main/res/raw/hospital_ca.pem
```

（`raw` 資料夾目前不存在，自己建。檔名只能用**小寫英文、數字、底線**，
用了大寫或減號 Android 建置會失敗。副檔名改成 `.pem` 沒關係，內容格式一樣。）

**步驟二**：新增 `frontend/android/app/src/main/res/xml/network_security_config.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!--
        全站仍然禁止明文 http；只是在系統內建的信任清單之外，
        額外信任 Caddy 自己簽的那張 CA（院內伺服器用）。
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

記得開發機的專案路徑含中文會讓 Android 工具失敗，要從純英文路徑的目錄連結執行：

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

APK 放到伺服器的 `D:\kidney\app\public\app.apk`（那個資料夾會被 Caddy 掛成
`/srv/public`），病人用手機瀏覽器開：

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

- [ ] `docker compose -f docker-compose.prod.yml ps` → 兩個容器都是 `running`
- [ ] `curl.exe http://127.0.0.1:4000/api/health` **應該連不上**（後端沒有對外開 port，這是對的）
- [ ] `curl.exe -k https://localhost/api/health` 回 `{"ok":true}`（走 Caddy）
- [ ] **重新開機，不要登入，等五分鐘，再測一次上面兩項** ← 這一項在驗 3.3，
      而且是最容易在收案第一週出事的地方

### 5.2 用手機（連病人會用的那個 Wi-Fi）

- [ ] 瀏覽器開 `http://kidney.hosp.local:8080/app.apk` → 下載得到檔案（代表網路通）
- [ ] 裝好 App，開啟後**不應該**出現「伺服器設定」畫面（代表 4.2 設對了）
- [ ] 用測試帳號登入成功 ← **這一關過了，表示 HTTPS + 憑證 + CORS 全部正確**
- [ ] 拍一張餐前照 → 上傳成功
- [ ] 拍餐後照 → 完成，出現點數和用餐時長
- [ ] 歷史頁（月曆）看得到剛才那兩張照片
- [ ] 個人頁拿得到徽章 ← 沒有的話是 3.7 的 seed 忘了跑

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

### 6.1 不可以直接複製資料庫檔案

資料庫開著 WAL 模式，內容分散在 `kidney.db` 與 `kidney.db-wal` 兩個檔案。
**在有人正在寫入時複製，會拿到一個不完整、還原回來是壞的快照**——
而且你不會當場發現，是要還原的那天才發現。

`backup.ps1` 走的是 SQLite 內建的 `VACUUM INTO`：它在交易保護下把整個資料庫寫成一個
乾淨的新檔案，過程中不需要停服務，產出的檔案可以直接拿來用。

### 6.2 每日備份

repo 裡的 `backup.ps1` 會做三件事：資料庫（`VACUUM INTO`）、照片（從 volume 打包出來）、
`.env`。先把裡面的路徑改成這台機器的實際路徑（備份目的地要是**另一顆實體硬碟**，
不是同一顆的別的分割區），然後設工作排程：

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
           -Argument "-NoProfile -ExecutionPolicy Bypass -File D:\kidney\app\backup.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName "kidney-backup" -Action $action -Trigger $trigger `
  -RunLevel Highest -User "SYSTEM"
```

> `.env` 裡有 JWT 金鑰，**這份備份也要當機密資料保管**。

### 6.3 異地備份

醫院多半不允許把資料傳到院外雲端。可行的做法：

- 一顆**加密的外接硬碟**（BitLocker To Go），每週帶去醫院同步一次、放在實驗室
- 或請資訊室給一個院內的網路磁碟機當第二份

無論哪種，**檔案要加密**。研究資料外洩的責任是你和指導教授的。

### 6.4 每個月實際還原一次

沒有驗證過的備份不算備份。SQLite 的好處是這件事很容易做——備份檔本身就是一個完整的
資料庫，拿到開發機上直接開就好：

```powershell
# 在開發機上，把備份檔當成資料庫開起來看
cd backend
$env:DATABASE_URL = "file:E:/kidney-backup/20261101/kidney.db"
npx prisma studio
```

確認：使用者數、用餐紀錄數跟你預期的一致，隨便挑三筆紀錄，
確認對應的照片檔案在 `uploads` 那份備份裡也找得到。

---

## 七、可能發生的狀況與處理

### 7.1 最常見的那一個：「無法連線到伺服器」

這句話是前端對所有「連不上」的統稱，背後至少有六個不同的原因。**照這個順序查**：

| 先測這個 | 結果 | 代表 |
|---|---|---|
| 電腦上 `docker compose -f docker-compose.prod.yml ps` | 容器不在 running | 看 `logs backend` / `logs caddy` |
| 電腦上 `curl.exe -k https://localhost/api/health` | 失敗 | Caddy 或後端的問題 → 看 log |
| 手機瀏覽器開 `http://<SERVER_NAME>:8080/` | 開不了 | 網路不通：用戶端隔離、VLAN、或防火牆（3.10） |
| 手機瀏覽器開 `https://<SERVER_NAME>/api/health` | 憑證警告但按「繼續」後看得到 `{"ok":true}` | 網路通、服務正常，**問題在 App 的憑證信任**（瀏覽器不認得那張 CA 是正常的，App 應該要認得） |
| `chrome://inspect` 看 console | `ERR_CLEARTEXT_NOT_PERMITTED` | 4.1 沒做，或 App 連的是 http 網址 |
| 同上 | `ERR_CERT_AUTHORITY_INVALID` | CA 沒打包進 APK、`root.crt` 放錯位置、或檔名有大寫 |
| 同上 | `ERR_NAME_NOT_RESOLVED` | 手機解析不到那個名稱，院內 DNS 沒設定 → 先改用 IP 驗證 |
| 後端 log 出現「不允許的來源：...」 | | CORS。Capacitor 的 `https://localhost` 已內建放行，會看到這行通常是你用瀏覽器開後台 → 把那個網址加進 `CORS_ORIGIN` |

### 7.2 其他狀況

```powershell
# 看 log（排查任何問題的第一步）
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f caddy
```

| 症狀 | 可能原因 | 怎麼確認 | 處理 |
|---|---|---|---|
| **某天早上全部病人都上傳失敗** | 電腦半夜重開，Docker Desktop 沒自動啟動 | 工作列有沒有鯨魚圖示；`docker compose ps` | 3.3 的兩個設定。這就是為什麼 5.1 要做「重開機不登入」的測試 |
| **同上，但容器都 running** | 電腦的 IP 變了 | `ipconfig` 比對 APK 裡寫死的位址 | 要固定 IP 或院內 DNS。只能用 IP 的話，每次開工先確認 |
| **容器一直重啟** | `.env` 沒填完整 | `logs backend` 會看到 `Missing required env var` | 對照 3.6 的表 |
| **病人回診時發現被登出** | refresh token 過期 | log 裡的 401 | `JWT_REFRESH_EXPIRES_IN` 要大於回診間隔，預設一年（3.6）。⚠ 改了只對**之後的登入**生效，已經發出去的憑證不會延長 |
| **病人說「我記錄了很多但你那邊沒有」** | 他回診時沒連 Wi-Fi，或沒打開 App 等它傳完 | App 首頁的待上傳筆數 | 收案 SOP：每次回診衛教師確認歸零。**這是這個方案最大的資料流失來源** |
| **照片上傳回「無法解析這張圖片」** | sharp 解不開檔案 | `logs backend` | Android 端已經把照片壓成 JPEG 才上傳，理論上不會發生；真的遇到，請把那張原始檔留下來 |
| **上傳很慢（一張要十幾秒）** | 防毒即時掃描、或 Wi-Fi 訊號弱 | 工作管理員看磁碟使用率 | 3.11 的排除清單 |
| **API 回 500，但 TypeScript 編譯沒問題** | 改了 schema 之後忘了重建 image | `logs backend` | `docker compose -f docker-compose.prod.yml up -d --build` |
| **一個徽章都發不出來** | 3.7 的 seed 忘了跑 | `exec backend npm run seed` 再跑一次（可重複執行） | — |
| **連續天數 / 今日全勤算錯** | 伺服器時間或時區不對 | `w32tm /query /status`、`Get-Date` | 3.4 的設定 |
| **磁碟滿了** | 照片 + log + 備份 | `Get-PSDrive D`；`docker system df` | 30 人 3 個月的照片約 3GB，資料庫只有幾十 MB。保持 50GB 以上可用空間，備份放別顆硬碟 |
| **資料庫損毀** | 突然斷電 | 後端起不來，log 說 `database disk image is malformed` | 從最近一次備份還原（6.4）。這就是 UPS 的用途 |
| **某次重開後整台機器回到原狀、程式都不見了** | 還原卡 / Deep Freeze | 問資訊室 | 這台機器不能用。第一節第五個問題就是在防這個 |

### 7.3 要怎麼知道服務掛了

院內機器連不到外網的話，UptimeRobot 這類外部監測用不了。替代做法：

- **最低限度**：請衛教師每天上班時用手機開一下 App，看得到首頁就代表活著
- **好一點**：那台電腦上設一個排程，`/api/health` 失敗就自動重啟並寫進 log

```powershell
# D:\kidney\watchdog.ps1 — 工作排程器設每 10 分鐘執行一次
try {
    $r = Invoke-RestMethod "https://localhost/api/health" -SkipCertificateCheck -TimeoutSec 10
    if (-not $r.ok) { throw "health not ok" }
} catch {
    Add-Content "D:\kidney\watchdog.log" "$(Get-Date -Format s) restart: $_"
    docker compose -f D:\kidney\app\docker-compose.prod.yml restart backend
}
```

> `-SkipCertificateCheck` 需要 PowerShell 7。Windows 內建的 5.1 沒有這個參數，
> 改用 `curl.exe -k -f https://localhost/api/health` 判斷結束代碼。

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

**清庫重來**，把測試階段的痕跡清乾淨。SQLite 的話就是把那個檔案刪掉讓它重建：

```powershell
cd D:\kidney\app
docker compose -f docker-compose.prod.yml down

# 刪掉資料庫與照片的 volume（⚠ 不要連 caddy_data 一起刪，那裡面是 CA）
docker volume rm app_db_data app_uploads_data

# 換掉兩組 JWT 金鑰（測試期間它們可能出現在截圖、報告、跟同學的對話裡）
notepad .env

docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec backend npm run seed
```

> volume 的名稱前綴是資料夾名稱，用 `docker volume ls` 確認實際名稱。
> **`caddy_data` 千萬不要刪**——理由見 3.9。

### 8.3 還沒做完、但收案前必須完成的程式面項目

這幾項在 [DEPLOY.md 的「正式收案前必須完成」](./DEPLOY.md) 有完整說明，這裡只列清單：

- [ ] **EXIF 拍攝時間**（`exifCapturedAt` + `captureSource`）— 否則從相簿選的照片時間不可信，
      而你的研究要談用餐時長。⚠ 必須在壓縮之前讀取，壓縮會把 EXIF 移除
- [ ] `participantCode` 假名化欄位
- [ ] 同意書欄位 `consentedAt` / `consentVersion` / `withdrawnAt`
- [ ] 幫衛教師開好 `RESEARCHER` 帳號（3.8）

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

`.env` 的 `SERVER_NAME` 填 `192.168.137.1`，`.env.production` 填
`https://192.168.137.1/api`。Caddy 的 `tls internal` 對 IP 一樣會簽憑證。

> 要先確認那台電腦有 Wi-Fi 網卡、而且 GPO 沒有禁止建立熱點。
> 另外**不要自己插一台無線 AP 到院內網路**——那在多數醫院是明文禁止的行為。

### 9.2 換一台專用機

跟實驗室或教授申請一台小主機（迷你 PC 約 NT$8,000），放在衛教室，
不走醫院的公用電腦。這樣就沒有還原卡、GPO、別人關機的問題，
但網路問題還是要資訊室協助。**順帶解決 Docker Desktop 的授權問題**：
自己的機器可以裝 Linux 跑免授權費的 Docker Engine。

### 9.3 回去用方案 A（雲端）

[DEPLOY.md](./DEPLOY.md) 還在。病人可以在家隨時上傳，資料流失風險最低，
但資料在境外，IRB 可能有意見——這正是
[MEETING_0930.md 5.1](./MEETING_0930.md) 那個還沒決定的問題。

> ⚠ 資料庫改成 SQLite 之後，**Render 免費方案的檔案系統是 ephemeral，重啟就清空**。
> 真要走這條路得加掛 Persistent Disk（付費），或那條路改回 PostgreSQL。
> `render.yaml` 和 DEPLOY.md 裡都有警告。

### 9.4 混合：主機在雲端、備份在院內

主機放雲端，每週把備份檔加密後存到醫院/實驗室的機器。
兩邊的優點都拿到一些，但境外傳輸的問題沒有解決。

---

## 十、一句話總結這份手冊

**技術上最容易卡住的是 3.9 / 4.1（HTTPS 與憑證），因為錯誤訊息會騙你——
App 只會說「無法連線到伺服器」，真正的原因要接 `chrome://inspect` 才看得到；
流程上最容易出事的是「病人的資料一直留在手機裡沒上傳」，因為它不會報錯。
而最該今天就去做的，是第一節跟資訊室談、第二節帶手機去測連線——
那兩件事決定這個方案到底成不成立，而且不需要寫任何程式。**
