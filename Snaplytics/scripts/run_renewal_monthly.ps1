$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

if (Test-Path ".venv\Scripts\python.exe") {
    $python = (Resolve-Path ".venv\Scripts\python.exe").Path
} else {
    $python = "python"
}

& $python manage.py evaluate_renewal_shadow
if ($LASTEXITCODE -ne 0) {
    throw "Shadow outcome evaluation failed."
}

& $python manage.py request_renewal_training
if ($LASTEXITCODE -ne 0) {
    throw "Training request creation failed."
}
