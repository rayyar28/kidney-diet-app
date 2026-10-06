# 每日備份。用工作排程器設定每天凌晨執行（「不論使用者是否登入均執行」+「以最高權限執行」）。
# 注意：主控台編碼是 MS950，這個腳本的輸出不要放 emoji，會 UnicodeEncodeError 直接中斷。
$ErrorActionPreference = "Stop"

$compose = "D:\kidney\app\docker-compose.prod.yml"
$date    = Get-Date -Format "yyyyMMdd"
$dest    = "E:\kidney-backup\$date"     # 另一顆實體硬碟，不是同一顆的別的分割區
New-Item -ItemType Directory -Force -Path $dest | Out-Null

# 1. 資料庫（SQLite）
# 不可以直接複製 /app/data/kidney.db：資料庫開著 WAL 模式，內容分散在 .db 與 .db-wal
# 兩個檔案，有人正在寫入時複製會拿到不完整的快照——而且要等到還原那天才會發現。
# VACUUM INTO 是 SQLite 內建的線上備份，會在交易保護下寫出一個乾淨、可直接使用的檔案。
docker compose -f $compose exec -T backend npm run backup:db -- /tmp/kidney.db
docker compose -f $compose cp backend:/tmp/kidney.db "$dest\kidney.db"
docker compose -f $compose exec -T backend rm /tmp/kidney.db

# 2. 照片（在 uploads volume 裡，不是 Windows 資料夾，所以要用容器打包出來）
# volume 名稱前綴是專案資料夾名稱，用 docker volume ls 確認
$vol = "app_uploads_data"
docker run --rm -v "${vol}:/data" -v "${dest}:/backup" alpine tar czf /backup/uploads.tar.gz -C /data .

# 3. 設定檔（.env 裡有 JWT 金鑰，這份備份也要當機密資料保管）
Copy-Item "D:\kidney\app\.env" "$dest\env.backup"

# 4. 只保留 30 天
Get-ChildItem "E:\kidney-backup" -Directory |
  Where-Object { $_.CreationTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Recurse -Force

Write-Output "backup done: $dest"
