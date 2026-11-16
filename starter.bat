@echo off
setlocal
cd /d "%~dp0"
REM No arguments: open the Starter window. Or pass -StartAll / -StopAll / -Status, or -Start/-Stop backend, kiosk, staff, or ngrok.
if "%~1"=="" (
    REM GUI only: run PowerShell hidden so no empty console stays open behind the Starter window.
    start "" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0starter.ps1"
    exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0starter.ps1" %*
if errorlevel 1 pause
