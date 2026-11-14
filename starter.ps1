# Heigen Studio Starter
# GUI:       starter.bat
# Headless:  starter.ps1 -StartAll | -StopAll | -Status | -Start <svc> | -Stop <svc>
#            (svc = backend, kiosk, staff, ngrok, cloudflare)
param(
    [switch]$StartAll,
    [switch]$StopAll,
    [switch]$Status,
    [ValidateSet('backend', 'kiosk', 'staff', 'ngrok', 'cloudflare')][string]$Start,
    [ValidateSet('backend', 'kiosk', 'staff', 'ngrok', 'cloudflare')][string]$Stop
)

$ErrorActionPreference = 'Stop'
$headless = $StartAll -or $StopAll -or $Status -or $Start -or $Stop
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-LanAddress {
    try {
        $config = Get-NetIPConfiguration -ErrorAction Stop |
            Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
            Select-Object -First 1
        if ($config) { return $config.IPv4Address[0].IPAddress }
    } catch {}
    return $null
}

# Shared state between the window and its background workers.
$sync = [hashtable]::Synchronized(@{
    Root      = $root
    Lan       = (Get-LanAddress)
    Log       = $null
    Commands  = $null
    Status    = $null
    PublicUrls = @{}
    Busy      = $null
    Refresh   = $false
    Quit      = $false
})

# ---------------------------------------------------------------------------
# Core logic. Kept as text so the background runspaces can load it too.
# ---------------------------------------------------------------------------
$core = @'
$ErrorActionPreference = 'Stop'
$root = $sync.Root
$lan = $sync.Lan
$backendDir = Join-Path $root 'Snaplytics'
$python = Join-Path $backendDir '.venv\Scripts\python.exe'
$electronDir = Join-Path $root 'electron-app'
$kioskDir = Join-Path $root 'HeigenKiosk'

