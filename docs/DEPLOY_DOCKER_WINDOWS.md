# 最精簡部署：Windows + GitHub + Docker

只用 GitHub 和 Docker 部署到一台 Windows 電腦。完整版（為什麼這樣做、各種狀況怎麼處理）
看 [DEPLOY_HOSPITAL.md](./DEPLOY_HOSPITAL.md)；這份只有要打的指令。

需要的檔案 `docker-compose.prod.yml`、`Caddyfile`、`.env.example` 都已經在 repo 裡。

---

## 0. 前置（只做一次，要系統管理員）

1. 裝 [Git for Windows](https://git-scm.com/download/win)
2. 裝 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，安裝時勾 **WSL 2**
3. Docker Desktop → Settings → General → 勾 **Start Docker Desktop when you sign in**
4. `netplwiz` → 取消「必須輸入使用者名稱和密碼」→ 設定自動登入

> 第 3、4 步是為了「半夜 Windows 更新重開之後，服務會自己回來」。
> Docker Desktop 是桌面程式，沒有人登入它不會啟動——這是 Windows 版 Docker 唯一比較彆扭的地方。
>
> ⚠ Docker Desktop 對「員工 250 人以上或年營收 1000 萬美元以上」的組織要付費訂閱。
> 醫院一定超過，裝之前先跟資訊室確認。

---

## 1. 取得程式碼

```powershell
mkdir D:\kidney
cd D:\kidney
git clone https://github.com/rayyar28/kidney-diet-app.git app
cd app
```

> 路徑不要有中文。

---

## 2. 建立 `.env`

```powershell
copy .env.example .env
notepad .env
```

三組密鑰各產一次（沒裝 Node 也沒關係，用 Docker 跑）：

```powershell
docker run --rm node:20-alpine node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`SERVER_NAME` 和 `CORS_ORIGIN` 填這台機器對外的名稱或 IP，例如 `192.168.1.50`。
**這個值會寫死進病人的 APK，之後不能改**，先確定它不會變（固定 IP 或院內 DNS）。

---

## 3. 啟動

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

第一次約 3–5 分鐘。資料表會由容器自己 `prisma migrate deploy` 建好。

徽章資料要手動灌一次（不跑的話遊戲化會正常運作但一個徽章都發不出來，而且不會報錯）：

```powershell
docker compose -f docker-compose.prod.yml exec backend npx tsx prisma/seed.ts
```

確認活著：

```powershell
docker compose -f docker-compose.prod.yml ps
curl.exe -k https://localhost/api/health      # 應該回 {"ok":true}
```

---

## 4. 防火牆

```powershell
# 443 給 App；RemoteAddress 換成病人 Wi-Fi 實際的網段
New-NetFirewallRule -DisplayName "Kidney HTTPS" -Direction Inbound -Protocol TCP `
  -LocalPort 443 -RemoteAddress 192.168.1.0/24 -Action Allow
# 8080 給病人下載 APK，發完 App 就可以 Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "Kidney APK" -Direction Inbound -Protocol TCP `
  -LocalPort 8080 -RemoteAddress 192.168.1.0/24 -Action Allow
```

`db` 和 `backend` 在 compose 裡沒有開 port，不需要也不應該開 5432 / 4000。

---

## 5. 把 Caddy 的根憑證打包進 APK

Caddy 用 `tls internal` 自己簽了憑證。Android 預設封鎖明文 http，也不認得這張自簽憑證，
**不做這一步，App 會一直顯示「無法連線到伺服器」**（真正的錯誤是
`ERR_CLEARTEXT_NOT_PERMITTED` 或 `ERR_CERT_AUTHORITY_INVALID`，畫面上看不到）。

把根憑證抓出來：

```powershell
docker compose -f docker-compose.prod.yml cp `
  caddy:/data/caddy/pki/authorities/local/root.crt D:\kidney\root.crt
```

在**開發機**上：

1. 複製成 `frontend/android/app/src/main/res/raw/hospital_ca.pem`（檔名只能小寫英數底線）
2. 新增 `frontend/android/app/src/main/res/xml/network_security_config.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="@raw/hospital_ca" />
        </trust-anchors>
    </base-config>
</network-security-config>
```

3. `AndroidManifest.xml` 的 `<application>` 加上
   `android:networkSecurityConfig="@xml/network_security_config"`
4. `frontend/.env.production` 填 `VITE_API_BASE_URL=https://<SERVER_NAME>/api`（結尾要有 `/api`）
5. 建置（路徑含中文會失敗，從目錄連結跑）：

```powershell
cd D:\kidney-build\frontend
npm run build
npx cap copy android
cd android
.\gradlew.bat assembleRelease
```

6. 把 APK 放到伺服器的 `D:\kidney\app\public\app.apk`，病人用手機開
   `http://<SERVER_NAME>:8080/app.apk` 下載

> ⚠ **不要刪掉 `caddy_data` 這個 volume**，裡面是那張 CA。刪了等於換一張憑證，
> 已經裝在病人手機上的 App 會全部連不上，而且只能重新打包 APK、請 30 位病人重裝。

---

## 6. 備份（`backup.ps1`，用工作排程器設每天凌晨跑）

```powershell
.\backup.ps1
```

每個月實際還原一次確認備份能用。沒驗證過的備份不算備份。

---

## 常用指令

```powershell
cd D:\kidney\app

docker compose -f docker-compose.prod.yml ps          # 看狀態
docker compose -f docker-compose.prod.yml logs -f backend   # 看後端 log
docker compose -f docker-compose.prod.yml restart backend   # 重啟
docker compose -f docker-compose.prod.yml down        # 停（資料在 volume 裡，不會掉）

# 更新到最新版本
git pull
docker compose -f docker-compose.prod.yml up -d --build

# 開衛教師帳號（要先註冊過那個 email）
docker compose -f docker-compose.prod.yml exec backend npm run grant-role -- nurse@hospital.tw RESEARCHER

# 直接看資料
docker compose -f docker-compose.prod.yml exec db psql -U kidney_app -d kidney_diet
```

## 出事了先看這三個

| 症狀 | 先做這個 |
|---|---|
| App 說「無法連線到伺服器」 | 手機瀏覽器開 `http://<SERVER_NAME>:8080/`。開得了 → 網路沒問題，是第 5 步的憑證；開不了 → 防火牆或 Wi-Fi 用戶端隔離 |
| 容器一直重啟 | `docker compose -f docker-compose.prod.yml logs backend`。最常見是 `.env` 沒填或密碼含特殊字元 |
| 重開機後連不上 | Docker Desktop 有沒有啟動（工作列有沒有鯨魚圖示）。沒有 → 第 0 步的第 3、4 項沒設好 |

更完整的故障排除表在 [DEPLOY_HOSPITAL.md 第七節](./DEPLOY_HOSPITAL.md)。
