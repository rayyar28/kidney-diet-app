@echo off
rem After testing: confirm the firewall rule, the running backend and autostart are all off.
call "%~dp0_common.bat" || goto :end
"%NODE%" "%APP%\tools\verify-closed.mjs"
:end
echo.
pause
