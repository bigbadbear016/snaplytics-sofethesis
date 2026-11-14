@echo off
setlocal EnableExtensions

REM One-click setup for the Django backend, Expo kiosk, and Electron admin app.
REM Missing or too-old Node.js / Python are installed by tools\install-runtime.ps1:
REM winget when available, otherwise the official installer from nodejs.org / python.org.
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
    goto :failed
)
if not exist "%ROOT%\electron-app\package.json" (
    echo ERROR: Electron app files are missing.
    call :fail "Electron package.json is missing"
    goto :failed
)
if not exist "%ROOT%\HeigenKiosk\package.json" (
    echo ERROR: Kiosk files are missing.
    call :fail "Kiosk package.json is missing"
    goto :failed
)
if not exist "%ROOT%\tools\install-runtime.ps1" (
    echo ERROR: tools\install-runtime.ps1 is missing.
    call :fail "Runtime installer script is missing"
    goto :failed
)

REM Node.js: the kiosk (Expo SDK 58, React Native 0.88) needs 22.13+ or 24.3+.
call :progress 15 "Checking Node.js"
call :check-node
if not errorlevel 1 goto :node-ready
echo Node.js 22.13 or newer was not found. Installing the current Node.js LTS...
call :install-runtime node
if errorlevel 1 (
    call :fail "Node.js could not be installed. See the message above and install.log."
    goto :failed
)
call :check-node
if errorlevel 1 (
    echo Node.js was installed, but this window still finds a missing or older version.
    echo Close this window and run the installer again so Windows can refresh PATH.
    call :fail "Node.js 22.13 or newer is still not available"
    goto :failed
)
:node-ready
for /f "delims=" %%V in ('node --version') do echo [2/7] Node.js %%V detected.
call :progress 20 "Checking npm"
echo [3/7] npm detected.

REM Python: the backend uses 3.12 (numpy 1.26.4 has no wheels for 3.13+).
REM Python versions install side by side, so a newer Python on the PC stays.
call :progress 30 "Checking Python"
call :find-python
if not errorlevel 1 goto :python-ready
echo Python 3.12 was not found. Installing Python 3.12 alongside any other Python...
call :install-runtime python
if errorlevel 1 (
    call :fail "Python could not be installed. See the message above and install.log."
    goto :failed
)
call :find-python
if errorlevel 1 (
    echo Python was installed, but this window cannot find it yet.
    echo Close this window and run the installer again so Windows can refresh PATH.
    call :fail "Python 3.12 is still not available"
    goto :failed
)
:python-ready
echo [4/7] Python launcher selected: %PYTHON_LAUNCHER%

if exist "%PYTHON%" (
    "%PYTHON%" -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" >nul 2>nul
    if errorlevel 1 (
        echo Existing virtual environment is broken or does not use Python 3.12.
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

REM Prints and logs an error. The caller must "goto :failed" afterwards.
:fail
echo ERROR: %~1
echo ERROR: %~1 >> "%LOG%"
exit /b 0

:progress
set "PROGRESS=%~1"
set "PROGRESS_LABEL=%~2"
set "BAR="
for /f "delims=" %%B in ('powershell.exe -NoProfile -Command "$n=[math]::Floor([int]$env:PROGRESS/5); ('#' * $n) + ('-' * (20-$n))"') do set "BAR=%%B"
echo.
echo [%BAR%] %PROGRESS%%% - %PROGRESS_LABEL%
exit /b 0

REM Succeeds when a suitable node and npm are reachable. Tries PATH first, then
REM the standard install folder (a fresh install is not on this window's PATH yet).
:check-node
call :node-ok
if not errorlevel 1 exit /b 0
if not exist "%ProgramFiles%\nodejs\node.exe" exit /b 1
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :node-ok
exit /b %errorlevel%

REM Same version rule as the "engines" field of expo, react-native, and metro.
:node-ok
where node >nul 2>nul
if errorlevel 1 exit /b 1
node -e "const [a, b] = process.versions.node.split('.').map(Number); process.exit((a === 22 && b >= 13) || (a === 24 && b >= 3) || a >= 26 ? 0 : 1)" >nul 2>nul
if errorlevel 1 exit /b 1
call npm --version >nul 2>nul
if errorlevel 1 exit /b 1
exit /b 0

REM Sets PYTHON_LAUNCHER to a Python 3.12 interpreter, or fails. Newer versions
REM (3.13+) are skipped on purpose; see the Python section above.
:find-python
set "PYTHON_LAUNCHER="
call :python-ok py -3.12
if not errorlevel 1 (
    set "PYTHON_LAUNCHER=py -3.12"
    exit /b 0
)
call :python-ok python
if not errorlevel 1 (
    set "PYTHON_LAUNCHER=python"
    exit /b 0
)
for %%P in ("%LocalAppData%\Programs\Python\Python312" "%LocalAppData%\Programs\Python\Python312-arm64" "%LocalAppData%\Programs\Python\Python312-32" "%ProgramFiles%\Python312") do (
    if exist "%%~P\python.exe" call :python-ok "%%~P\python.exe"
    if exist "%%~P\python.exe" if not errorlevel 1 (
        set PYTHON_LAUNCHER="%%~P\python.exe"
        set "PATH=%%~P;%%~P\Scripts;%PATH%"
        exit /b 0
    )
)
exit /b 1

:python-ok
%* -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)" >nul 2>nul
if errorlevel 1 exit /b 1
exit /b 0

REM Installs node or python with tools\install-runtime.ps1, then puts the new
REM folder first on this window's PATH.
:install-runtime
set "RUNTIME_RESULT=%TEMP%\heigen-runtime-%RANDOM%.txt"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\tools\install-runtime.ps1" -Runtime %~1 -ResultFile "%RUNTIME_RESULT%" -LogFile "%LOG%"
if errorlevel 1 exit /b 1
set "RUNTIME_DIR="
if exist "%RUNTIME_RESULT%" set /p RUNTIME_DIR=<"%RUNTIME_RESULT%"
del "%RUNTIME_RESULT%" >nul 2>nul
if defined RUNTIME_DIR set "PATH=%RUNTIME_DIR%;%RUNTIME_DIR%\Scripts;%PATH%"
exit /b 0
