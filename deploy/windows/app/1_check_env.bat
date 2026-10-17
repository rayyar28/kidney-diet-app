@echo off
rem Check whether this PC is ready to run the backend. Read-only; no administrator needed.
call "%~dp0_common.bat" || goto :end
"%NODE%" "%APP%\tools\check-env.mjs"
:end
echo.
pause
