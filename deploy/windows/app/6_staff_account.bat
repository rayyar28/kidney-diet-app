@echo off
rem Manage accounts on this PC (there is no network API for this on purpose).
rem   6_staff_account.bat create-staff EMAIL PASSWORD [NAME]   create a nurse/researcher account
rem   6_staff_account.bat set-role ACCOUNT PATIENT^|RESEARCHER^|ADMIN
rem   6_staff_account.bat summary                             how many accounts and records
rem Patient accounts are NOT created here: nurses create them in the app.
rem Use letters and digits in passwords here; cmd treats % ^ & | < > as special characters.
call "%~dp0_common.bat" || goto :end
"%NODE%" "%APP%\tools\account.mjs" %*
:end
echo.
pause
