@echo off
setlocal EnableExtensions

REM Launch all local Heigen Studio services in separate windows.
cd /d "%~dp0"
set "ROOT=%CD%"
set "PYTHON=%ROOT%\Snaplytics\.venv\Scripts\python.exe"

if not exist "%PYTHON%" (
    echo Backend environment not found or is broken. Run install-windows.bat to repair it.
    pause
    exit /b 1
)
if not exist "%ROOT%\electron-app\node_modules" (
    echo Electron dependencies not found. Run install-windows.bat first.
    pause
    exit /b 1
)
if not exist "%ROOT%\HeigenKiosk\node_modules" (
    echo Kiosk dependencies not found. Run install-windows.bat to repair them.
    pause
    exit /b 1
)

for %%P in (8000 8090) do (
    netstat -ano | findstr /r /c:":%%P .*LISTENING" >nul
    if not errorlevel 1 (
        echo WARNING: Port %%P is already in use. Close the existing service or choose another port.
    )
)

start "Heigen Backend" cmd /k "cd /d ""%ROOT%\Snaplytics"" && ""%PYTHON%"" manage.py runserver 8000"
timeout /t 3 /nobreak >nul
start "Heigen Kiosk" cmd /k "cd /d ""%ROOT%\HeigenKiosk"" && call npm start"
start "Heigen Admin" cmd /k "set HEIGEN_SKIP_DJANGO=1&& cd /d ""%ROOT%\electron-app"" && call npm start"

echo Backend, kiosk, and Electron windows are starting.
echo Backend: http://localhost:8000
echo Kiosk:   http://localhost:8090
echo Close the three service windows to stop the local apps.
exit /b 0
