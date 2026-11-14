@echo off
setlocal
REM Builds HeigenStarter.exe (backup launcher for starter.ps1) into the project root.
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
    echo C# compiler not found. .NET Framework 4.x is required.
    pause
    exit /b 1
)
"%CSC%" /nologo /target:winexe /optimize+ /out:"%~dp0..\..\HeigenStarter.exe" /reference:System.Windows.Forms.dll "%~dp0HeigenStarter.cs"
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)
echo Built HeigenStarter.exe in the project root.
