@echo off
setlocal
REM Stop all local Heigen Studio services (backend, kiosk, staff app) and close their windows.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0starter.ps1" -StopAll
if errorlevel 1 pause
