@echo off
setlocal
REM Double-click from Explorer to start without typing npm start (requires Node/npm on PATH).
cd /d "%~dp0"
for %%I in ("%~dp0..") do set "HEIGEN_MONOREPO_ROOT=%%~fI"
call npm start
if errorlevel 1 pause
