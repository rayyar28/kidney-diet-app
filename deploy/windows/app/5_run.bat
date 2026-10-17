@echo off
rem Start the backend. Keep this window open: closing it stops the backend.
title kidney-diet backend
call "%~dp0_common.bat" || goto :failed
"%NODE%" "%APP%\tools\run.mjs"
if errorlevel 1 goto :failed
goto :eof
:failed
echo.
echo The backend stopped with an error. See the message above,
echo or the log files in %KIDNEY_HOME%\logs
pause
