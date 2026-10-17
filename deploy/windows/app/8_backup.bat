@echo off
rem Back up the database and photos to the backups folder. Works while the backend is running.
rem The backup IS patient data: copy it to an encrypted external drive, not to a personal device.
call "%~dp0_common.bat" || goto :end
"%NODE%" "%APP%\tools\backup.mjs"
:end
echo.
pause