$services = [ordered]@{
    backend = @{
        Name    = 'Backend (Django API)'
        Title   = 'Heigen Backend'
        Dir     = $backendDir
        Command = "`"$python`" manage.py runserver 0.0.0.0:8000"
        Url     = 'http://localhost:8000/api/'
        Needs   = @('python')
    }
    kiosk = @{
        Name    = 'Kiosk (Expo)'
        Title   = 'Heigen Kiosk'
        Dir     = $kioskDir
        Command = 'call npm start'
        Url     = 'http://localhost:8090'
        Needs   = @('kiosk')
    }
    staff = @{
        Name    = 'Staff app (Electron)'
        Title   = 'Heigen Staff'
        Dir     = $electronDir
        # ELECTRON_RUN_AS_NODE (set by VS Code and other Electron hosts) makes
        # Electron run as plain Node and crash, so clear it.
        Command = 'set ELECTRON_RUN_AS_NODE=&& set HEIGEN_SKIP_DJANGO=1&& call npm start'
        Url     = $null
        Needs   = @('electron')
    }
    ngrok = @{
        Name    = 'Public link (ngrok)'
        Title   = 'Heigen Ngrok'
        Dir     = $electronDir
        Command = 'set ELECTRON_RUN_AS_NODE=&& call npm run web:ngrok'
        Url     = $null
        Needs   = @('python', 'electron', 'kiosk', 'ngrok')
        Port    = 4173
    }
    # Cloudflare Quick Tunnel: no account or bandwidth cap; cloudflared is
    # installed automatically on first start (see tools\install-runtime.ps1).
    cloudflare = @{
        Name    = 'Public link (Cloudflare)'
        Title   = 'Heigen Cloudflare'
        Dir     = $electronDir
        Command = 'set ELECTRON_RUN_AS_NODE=&& call npm run web:cloudflare'
        Url     = $null
        Needs   = @('python', 'electron', 'kiosk')
        Port    = 4174
    }
}

# Services that publish the staff web + kiosk through a tunnel.
$publicKeys = @('ngrok', 'cloudflare')

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $Message
    if ($sync.Log) { $sync.Log.Enqueue($line) } else { Write-Host $line }
}

function Test-Needs {
    param([string]$Key)
    foreach ($need in $services[$Key].Needs) {
        switch ($need) {
            'python' { if (-not (Test-Path $python)) { Write-Log 'ERROR: Backend environment not found. Click Install / Repair first.'; return $false } }
            'kiosk' { if (-not (Test-Path (Join-Path $kioskDir 'node_modules'))) { Write-Log 'ERROR: Kiosk dependencies not found. Click Install / Repair first.'; return $false } }
            'electron' { if (-not (Test-Path (Join-Path $electronDir 'node_modules'))) { Write-Log 'ERROR: Staff app dependencies not found. Click Install / Repair first.'; return $false } }
            'ngrok' {
                if (-not $env:NGROK_PATH -and -not (Get-Command ngrok -ErrorAction SilentlyContinue)) {
                    Write-Log 'ERROR: ngrok is not installed or not on PATH. Install it from https://ngrok.com/download and run: ngrok config add-authtoken YOUR_TOKEN'
                    return $false
                }
            }
        }
    }
    return $true
}

# One snapshot of processes + listening ports (two OS calls) per check.
function Get-Snapshot {
    $procs = @{}
    foreach ($p in (Get-CimInstance Win32_Process)) { $procs[[int]$p.ProcessId] = $p }
    $listen = @{}
    foreach ($line in (& netstat.exe -ano -p TCP) + (& netstat.exe -ano -p TCPv6)) {
        $t = $line.Trim() -split '\s+'
        # Listening sockets have a foreign address ending in ":0" (language-independent).
        if ($t.Count -ge 5 -and $t[0] -like 'TCP*' -and $t[2] -match ':0$') {
            $port = [int]($t[1].Substring($t[1].LastIndexOf(':') + 1))
            $owner = [int]$t[4]
            if (-not $listen.ContainsKey($port)) { $listen[$port] = @() }
            if ($listen[$port] -notcontains $owner) { $listen[$port] += $owner }
        }
    }
    return @{ Procs = $procs; Listen = $listen }
}

function Test-CommandLine {
    param($Proc, [string[]]$Needles)
    $cmd = ([string]$Proc.CommandLine).ToLower()
    foreach ($n in $Needles) { if (-not $cmd.Contains($n.ToLower())) { return $false } }
    return $true
}

function Get-ServicePids {
    param([string]$Key, $Snap)
    $procs = $Snap.Procs.Values
    switch ($Key) {
        'backend' { return @($Snap.Listen[8000] | Where-Object { $_ }) }
        'kiosk' {
            # The Expo dev server itself (not the staff app's built-in kiosk on 8090).
            return @($procs | Where-Object {
                    $_.Name -eq 'node.exe' -and (Test-CommandLine $_ @($kioskDir, 'expo', ' start')) -and
                    -not (Test-CommandLine $_ @('export'))
                } | ForEach-Object { [int]$_.ProcessId })
        }
        'staff' {
            $needle = $electronDir.ToLower()
            return @($procs | Where-Object {
                    $_.Name -eq 'electron.exe' -and (
                        ([string]$_.CommandLine).ToLower().Contains($needle) -or
                        ([string]$_.ExecutablePath).ToLower().Contains($needle))
                } | ForEach-Object { [int]$_.ProcessId })
        }
        'ngrok' {
            return @($procs | Where-Object {
                    $_.Name -eq 'node.exe' -and (Test-CommandLine $_ @('web-server.cjs', '--ngrok'))
                } | ForEach-Object { [int]$_.ProcessId })
        }
        'cloudflare' {
            return @($procs | Where-Object {
                    $_.Name -eq 'node.exe' -and (Test-CommandLine $_ @('web-server.cjs', '--cloudflare'))
                } | ForEach-Object { [int]$_.ProcessId })
        }
    }
    return @()
}

# Terminal windows this starter opened for a service (from any run of the starter).
function Get-ServiceWindows {
    param([string]$Key, $Snap)
    $needle = "title $($services[$Key].Title) &&".ToLower()
    return @($Snap.Procs.Values | Where-Object {
            $_.Name -eq 'cmd.exe' -and ([string]$_.CommandLine).ToLower().Contains($needle)
        } | ForEach-Object { [int]$_.ProcessId })
}

function Get-ServiceState {
    param([string]$Key, $Snap)
    $pids = Get-ServicePids -Key $Key -Snap $Snap
    if ($pids.Count) { return @{ State = 'running'; Pids = $pids } }
    if ((Get-ServiceWindows -Key $Key -Snap $Snap).Count) { return @{ State = 'starting'; Pids = @() } }
    return @{ State = 'stopped'; Pids = @() }
}

# Walk up from a service process to the outermost process that belongs to it
# (python reloader, npm/node wrappers, the window the starter opened) without
# touching unrelated shells, editors, or the starter itself.
function Get-KillRoot {
    param([int]$ProcessId, $Snap)
    $rootLower = $root.ToLower()
    $current = $Snap.Procs[$ProcessId]
    if (-not $current) { return $ProcessId }
    while ($true) {
        $parent = $Snap.Procs[[int]$current.ParentProcessId]
        if (-not $parent -or [int]$parent.ProcessId -eq $PID) { break }
        $name = ([string]$parent.Name).ToLower()
        $cmd = ([string]$parent.CommandLine).ToLower()
        $owned = ($name -in @('python.exe', 'node.exe', 'electron.exe')) -or
            ($name -eq 'cmd.exe' -and ($cmd.Contains($rootLower) -or $cmd.Contains('title heigen') -or $cmd.Contains('/d /s /c')))
        if (-not $owned) { break }
        $current = $parent
    }
    return [int]$current.ProcessId
}

function Stop-HeigenService {
    param([string]$Key)
    $svc = $services[$Key]
    $snap = Get-Snapshot
    $pids = @(Get-ServicePids -Key $Key -Snap $snap) + @(Get-ServiceWindows -Key $Key -Snap $snap)
    if ($pids.Count -eq 0) {
        Write-Log "$($svc.Name) is not running."
        return
    }
    $roots = @($pids | ForEach-Object { Get-KillRoot -ProcessId $_ -Snap $snap } | Sort-Object -Unique)
    Write-Log "Stopping $($svc.Name) (PID $($roots -join ', '))..."
    foreach ($p in $roots) { & taskkill.exe /PID $p /T /F 2>&1 | Out-Null }

    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Milliseconds 500
        $snap = Get-Snapshot
        if ((Get-ServiceState -Key $Key -Snap $snap).State -eq 'stopped') {
            Write-Log "$($svc.Name) stopped."
            return
        }
    }
    Write-Log "WARNING: $($svc.Name) is still running. Close its '$($svc.Title)' window manually."
}

function Wait-Backend {
    param([int]$Seconds = 30)
    for ($i = 0; $i -lt ($Seconds * 2); $i++) {
        if ((Get-Snapshot).Listen[8000]) { Write-Log 'Backend is up on port 8000.'; return $true }
        Start-Sleep -Milliseconds 500
    }
    Write-Log "WARNING: Backend did not open port 8000 within $Seconds s. Check the 'Heigen Backend' window."
    return $false
}

function Start-HeigenService {
    param([string]$Key)
    $svc = $services[$Key]
    if (-not (Test-Needs -Key $Key)) { return }
    $snap = Get-Snapshot
    $state = (Get-ServiceState -Key $Key -Snap $snap).State
    if ($state -eq 'running') { Write-Log "$($svc.Name) is already running."; return }
    if ($state -eq 'starting') { Write-Log "$($svc.Name) is already starting in its '$($svc.Title)' window."; return }

    if ($Key -eq 'kiosk') {
        $holders = @($snap.Listen[8090] | Where-Object { $_ } | ForEach-Object { $snap.Procs[[int]$_].Name })
        if ($holders -contains 'electron.exe') {
            Write-Log 'NOTE: Port 8090 is used by the staff app''s built-in kiosk. Expo will ask to use another port in its window - answer Y.'
        }
    }
    if ($Key -in $publicKeys) {
        # Start Django separately so stopping the tunnel leaves the backend running.
        if (-not $snap.Listen[8000]) {
            Start-HeigenService -Key 'backend'
            Wait-Backend | Out-Null
        }
        if ($snap.Listen[$svc.Port]) {
            Write-Log "ERROR: Port $($svc.Port) is already in use. Stop whatever is using it and try again."
            return
        }
    }

    Start-Process -FilePath 'cmd.exe' -WorkingDirectory $svc.Dir -ArgumentList @(
        '/k',
        "title $($svc.Title) && $($svc.Command)"
    ) | Out-Null
    Write-Log "Starting $($svc.Name) in window '$($svc.Title)'..."
    switch ($Key) {
        'kiosk' { Write-Log 'Kiosk takes ~10-30 s to bundle on first load.' }
        'ngrok' { Write-Log 'Building the kiosk web export (~1 min), then opening the ngrok tunnel. The public link appears in the row when ready.' }
        'cloudflare' { Write-Log 'Building the kiosk web export (~1 min), then opening a Cloudflare tunnel (installs cloudflared the first time). The public link appears in the row when ready.' }
    }
}

function Start-AllServices {
    Start-HeigenService -Key 'backend'
    Wait-Backend | Out-Null
    Start-HeigenService -Key 'kiosk'
    Start-HeigenService -Key 'staff'
    Write-Log 'Start All finished.'
}

function Stop-AllServices {
    foreach ($key in @('cloudflare', 'ngrok', 'staff', 'kiosk', 'backend')) { Stop-HeigenService -Key $key }
    Write-Log 'Stop All finished.'
}

function Get-PublicUrl {
    param([string]$Key)
    if ($Key -eq 'cloudflare') {
        # Written by electron-app\scripts\web-server.cjs once cloudflared reports it.
        $file = Join-Path $env:TEMP 'heigen-cloudflare-url.txt'
        try {
            if (Test-Path $file) {
                $url = (Get-Content -Path $file -Raw).Trim()
                if ($url) { return $url }
            }
        } catch {}
        return $null
    }
    try {
        $tunnels = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2
        $https = $tunnels.tunnels | Where-Object { $_.public_url -like 'https:*' } | Select-Object -First 1
        if ($https) { return [string]$https.public_url }
    } catch {}
    return $null
}

function Get-AllStatus {
    $snap = Get-Snapshot
    $result = @{}
    foreach ($key in $services.Keys) { $result[$key] = Get-ServiceState -Key $key -Snap $snap }
    return $result
}
'@

# ---------------------------------------------------------------------------
# Headless mode
# ---------------------------------------------------------------------------
if ($headless) {
    . ([scriptblock]::Create($core))
    if ($Stop) { Stop-HeigenService -Key $Stop }
    if ($StopAll) { Stop-AllServices }
    if ($StartAll) { Start-AllServices }
    if ($Start) { Start-HeigenService -Key $Start }
    $all = Get-AllStatus
    foreach ($key in $services.Keys) {
        $s = $all[$key]
        $text = switch ($s.State) {
            'running' { "RUNNING (PID $($s.Pids -join ', '))" }
            'starting' { 'starting / window open' }
            default { 'stopped' }
        }
        Write-Host ('{0,-24} {1}' -f $services[$key].Name, $text)
    }
    if ($lan) { Write-Host "Expo Go URL: exp://${lan}:8090" }
    foreach ($key in $publicKeys) {
        if ($all[$key].State -ne 'running') { continue }
        $url = Get-PublicUrl -Key $key
        if ($url) { Write-Host "$($services[$key].Name): kiosk $url/kiosk/   staff web $url/" }
    }
    exit 0
}

# ---------------------------------------------------------------------------
# GUI: the window only draws; checks and start/stop run on background threads,
# so the window never freezes and actions run one at a time.
# ---------------------------------------------------------------------------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
. ([scriptblock]::Create($core))

$sync.Log = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
$sync.Commands = New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'

function Start-Runner {
    param([string]$Body)
    $runspace = [runspacefactory]::CreateRunspace()
    $runspace.Open()
    $runspace.SessionStateProxy.SetVariable('sync', $sync)
    $ps = [powershell]::Create()
    $ps.Runspace = $runspace
    [void]$ps.AddScript($core + "`n" + $Body)
    [void]$ps.BeginInvoke()
    return $ps
}

$workerBody = @'
while (-not $sync.Quit) {
    $cmd = $null
    if (-not $sync.Commands.TryDequeue([ref]$cmd)) { Start-Sleep -Milliseconds 150; continue }
    $action, $key = $cmd -split ':', 2
    try {
        switch ($action) {
            'start'    { $sync.Busy = "Starting $($services[$key].Name)..."; Start-HeigenService -Key $key }
            'stop'     { $sync.Busy = "Stopping $($services[$key].Name)..."; Stop-HeigenService -Key $key }
            'startall' { $sync.Busy = 'Starting all...'; Start-AllServices }
            'stopall'  { $sync.Busy = 'Stopping all...'; Stop-AllServices }
        }
    } catch {
        Write-Log "ERROR: $($_.Exception.Message)"
    } finally {
        $sync.Busy = $null
        $sync.Refresh = $true
    }
}
'@

$pollerBody = @'
while (-not $sync.Quit) {
    try {
        $status = Get-AllStatus
        $urls = @{}
        foreach ($key in $publicKeys) {
            $urls[$key] = if ($status[$key].State -eq 'running') { Get-PublicUrl -Key $key } else { $null }
        }
        $sync.PublicUrls = $urls
        $sync.Status = $status
    } catch {}
    for ($i = 0; $i -lt 20 -and -not $sync.Quit -and -not $sync.Refresh; $i++) { Start-Sleep -Milliseconds 100 }
    $sync.Refresh = $false
}
'@

$dot = [string][char]0x25CF
$font = New-Object System.Drawing.Font('Segoe UI', 9)
$bold = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$green = [System.Drawing.Color]::FromArgb(22, 128, 61)
$gray = [System.Drawing.Color]::FromArgb(110, 110, 110)
$amber = [System.Drawing.Color]::FromArgb(180, 110, 0)

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Heigen Studio Starter'
$form.StartPosition = 'CenterScreen'
$form.MaximizeBox = $false
$form.FormBorderStyle = 'FixedDialog'
$form.Font = $font

function New-Label {
    param($Parent, [string]$Text, [int]$X, [int]$Y, [int]$W, [int]$H, $Font = $font)
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.Font = $Font
    $label.Location = New-Object System.Drawing.Point($X, $Y)
    $label.Size = New-Object System.Drawing.Size($W, $H)
    $Parent.Controls.Add($label)
    return $label
}

function New-Button {
    param($Parent, [string]$Text, [int]$X, [int]$Y, [int]$W, [scriptblock]$Action, $Tag = $null)
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Tag = $Tag
    $button.Location = New-Object System.Drawing.Point($X, $Y)
    $button.Size = New-Object System.Drawing.Size($W, 30)
    $button.Add_Click($Action)
    $Parent.Controls.Add($button)
    return $button
}

function Send-Command {
    param([string]$Command)
    if ($sync.Busy -or -not $sync.Commands.IsEmpty) {
        Write-Log "Busy ($($sync.Busy)) - please wait for it to finish."
        return
    }
    $sync.Busy = 'Working...'
    $sync.Commands.Enqueue($Command)
}

function Open-ServiceUrl {
    param([string]$Key)
    if ($Key -in $publicKeys) {
        $publicUrl = $sync.PublicUrls[$Key]
        if ($publicUrl) {
            $kioskUrl = "$publicUrl/kiosk/"
            [System.Windows.Forms.Clipboard]::SetText($kioskUrl)
            Write-Log "Public kiosk: $kioskUrl (copied)   Public staff web: $publicUrl/"
            Start-Process $kioskUrl
        } else {
            Write-Log 'The public link is not ready yet.'
        }
        return
    }
    Start-Process $services[$Key].Url
}

$heading = New-Label $form 'Heigen Studio' 20 12 400 36 (New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold))
$lanText = if ($lan) { "This PC on the network: $lan (phones must be on the same Wi-Fi)" } else { 'LAN address not detected - phones may not be able to connect.' }
$subtitle = New-Label $form "Start, stop, and monitor the local services.  $lanText" 22 50 640 20
$subtitle.ForeColor = $gray

