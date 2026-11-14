<#
.SYNOPSIS
    Installs Node.js LTS or Python 3.12 for Heigen Studio.

.DESCRIPTION
    Called by install-windows.bat when Node.js or Python is missing or too old.
    1. Uses winget when it is available.
    2. Otherwise downloads the official installer from nodejs.org or
       python.org, checks it, and installs it silently.
    If both fail, prints the manual download link and exits with code 1.

    Node.js: the kiosk (Expo SDK 58, React Native 0.88) needs 22.13+ or 24.3+.
    The newest LTS release that meets this is installed machine-wide (MSI,
    one administrator prompt), which also replaces an older Node.js install.

    Python: 3.12.10 is installed for the current user (no administrator
    rights needed) and added to the user PATH.

.PARAMETER Runtime
    node or python.

.PARAMETER ResultFile
    On success, the folder that holds node.exe / python.exe is written here.

.PARAMETER LogFile
    Optional log file to append to (install.log).

.PARAMETER DownloadOnly
    Download and verify the installer, but do not install. For testing.
#>
param(
    [Parameter(Mandatory = $true)][ValidateSet('node', 'python')][string]$Runtime,
    [string]$ResultFile,
    [string]$LogFile,
    [switch]$DownloadOnly
)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest is very slow in Windows PowerShell 5.1 while it draws progress.
$ProgressPreference = 'SilentlyContinue'
# Older Windows PowerShell defaults to TLS 1.0, which nodejs.org and python.org refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$PythonVersion = '3.12.10'
$NodeManualUrl = 'https://nodejs.org/en/download'
$PythonManualUrl = "https://www.python.org/downloads/release/python-$($PythonVersion.Replace('.', ''))/"

function Write-Step {
    param([string]$Message)
    Write-Host $Message
    if ($LogFile) {
        try { Add-Content -Path $LogFile -Value "[install-runtime] $Message" } catch {}
    }
}

function Get-Arch {
    switch ($env:PROCESSOR_ARCHITECTURE) {
        'ARM64' { return 'arm64' }
        'x86' {
            if ($env:PROCESSOR_ARCHITEW6432 -eq 'AMD64') { return 'x64' }
            return 'x86'
        }
        default { return 'x64' }
    }
}

# Same rule as the "engines" field of expo, react-native, and metro.
function Test-NodeVersion {
    param([string]$Version)
    $parts = $Version.TrimStart('v').Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    return ($major -eq 22 -and $minor -ge 13) -or ($major -eq 24 -and $minor -ge 3) -or ($major -ge 26)
}

function Get-NodeVersionAt {
    param([string]$Exe)
    if (-not (Test-Path $Exe)) { return $null }
    try { return (& $Exe --version 2>$null | Select-Object -First 1).Trim() } catch { return $null }
}

function Save-Download {
    param([string]$Url, [string]$Path)
    Write-Step "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing
}

function Assert-Signed {
    param([string]$Path, [string]$Publisher)
    $signature = Get-AuthenticodeSignature -FilePath $Path
    if ($signature.Status -ne 'Valid') {
        throw "The downloaded installer is not validly signed (status: $($signature.Status))."
    }
    $subject = [string]$signature.SignerCertificate.Subject
    if ($subject -notmatch [regex]::Escape($Publisher)) {
        throw "The downloaded installer is signed by an unexpected publisher: $subject"
    }
    Write-Step "Signature OK: $subject"
}

function Write-Result {
    param([string]$Folder)
    if ($ResultFile) { Set-Content -Path $ResultFile -Value $Folder -Encoding ASCII }
}

function Find-PythonFolder {
    $candidates = @(
        (Join-Path $env:LocalAppData 'Programs\Python\Python312'),
        (Join-Path $env:LocalAppData 'Programs\Python\Python312-arm64'),
        (Join-Path $env:LocalAppData 'Programs\Python\Python312-32'),
        (Join-Path $env:ProgramFiles 'Python312'),
        (Join-Path $env:ProgramFiles 'Python312-arm64')
    )
    foreach ($folder in $candidates) {
        if (Test-Path (Join-Path $folder 'python.exe')) { return $folder }
    }
    return $null
}

function Install-WithWinget {
    param([string]$Id)
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Step 'winget is not available. Using the official installer instead.'
        return $false
    }
    Write-Step "Installing $Id with winget..."
    & winget install --id $Id --exact --silent --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Step "winget could not install $Id (exit code $LASTEXITCODE). Using the official installer instead."
        return $false
    }
    return $true
}

