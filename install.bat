@echo off
setlocal
REM Install everything, then start the backend, kiosk, and staff app.
call "%~dp0install-windows.bat"
if errorlevel 1 exit /b 1
call "%~dp0start-all-windows.bat"
