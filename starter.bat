@echo off
setlocal
cd /d "%~dp0"
REM No arguments: open the Starter window. Or pass -StartAll / -StopAll / -Status, or -Start/-Stop backend, kiosk, staff, or ngrok.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0starter.ps1" %*
if errorlevel 1 pause
