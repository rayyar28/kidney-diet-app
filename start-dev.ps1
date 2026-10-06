# 本機原生開發環境啟動腳本（不透過 Docker）
# 用法：在 PowerShell 裡執行 .\start-dev.ps1
# 會依序：啟動後端 -> 啟動前端
# 資料庫是 SQLite（backend/data/kidney.db），不需要啟動任何資料庫服務。

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# 確保這個 session 看得到 Node.js / npm
$machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:Path = "$machinePath;$userPath"

# 1. 啟動後端（新視窗）
# -ExecutionPolicy Bypass 是必要的：npm run dev 在 PowerShell 裡其實是執行
# npm.ps1，沒有這個參數，新開的視窗一樣會被「未經數位簽署」擋下來。
Write-Host "啟動後端 (http://localhost:4000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "cd '$root\backend'; npm run dev"

# 2. 啟動前端（新視窗）
Write-Host "啟動前端 (http://localhost:5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", "cd '$root\frontend'; npm run dev"

Write-Host ""
Write-Host "都啟動好了！瀏覽器打開 http://localhost:5173" -ForegroundColor Green
Write-Host "要停止：直接關掉跳出來的兩個 PowerShell 視窗就好。" -ForegroundColor Yellow
