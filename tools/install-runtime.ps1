<#
.SYNOPSIS
    Installs Node.js or Python 3.12 for Heigen Studio.

.DESCRIPTION
    Called by install-windows.bat when a suitable Node.js or Python 3.12 is
    not found. Each install tries, in order:
    1. winget
    2. the official installer downloaded from nodejs.org or python.org,
       checked and installed silently
    3. if both fail, the direct download link is printed for a manual install,
       and the script exits with code 1.

    Node.js (the kiosk's Expo SDK 58 needs 22.13+, 24.3+, or 26+):
    - Missing or older than 22.20.0: installs the pinned 22.20.0
      (winget OpenJS.NodeJS.22).
    - Newer than 22.20.0 but unsupported (for example 23.x or 25.x): the
      Node.js installer cannot downgrade, so it upgrades to the newest LTS
      instead (winget OpenJS.NodeJS.LTS).
    Node.js installs machine-wide (MSI, one administrator prompt) and replaces
    the existing Node.js.

    Python: installs the pinned 3.12.10 for the current user (no administrator
    rights). Python versions install side by side, so any other Python on the
    PC (for example 3.13) is left as it is. The backend needs 3.12 because
    numpy 1.26.4 in requirements.txt has no wheels for 3.13 or newer.

.PARAMETER Runtime
    node or python.

.PARAMETER ResultFile
    On success, the folder that holds node.exe / python.exe is written here.

.PARAMETER LogFile
    Optional log file to append to (install.log).

.PARAMETER DownloadOnly
    Download and verify the installer, but do not install. For testing.

.PARAMETER ExistingNodeVersion
    Testing only: pretend this Node.js version is installed (for example 25.1.0).
#>
param(
    [Parameter(Mandatory = $true)][ValidateSet('node', 'python')][string]$Runtime,
    [string]$ResultFile,
    [string]$LogFile,
    [switch]$DownloadOnly,
    [string]$ExistingNodeVersion
)

$ErrorActionPreference = 'Stop'
# Invoke-WebRequest is very slow in Windows PowerShell 5.1 while it draws progress.
$ProgressPreference = 'SilentlyContinue'
# Older Windows PowerShell defaults to TLS 1.0, which nodejs.org and python.org refuse.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# Pinned versions. Change the version and the winget ID together.
$NodeVersion = '22.20.0'
$NodeWingetId = 'OpenJS.NodeJS.22'
$NodeLtsWingetId = 'OpenJS.NodeJS.LTS'
$PythonVersion = '3.12.10'
$PythonWingetId = 'Python.Python.3.12'

# Set when Node.js must move up to the newest LTS instead of the pinned version.
$script:NodeUpgradeMode = $false

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

function ConvertTo-Version {
    param([string]$Text)
    return [version]($Text.Trim().TrimStart('v'))
}

function Get-NodeFileName {
    param([string]$Version)
    return "node-v$Version-$(Get-Arch).msi"
}

function Get-NodeUrl {
    param([string]$Version)
    return "https://nodejs.org/dist/v$Version/$(Get-NodeFileName $Version)"
}

function Get-PythonFileName {
    $suffix = switch (Get-Arch) { 'arm64' { '-arm64' } 'x86' { '' } default { '-amd64' } }
    return "python-$PythonVersion$suffix.exe"
}

function Get-PythonUrl {
    return "https://www.python.org/ftp/python/$PythonVersion/$(Get-PythonFileName)"
}

# Same rule as the "engines" field of expo, react-native, and metro.
function Test-NodeVersion {
    param([string]$Version)
    $v = ConvertTo-Version $Version
    return ($v.Major -eq 22 -and $v.Minor -ge 13) -or ($v.Major -eq 24 -and $v.Minor -ge 3) -or ($v.Major -ge 26)
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
    param([string]$Id, [string]$Version)
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        Write-Step 'winget is not available. Downloading the installer directly instead.'
        return $false
    }
    $wingetArgs = @('install', '--id', $Id, '--exact', '--silent',
        '--accept-source-agreements', '--accept-package-agreements')
    $label = $Id
    if ($Version) {
        $wingetArgs += @('--version', $Version)
        $label = "$Id $Version"
    }
    Write-Step "Installing $label with winget..."
    & winget @wingetArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Step "winget could not install $label (exit code $LASTEXITCODE). Downloading the installer directly instead."
        return $false
    }
    return $true
}

