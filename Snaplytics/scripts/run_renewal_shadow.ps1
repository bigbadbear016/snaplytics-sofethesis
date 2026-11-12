$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (Test-Path ".venv\Scripts\python.exe") {
    $python = (Resolve-Path ".venv\Scripts\python.exe").Path
} else {
    $python = "python"
}

& $python manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) {
    throw "Database migration failed."
}

& $python manage.py run_renewal_shadow
if ($LASTEXITCODE -ne 0) {
    throw "Shadow prediction run failed."
}
