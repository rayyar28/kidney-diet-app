@echo off
rem Remove the firewall rule added by 2_firewall_open.bat. Needs "Run as administrator".
call "%~dp0_common.bat" || goto :end
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Administrator rights required. Right-click and choose "Run as administrator".
  goto :end
)
netsh advfirewall firewall delete rule name="kidney-diet-backend"
if errorlevel 1 (echo [OK] There was no such rule.) else (echo [OK] Firewall rule removed.)
:end
echo.
pause
