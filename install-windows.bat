@echo off
setlocal EnableExtensions

REM One-click setup for the Django backend, Expo kiosk, and Electron admin app.
cd /d "%~dp0"
set "ROOT=%CD%"
set "BACKEND=%ROOT%\Snaplytics"
set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"
set "LOG=%ROOT%\install.log"

echo.
echo === Heigen Studio one-click installation ===
echo.
echo Installation started %date% %time% > "%LOG%"
call :progress 5 "Checking repository"
echo [1/7] Checking repository files...

if not exist "%BACKEND%\manage.py" (
    echo ERROR: Backend folder is missing or the repository is incomplete.
    echo Expected: "%BACKEND%\manage.py"
    call :fail "Backend files are missing"
)
if not exist "%ROOT%\electron-app\package.json" (
    echo ERROR: Electron app files are missing.
    call :fail "Electron package.json is missing"
)
if not exist "%ROOT%\HeigenKiosk\package.json" (
    echo ERROR: Kiosk files are missing.
    call :fail "Kiosk package.json is missing"
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is missing. Attempting automatic installation with winget...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo.
        echo Install Node.js 20 LTS manually:
        echo https://nodejs.org/en/download
        call :fail "Node.js is missing and winget is unavailable."
    )
    winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-source-agreements --accept-package-agreements >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo.
        echo Install Node.js 20 LTS manually:
        echo https://nodejs.org/en/download
        call :fail "Automatic Node.js installation failed. See install.log."
    )
    call :refresh-node-path
    where node >nul 2>nul
    if errorlevel 1 (
        echo Node.js was installed, but this window cannot see the updated PATH.
        echo Close and reopen the installer once so Windows can refresh PATH.
        call :fail "Windows PATH has not refreshed yet"
    )
)

call :refresh-node-path
echo [2/7] Node.js detected.
call :progress 20 "Checking Node.js and npm"
where npm >nul 2>nul
if errorlevel 1 (
    echo.
    echo Install or repair Node.js 20 LTS:
    echo https://nodejs.org/en/download
    call :fail "npm is missing."
)
echo [3/7] npm detected.
node -e "const major=Number(process.versions.node.split('.')[0]); process.exit([18,19,20,21,22,23,24,25].includes(major) ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
    echo.
    echo Install Node.js 20 LTS:
    echo https://nodejs.org/en/download
    call :fail "Node.js 18+ is required."
)
call npm --version >nul 2>nul
if errorlevel 1 (
    echo.
    echo Repair or reinstall Node.js 20 LTS:
    echo https://nodejs.org/en/download
    call :fail "npm is not working."
)

set "PYTHON_LAUNCHER="
where python >nul 2>nul
if not errorlevel 1 (
    python -c "import sys; raise SystemExit(0 if sys.version_info[0] == 3 and sys.version_info[1] in range(11, 20) else 1)" >nul 2>nul
    if not errorlevel 1 set "PYTHON_LAUNCHER=python"
)

if not defined PYTHON_LAUNCHER (
    where py >nul 2>nul
    if not errorlevel 1 (
        py -3.12 -c "import sys" >nul 2>nul
        if not errorlevel 1 set "PYTHON_LAUNCHER=py -3.12"
    )
)

echo [4/7] Python launcher selected: %PYTHON_LAUNCHER%
call :progress 30 "Checking Python"
if not defined PYTHON_LAUNCHER (
    echo Python 3.11+ is missing. Attempting automatic installation with winget...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo.
        echo Install Python 3.12 manually:
        echo https://www.python.org/downloads/release/python-31210/
        call :fail "Python 3.11+ is missing and winget is unavailable."
    )
    winget install --id Python.Python.3.12 --exact --silent --accept-source-agreements --accept-package-agreements >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo.
        echo Install Python 3.12 manually:
        echo https://www.python.org/downloads/release/python-31210/
        call :fail "Automatic Python installation failed. See install.log."
    )
    call :refresh-python-path
    python -c "import sys" >nul 2>nul
    if errorlevel 1 (
        echo Python was installed, but this window cannot see the updated PATH.
        echo Close and reopen the installer once so Windows can refresh PATH.
        call :fail "Windows PATH has not refreshed yet"
    )
    set "PYTHON_LAUNCHER=python"
)

call :refresh-python-path
if exist "%PYTHON%" (
    "%PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info[0] == 3 and sys.version_info[1] in range(11, 20) else 1)" >nul 2>nul
    if errorlevel 1 (
        echo Existing virtual environment is broken or uses an unavailable Python.
        echo Recreating "%BACKEND%\.venv"...
        rmdir /s /q "%BACKEND%\.venv"
    )
)

