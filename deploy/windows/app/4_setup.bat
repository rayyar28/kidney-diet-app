@echo off
rem First-time setup, and run again after every update. Safe to repeat.
rem   4_setup.bat              detect this PC's IP automatically
rem   4_setup.bat 192.168.x.x  use this IP (when the PC has several network cards)
call "%~dp0_common.bat" || goto :end
"%NODE%" "%APP%\tools\setup.mjs" %*
:end
echo.
pause
