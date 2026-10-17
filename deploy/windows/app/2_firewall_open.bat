@echo off
rem Allow inbound TCP on the backend port, ONLY from the patient Wi-Fi subnet, ONLY for the bundled node.exe.
rem Needs "Run as administrator". Use only after the hospital IT office has approved the connection.
call "%~dp0_common.bat" || goto :end
net session >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Administrator rights required.
  echo         Right-click 2_firewall_open.bat and choose "Run as administrator".
  goto :end
)
if "%~1"=="" (
  echo Usage: 2_firewall_open.bat PATIENT_WIFI_SUBNET
  echo   e.g. 2_firewall_open.bat 10.20.0.0/16
  echo The subnet is the patient/guest Wi-Fi range approved by the IT office.
  goto :end
)
if /i "%~1"=="any" (
  echo [ERROR] "any" is refused on purpose. Only the patient Wi-Fi subnet should reach this port.
  goto :end
)
rem The first time the backend starts, Windows asks "Allow node.js to access the network?".
rem A non-administrator cannot allow it, so Windows silently adds BLOCK rules for node.exe,
rem and a block rule always wins over an allow rule. Remove every inbound rule for OUR node.exe first.
netsh advfirewall firewall delete rule name=all dir=in program="%NODE%" >nul 2>&1
netsh advfirewall firewall delete rule name="kidney-diet-backend" >nul 2>&1
netsh advfirewall firewall add rule name="kidney-diet-backend" dir=in action=allow protocol=TCP localport=%PORT% remoteip=%~1 program="%NODE%" profile=any enable=yes
if errorlevel 1 (
  echo [ERROR] Could not add the firewall rule.
) else (
  echo [OK] Inbound TCP %PORT% from %~1 is allowed, for %NODE% only.
  echo      Any old BLOCK rules for this node.exe were removed first.
  echo      If they ever come back, run this script again. 1_check_env.bat detects them.
)
:end
echo.
pause