function Install-Node {
    $nodeFolder = Join-Path $env:ProgramFiles 'nodejs'
    $nodeExe = Join-Path $nodeFolder 'node.exe'

    if (-not $DownloadOnly -and (Install-WithWinget 'OpenJS.NodeJS.LTS')) {
        $version = Get-NodeVersionAt $nodeExe
        if ($version -and (Test-NodeVersion $version)) {
            Write-Step "Node.js $version installed."
            Write-Result $nodeFolder
            return
        }
        Write-Step "winget finished, but Node.js 22.13+ is still not installed (found: $version). Using the official installer instead."
    }

    $arch = Get-Arch
    $fileKey = "win-$arch-msi"
    Write-Step 'Looking up the newest Node.js LTS release...'
    $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $release = $releases | Where-Object {
        $_.lts -and ($_.files -contains $fileKey) -and (Test-NodeVersion $_.version)
    } | Select-Object -First 1
    if (-not $release) { throw "No Node.js LTS release with a $arch Windows installer meets 22.13+." }

    $version = $release.version
    $fileName = "node-$version-$arch.msi"
    $baseUrl = "https://nodejs.org/dist/$version"
    $msi = Join-Path $env:TEMP $fileName
    Save-Download "$baseUrl/$fileName" $msi

    # nodejs.org publishes a SHA-256 for every file of a release.
    $sums = (Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -UseBasicParsing).Content
    $expected = ($sums -split "`n" | Where-Object { $_ -match "\s$([regex]::Escape($fileName))\s*$" } |
        Select-Object -First 1) -replace '\s.*$', ''
    $actual = (Get-FileHash -Path $msi -Algorithm SHA256).Hash
    if (-not $expected -or $actual -ne $expected.ToUpper()) {
        throw "Checksum mismatch for $fileName."
    }
    Write-Step "Checksum OK: $fileName"
    Assert-Signed $msi 'OpenJS Foundation'

    if ($DownloadOnly) {
        Write-Step "Download only: $msi"
        return
    }

    Write-Step "Installing Node.js $version. Windows will ask for administrator permission."
    try {
        $process = Start-Process -FilePath 'msiexec.exe' `
            -ArgumentList @('/i', "`"$msi`"", '/qn', '/norestart') `
            -Verb RunAs -Wait -PassThru
    } catch {
        throw 'Administrator permission was not granted, so Node.js was not installed.'
    }
    # 3010 = installed, restart recommended.
    if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
        throw "The Node.js installer failed (exit code $($process.ExitCode))."
    }
    Remove-Item $msi -ErrorAction SilentlyContinue

    $installed = Get-NodeVersionAt $nodeExe
    if (-not $installed -or -not (Test-NodeVersion $installed)) {
        throw "Node.js was installed, but $nodeExe reports version '$installed'."
    }
    Write-Step "Node.js $installed installed."
    Write-Result $nodeFolder
}

function Install-Python {
    if (-not $DownloadOnly -and (Install-WithWinget 'Python.Python.3.12')) {
        $folder = Find-PythonFolder
        if ($folder) {
            Write-Step "Python installed in $folder."
            Write-Result $folder
            return
        }
        Write-Step 'winget finished, but python.exe was not found. Using the official installer instead.'
    }

    $suffix = switch (Get-Arch) { 'arm64' { '-arm64' } 'x86' { '' } default { '-amd64' } }
    $fileName = "python-$PythonVersion$suffix.exe"
    $installer = Join-Path $env:TEMP $fileName
    Save-Download "https://www.python.org/ftp/python/$PythonVersion/$fileName" $installer
    Assert-Signed $installer 'Python Software Foundation'

    if ($DownloadOnly) {
        Write-Step "Download only: $installer"
        return
    }

    Write-Step "Installing Python $PythonVersion for the current user..."
    $process = Start-Process -FilePath $installer -Wait -PassThru -ArgumentList @(
        '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0',
        'Include_launcher=1', 'InstallLauncherAllUsers=0'
    )
    if ($process.ExitCode -ne 0) {
        throw "The Python installer failed (exit code $($process.ExitCode))."
    }
    Remove-Item $installer -ErrorAction SilentlyContinue

    $folder = Find-PythonFolder
    if (-not $folder) { throw 'Python was installed, but python.exe was not found.' }
    Write-Step "Python $PythonVersion installed in $folder."
    Write-Result $folder
}

try {
    if ($Runtime -eq 'node') { Install-Node } else { Install-Python }
    exit 0
} catch {
    Write-Step "ERROR: $($_.Exception.Message)"
    Write-Host ''
    if ($Runtime -eq 'node') {
        Write-Host 'Install the current Node.js LTS manually (22.13 or newer), then run the installer again:'
        Write-Host $NodeManualUrl
    } else {
        Write-Host "Install Python $PythonVersion manually, then run the installer again:"
        Write-Host 'Tick "Add python.exe to PATH" on the first installer screen.'
        Write-Host $PythonManualUrl
    }
    exit 1
}
