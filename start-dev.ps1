# 本機原生開發環境啟動腳本（不透過 Docker）
# 用法：在 PowerShell 裡執行 .\start-dev.ps1
# 會依序：啟動本機 PostgreSQL 叢集 -> 啟動後端 -> 啟動前端

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pgBin = "C:\Program Files\PostgreSQL\17\bin"
$dataDir = Join-Path $root ".devdata\pgdata"
$pgLog = Join-Path $root ".devdata\pg.log"

# 確保這個 session 看得到 Node.js / npm
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

# 1. 啟動 PostgreSQL（如果還沒在跑）
$pgStatus = & "$pgBin\pg_ctl.exe" -D $dataDir status 2>&1
if ($pgStatus -match "no server running") {
    Write-Host "啟動 PostgreSQL..." -ForegroundColor Cyan
    & "$pgBin\pg_ctl.exe" -D $dataDir -l $pgLog -o "-p 5432" start
    Start-Sleep -Seconds 2
} else {
    Write-Host "PostgreSQL 已經在跑了" -ForegroundColor Green
}

# 2. 啟動後端（新視窗）
# -ExecutionPolicy Bypass 是必要的：npm run dev 在 PowerShell 裡其實是執行
# npm.ps1，沒有這個參數，新開的視窗一樣會被「未經數位簽署」擋下來。
Write-Host "啟動後端 (http://localhost:4000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "cd '$root\backend'; npm run dev"

# 3. 啟動前端（新視窗）
Write-Host "啟動前端 (http://localhost:5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "cd '$root\frontend'; npm run dev"

Write-Host ""
Write-Host "都啟動好了！瀏覽器打開 http://localhost:5173" -ForegroundColor Green
Write-Host "要停止：直接關掉跳出來的兩個 PowerShell 視窗；PostgreSQL 可以用" -ForegroundColor Yellow
Write-Host "  & `"$pgBin\pg_ctl.exe`" -D `"$dataDir`" stop" -ForegroundColor Yellow
