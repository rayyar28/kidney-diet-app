@echo off
rem Shared settings for the kidney-diet backend scripts. Called by the numbered scripts; do not run directly.
rem Keep this file ASCII-only: the console code page on the hospital PC is MS950 (Big5).
set "APP=%~dp0"
set "APP=%APP:~0,-1%"
for %%I in ("%APP%\..") do set "KIDNEY_HOME=%%~fI"
set "NODE=%APP%\node\node.exe"
set "CONFIG=%KIDNEY_HOME%\config\kidney.env"
set "PORT=9443"
if exist "%CONFIG%" for /f "usebackq tokens=1,* delims==" %%A in ("%CONFIG%") do if /i "%%A"=="PORT" set "PORT=%%B"
if not exist "%NODE%" (
  echo [ERROR] Bundled Node.js not found: %NODE%
  echo         The app folder is incomplete. Extract the release zip again.
  exit /b 1
)
exit /b 0