$details = @{
    backend = "http://localhost:8000/api/`nLAN: " + $(if ($lan) { "http://${lan}:8000/api/" } else { 'not detected' })
    kiosk   = "Web: http://localhost:8090`nExpo Go: " + $(if ($lan) { "exp://${lan}:8090" } else { 'LAN IP not detected' })
    staff   = "Desktop window`nUses the backend on port 8000"
    ngrok   = "Staff web + kiosk at /kiosk/ over the internet`n(starts the backend if needed)"
    cloudflare = "Same as ngrok, no bandwidth cap or account`n(new random link each start)"
}

$rows = @{}
$y = 80
foreach ($key in $services.Keys) {
    $panel = New-Object System.Windows.Forms.Panel
    $panel.BorderStyle = 'FixedSingle'
    $panel.Location = New-Object System.Drawing.Point(16, $y)
    $panel.Size = New-Object System.Drawing.Size(648, 64)
    $form.Controls.Add($panel)

    New-Label $panel $services[$key].Name 8 7 210 20 $bold | Out-Null
    $state = New-Label $panel "$dot Checking..." 8 34 210 20
    $detail = New-Label $panel $details[$key] 220 7 250 48
    $detail.ForeColor = $gray

    # Each button carries its service key in Tag; handlers read it via $this.
    $startBtn = New-Button $panel 'Start' 474 16 54 { Send-Command "start:$($this.Tag)" } $key
    $stopBtn = New-Button $panel 'Stop' 532 16 54 { Send-Command "stop:$($this.Tag)" } $key
    $openBtn = $null
    if ($key -ne 'staff') {
        $openBtn = New-Button $panel 'Open' 590 16 50 { Open-ServiceUrl -Key $this.Tag } $key
    }
    $rows[$key] = @{ State = $state; Detail = $detail; Start = $startBtn; Stop = $stopBtn; Open = $openBtn }
    $y += 72
}

