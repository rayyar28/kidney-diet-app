@echo off
rem End-to-end test against the running backend, verifying the certificate with certs\ca.crt.
rem   7_smoke_test.bat            use the address and port from the config file
rem   7_smoke_test.bat IP PORT    same usage as the hospital's own 7_smoke_test.bat
call "%~dp0_common.bat" || goto :end
"%NODE%" "%APP%\tools\smoke-test.mjs" %*
:end
echo.
pause