# Downloads, verifies, and installs one Node.js MSI. Returns the installed version.
function Install-NodeMsi {
    param([string]$Version, [string]$NodeExe)
    $fileName = Get-NodeFileName $Version
    $msi = Join-Path $env:TEMP $fileName
    Save-Download (Get-NodeUrl $Version) $msi

    # nodejs.org publishes a SHA-256 for every file of a release.
    $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/v$Version/SHASUMS256.txt" -UseBasicParsing).Content
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
        return $null
    }

    Write-Step "Installing Node.js $Version. Windows will ask for administrator permission."
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

    $installed = Get-NodeVersionAt $NodeExe
    if (-not $installed -or -not (Test-NodeVersion $installed)) {
        throw "Node.js was installed, but $NodeExe reports version '$installed'."
    }
    return $installed
}

# Newest LTS release with a Windows MSI that meets the kiosk rule and is newer
# than $Existing (the Node.js installer cannot downgrade).
function Get-NewestNodeLts {
    param([string]$Existing)
    $fileKey = "win-$(Get-Arch)-msi"
    $minimum = ConvertTo-Version $Existing
    Write-Step 'Looking up the newest Node.js LTS release...'
    $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
    $release = $releases | Where-Object {
        $_.lts -and ($_.files -contains $fileKey) -and (Test-NodeVersion $_.version) -and
            ((ConvertTo-Version $_.version) -gt $minimum)
    } | Select-Object -First 1
    if (-not $release) { throw "No Node.js LTS release newer than $Existing has a Windows installer." }
    return $release.version.TrimStart('v')
}

function Install-Node {
    $nodeFolder = Join-Path $env:ProgramFiles 'nodejs'
    $nodeExe = Join-Path $nodeFolder 'node.exe'
    # The machine-wide install is the one an MSI would replace.
    $existing = if ($ExistingNodeVersion) { $ExistingNodeVersion } else { Get-NodeVersionAt $nodeExe }

    if ($existing -and (ConvertTo-Version $existing) -gt (ConvertTo-Version $NodeVersion)) {
        # Newer than the pin but unsupported, e.g. 23.x or 25.x. Never downgrade:
        # move up to the newest LTS instead.
        $script:NodeUpgradeMode = $true
        Write-Step "Node.js $existing is installed, but the kiosk does not support it. Upgrading to the newest Node.js LTS..."
        $wingetId = $NodeLtsWingetId
        $wingetVersion = $null
    } else {
        if ($existing) { Write-Step "Node.js $existing is too old. Installing Node.js $NodeVersion..." }
        $wingetId = $NodeWingetId
        $wingetVersion = $NodeVersion
    }

    if (-not $DownloadOnly -and (Install-WithWinget $wingetId $wingetVersion)) {
        $version = Get-NodeVersionAt $nodeExe
        if ($version -and (Test-NodeVersion $version)) {
            Write-Step "Node.js $version installed."
            Write-Result $nodeFolder
            return
        }
        Write-Step "winget finished, but $nodeExe reports '$version'. Downloading the installer directly instead."
    }

    $target = if ($script:NodeUpgradeMode) { Get-NewestNodeLts $existing } else { $NodeVersion }
    $installed = Install-NodeMsi $target $nodeExe
    if ($DownloadOnly) { return }
    Write-Step "Node.js $installed installed."
    Write-Result $nodeFolder
}

function Install-Python {
    if (-not $DownloadOnly -and (Install-WithWinget $PythonWingetId $PythonVersion)) {
        $folder = Find-PythonFolder
        if ($folder) {
            Write-Step "Python installed in $folder."
            Write-Result $folder
            return
        }
        Write-Step 'winget finished, but python.exe was not found. Downloading the installer directly instead.'
    }

    $installer = Join-Path $env:TEMP (Get-PythonFileName)
    Save-Download (Get-PythonUrl) $installer
    Assert-Signed $installer 'Python Software Foundation'

    if ($DownloadOnly) {
        Write-Step "Download only: $installer"
        return
    }

    Write-Step "Installing Python $PythonVersion for the current user (other Python versions stay installed)..."
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
    Write-Host 'Automatic installation failed. Install it manually, then run the installer again:'
    if ($Runtime -eq 'node' -and $script:NodeUpgradeMode) {
        Write-Host '  Node.js LTS     : https://nodejs.org/en/download'
        Write-Host "  or with winget  : winget install --id $NodeLtsWingetId --exact"
    } elseif ($Runtime -eq 'node') {
        Write-Host "  Node.js $NodeVersion : $(Get-NodeUrl $NodeVersion)"
        Write-Host "  or with winget  : winget install --id $NodeWingetId --version $NodeVersion --exact"
    } else {
        Write-Host "  Python $PythonVersion : $(Get-PythonUrl)"
        Write-Host '  Tick "Add python.exe to PATH" on the first installer screen.'
        Write-Host "  or with winget  : winget install --id $PythonWingetId --version $PythonVersion --exact"
    }
    exit 1
}