$y += 2
$allButtons = @(
    (New-Button $form 'Start All' 16 $y 125 { Send-Command 'startall' }),
    (New-Button $form 'Stop All' 147 $y 125 { Send-Command 'stopall' })
)
New-Button $form 'Copy Expo Go URL' 278 $y 130 {
    if ($lan) {
        [System.Windows.Forms.Clipboard]::SetText("exp://${lan}:8090")
        Write-Log "Copied exp://${lan}:8090 - open it in Expo Go on the phone."
    } else {
        Write-Log 'LAN address not detected; connect this PC to Wi-Fi/Ethernet.'
    }
} | Out-Null
New-Button $form 'Install / Repair' 414 $y 125 {
    $installer = Join-Path $root 'install-windows.bat'
    Start-Process -FilePath 'cmd.exe' -WorkingDirectory $root -ArgumentList @('/k', "call `"$installer`"") | Out-Null
    Write-Log 'Installer opened in a separate window.'
} | Out-Null
New-Button $form 'Open Folder' 545 $y 119 { Start-Process explorer.exe $root } | Out-Null

$y += 40
New-Label $form 'Activity' 18 $y 80 18 $bold | Out-Null
$busyLabel = New-Label $form '' 100 ($y + 1) 560 18
$busyLabel.ForeColor = $amber
$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Multiline = $true
$logBox.ReadOnly = $true
$logBox.ScrollBars = 'Vertical'
$logBox.BackColor = [System.Drawing.Color]::White
$logBox.Font = New-Object System.Drawing.Font('Consolas', 9)
$logBox.Location = New-Object System.Drawing.Point(16, ($y + 22))
$logBox.Size = New-Object System.Drawing.Size(648, 150)
$form.Controls.Add($logBox)
$form.ClientSize = New-Object System.Drawing.Size(680, ($y + 22 + 150 + 14))

$script:shownUrls = @{}

function Update-View {
    $line = $null
    while ($sync.Log.TryDequeue([ref]$line)) {
        $logBox.AppendText($line + [Environment]::NewLine)
    }

    $busy = [bool]$sync.Busy
    $busyLabel.Text = if ($busy) { $sync.Busy } else { '' }

    $status = $sync.Status
    if (-not $status) { return }
    foreach ($key in $services.Keys) {
        $row = $rows[$key]
        $s = $status[$key]
        switch ($s.State) {
            'running' {
                if ($key -in $publicKeys -and -not $sync.PublicUrls[$key]) {
                    $row.State.Text = "$dot Starting... (building / connecting)"
                    $row.State.ForeColor = $amber
                } else {
                    $row.State.Text = "$dot Running (PID $($s.Pids -join ', '))"
                    $row.State.ForeColor = $green
                }
            }
            'starting' {
                $row.State.Text = "$dot Starting... (see its window)"
                $row.State.ForeColor = $amber
            }
            default {
                $row.State.Text = "$dot Stopped"
                $row.State.ForeColor = $gray
            }
        }
        $row.Start.Enabled = (-not $busy) -and $s.State -eq 'stopped'
        $row.Stop.Enabled = (-not $busy) -and $s.State -ne 'stopped'
    }
    foreach ($b in $allButtons) { $b.Enabled = -not $busy }

    foreach ($key in $publicKeys) {
        $url = $sync.PublicUrls[$key]
        if ($url -eq $script:shownUrls[$key]) { continue }
        $script:shownUrls[$key] = $url
        if ($url) {
            $rows[$key].Detail.Text = "Kiosk: $url/kiosk/`nStaff web: $url/"
            Write-Log "$($services[$key].Name) ready: $url/kiosk/  (Open copies it)"
        } else {
            $rows[$key].Detail.Text = $details[$key]
        }
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({ Update-View })

$form.Add_Shown({
    Write-Log 'Ready. Services run in their own windows; closing this starter does not stop them.'
    if ($lan) { Write-Log "Expo Go on a phone: exp://${lan}:8090" }
    $script:worker = Start-Runner $workerBody
    $script:poller = Start-Runner $pollerBody
    $timer.Start()
})
$form.Add_FormClosing({
    $timer.Stop()
    $sync.Quit = $true
})

[void]$form.ShowDialog()
