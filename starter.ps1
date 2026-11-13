$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'Snaplytics'
$python = Join-Path $backend '.venv\Scripts\python.exe'
$electron = Join-Path $root 'electron-app'
$kiosk = Join-Path $root 'HeigenKiosk'

function Test-Installed {
    if (-not (Test-Path $python)) {
        [System.Windows.Forms.MessageBox]::Show(
            'Backend environment not found. Click Install first.',
            'Heigen Studio'
        ) | Out-Null
        return $false
    }

    if (-not (Test-Path (Join-Path $electron 'node_modules'))) {
        [System.Windows.Forms.MessageBox]::Show(
            'Electron dependencies not found. Click Install first.',
            'Heigen Studio'
        ) | Out-Null
        return $false
    }

    if (-not (Test-Path (Join-Path $kiosk 'node_modules'))) {
        [System.Windows.Forms.MessageBox]::Show(
            'Kiosk dependencies not found. Click Install first.',
            'Heigen Studio'
        ) | Out-Null
        return $false
    }

    return $true
}

function Start-TerminalService {
    param(
        [Parameter(Mandatory = $true)][string]$Title,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Command
    )

    Start-Process -FilePath 'cmd.exe' -WorkingDirectory $WorkingDirectory -ArgumentList @(
        '/k',
        "title $Title && $Command"
    ) | Out-Null
}

function Start-Backend {
    if (-not (Test-Installed)) { return }
    Start-TerminalService -Title 'Heigen Backend' -WorkingDirectory $backend `
        -Command "`"$python`" manage.py runserver 8000"
    $status.Text = 'Backend started on http://localhost:8000'
}

function Start-Kiosk {
    if (-not (Test-Installed)) { return }
    Start-TerminalService -Title 'Heigen Kiosk' -WorkingDirectory $kiosk `
        -Command 'call npm start'
    $status.Text = 'Kiosk started on http://localhost:8090'
}

function Start-Staff {
    if (-not (Test-Installed)) { return }
    Start-TerminalService -Title 'Heigen Staff' -WorkingDirectory $electron `
        -Command 'set HEIGEN_SKIP_DJANGO=1&& call npm start'
    $status.Text = 'Staff app started'
}

function Start-All {
    if (-not (Test-Installed)) { return }
    Start-Backend
    Start-Sleep -Seconds 3
    Start-Kiosk
    Start-Staff
    $status.Text = 'Backend, kiosk, and staff app started'
}

function Install-Apps {
    $installer = Join-Path $root 'install-windows.bat'
    Start-Process -FilePath 'cmd.exe' -WorkingDirectory $root -ArgumentList @(
        '/k',
        "call `"$installer`""
    ) | Out-Null
    $status.Text = 'Installer opened in a separate window'
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Heigen Studio Starter'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(440, 360)
$form.MinimumSize = New-Object System.Drawing.Size(440, 360)
$form.MaximizeBox = $false
$form.FormBorderStyle = 'FixedDialog'

$heading = New-Object System.Windows.Forms.Label
$heading.Text = 'Heigen Studio'
$heading.Font = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$heading.AutoSize = $true
$heading.Location = New-Object System.Drawing.Point(28, 22)
$form.Controls.Add($heading)

$description = New-Object System.Windows.Forms.Label
$description.Text = 'Choose which local services to start.'
$description.AutoSize = $true
$description.Location = New-Object System.Drawing.Point(31, 62)
$form.Controls.Add($description)

function New-ServiceButton {
    param([string]$Text, [int]$X, [int]$Y, [scriptblock]$Action)
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Size = New-Object System.Drawing.Size(170, 45)
    $button.Location = New-Object System.Drawing.Point($X, $Y)
    $button.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $button.Add_Click($Action)
    $form.Controls.Add($button)
}

New-ServiceButton 'Start Backend' 30 100 { Start-Backend }
New-ServiceButton 'Start Staff' 220 100 { Start-Staff }
New-ServiceButton 'Start Kiosk' 30 160 { Start-Kiosk }
New-ServiceButton 'Start All' 220 160 { Start-All }
New-ServiceButton 'Install / Repair' 30 220 { Install-Apps }

$status = New-Object System.Windows.Forms.Label
$status.Text = 'Ready'
$status.AutoEllipsis = $true
$status.Size = New-Object System.Drawing.Size(360, 40)
$status.Location = New-Object System.Drawing.Point(31, 285)
$form.Controls.Add($status)

[void]$form.ShowDialog()