if not exist "%PYTHON%" (
    echo Creating backend virtual environment...
    echo [5/7] Creating backend virtual environment...
    call :progress 40 "Creating Python environment"
    %PYTHON_LAUNCHER% -m venv "%BACKEND%\.venv" >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo ERROR: Python was found, but could not create the virtual environment.
        echo Selected interpreter: %PYTHON_LAUNCHER%
        goto :failed
    )
)

echo Installing backend dependencies...
echo [6/7] Installing backend dependencies...
call :progress 55 "Installing Python dependencies"
"%PYTHON%" -m pip install --upgrade pip >> "%LOG%" 2>&1
if errorlevel 1 goto :failed
"%PYTHON%" -m pip install -r "%BACKEND%\requirements.txt" >> "%LOG%" 2>&1
if errorlevel 1 goto :failed

echo Applying database migrations...
call :progress 68 "Applying database migrations"
pushd "%BACKEND%"
"%PYTHON%" manage.py migrate >> "%LOG%" 2>&1
if errorlevel 1 (
    popd
    goto :failed
)
popd

echo Installing Electron admin dependencies...
echo [7/7] Installing Electron and kiosk dependencies...
call :progress 78 "Installing staff app dependencies"
pushd "%ROOT%\electron-app"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 (
    echo npm install failed. Retrying after npm cache verification...
    call npm cache verify >> "%LOG%" 2>&1
    call npm install >> "%LOG%" 2>&1
)
if errorlevel 1 (
    popd
    goto :failed
)
popd

echo Installing kiosk dependencies...
call :progress 90 "Installing kiosk dependencies"
pushd "%ROOT%\HeigenKiosk"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 (
    echo npm install failed. Retrying after npm cache verification...
    call npm cache verify >> "%LOG%" 2>&1
    call npm install >> "%LOG%" 2>&1
)
if errorlevel 1 (
    popd
    goto :failed
)
popd

echo.
call :progress 100 "Installation complete"
echo Installation complete.
echo Run start-all-windows.bat to launch the backend, kiosk, and Electron app.
exit /b 0

:failed
echo.
echo ERROR: Installation failed. Review "%LOG%" for the complete diagnostic.
pause
exit /b 1

:fail
echo ERROR: %~1
echo ERROR: %~1 >> "%LOG%"
goto :failed

:progress
set "PROGRESS=%~1"
set "PROGRESS_LABEL=%~2"
set "BAR="
for /f "delims=" %%B in ('powershell.exe -NoProfile -Command "$n=[math]::Floor([int]$env:PROGRESS/5); ('#' * $n) + ('-' * (20-$n))"') do set "BAR=%%B"
echo.
echo [%BAR%] %PROGRESS%%% - %PROGRESS_LABEL%
exit /b 0

:refresh-node-path
set "NODE_EXE="
for /f "delims=" %%P in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%P"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if defined NODE_EXE (
    for %%P in ("%NODE_EXE%") do set "NODE_DIR=%%~dpP"
    set "PATH=%NODE_DIR%;%PATH%"
    call :persist-user-path "%NODE_DIR%"
)
exit /b 0

:refresh-python-path
set "PYTHON_EXE="
if defined PYTHON_LAUNCHER (
    for /f "delims=" %%P in ('%PYTHON_LAUNCHER% -c "import sys; print(sys.executable)" 2^>nul') do if not defined PYTHON_EXE set "PYTHON_EXE=%%P"
)
if not defined PYTHON_EXE if exist "%ProgramFiles%\Python312\python.exe" set "PYTHON_EXE=%ProgramFiles%\Python312\python.exe"
if not defined PYTHON_EXE if exist "%LocalAppData%\Programs\Python\Python312\python.exe" set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python312\python.exe"
if defined PYTHON_EXE (
    for %%P in ("%PYTHON_EXE%") do set "PYTHON_DIR=%%~dpP"
    set "PATH=%PYTHON_DIR%;%PATH%"
    call :persist-user-path "%PYTHON_DIR%"
)
exit /b 0

:persist-user-path
set "PATH_TO_ADD=%~1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$add=$env:PATH_TO_ADD.TrimEnd('\'); $old=[Environment]::GetEnvironmentVariable('Path','User'); $parts=@($old -split ';' | Where-Object { $_ }); if ($parts -notcontains $add -and (Test-Path $add)) { [Environment]::SetEnvironmentVariable('Path', (($parts + $add) -join ';'), 'User') }" >nul 2>>"%LOG%"
exit /b 0
