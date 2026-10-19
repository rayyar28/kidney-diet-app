@echo off
rem Stop starting the backend at logon (undo 9_autostart_on.bat).
set "ENTRY=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\kidney-diet-backend.bat"
if exist "%ENTRY%" (
  del "%ENTRY%"
  echo [OK] Autostart removed.
) else (
  echo [OK] Autostart was not enabled.
)
echo.
pause
