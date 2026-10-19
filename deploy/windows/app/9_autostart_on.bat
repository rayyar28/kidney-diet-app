@echo off
rem Start the backend automatically when this Windows user logs in. No administrator needed.
rem Use only after long-term operation has been approved.
call "%~dp0_common.bat" || goto :end
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\kidney-diet-backend.bat" echo @echo off
>>"%STARTUP%\kidney-diet-backend.bat" echo rem Starts the kidney-diet backend at logon. Remove with 9b_autostart_off.bat
>>"%STARTUP%\kidney-diet-backend.bat" echo start "kidney-diet backend" /min cmd /c ""%APP%\5_run.bat""
if errorlevel 1 (
  echo [ERROR] Could not write to the Startup folder.
) else (
  echo [OK] The backend will start, minimized, every time this Windows user logs in.
  echo      It does NOT start until someone logs in after a reboot.
  echo      Do not close the minimized "kidney-diet backend" window in the taskbar.
)
:end
echo.
pause
