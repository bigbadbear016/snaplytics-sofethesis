@echo off
setlocal
REM Start the backend, kiosk, and staff app in separate windows (same as Start All in starter.bat).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0starter.ps1" -StartAll
if errorlevel 1 pause
