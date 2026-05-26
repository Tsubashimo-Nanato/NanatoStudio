param(
  [switch]$BackendOnly,
  [switch]$InstallBackendRequirements,
  [switch]$StartAll,
  [switch]$StartBackend,
  [switch]$StartFrontend
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackendDir = Join-Path $Root "backend"
$Python = Join-Path $BackendDir ".venv\Scripts\python.exe"
$Requirements = Join-Path $BackendDir "requirements.txt"
$BackendUrl = "http://127.0.0.1:8000"
$HealthUrl = "$BackendUrl/api/health"
$ChallengeUrl = "$BackendUrl/api/auth/challenge"
$FrontendUrl = "http://127.0.0.1:4321/"
$LoginUrl = "http://127.0.0.1:4321/login/"
$BackendCommand = "cd backend; .venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
$FrontendCommand = "npm run dev"
$FallbackFrontendCommand = "node .tools\npm\package\bin\npm-cli.js run dev"

function Write-Section {
  param([string]$Title)
  Write-Host ""
  Write-Host "== $Title =="
}

function Test-BackendVenv {
  if (Test-Path $Python) {
    Write-Host "PASS backend venv: $Python"
    return $true
  }

  Write-Host "FAIL backend venv not found."
  Write-Host "Create it with:"
  Write-Host "  cd backend"
  Write-Host "  python -m venv .venv"
  Write-Host "  .venv\Scripts\Activate.ps1"
  Write-Host "  pip install -r requirements.txt"
  return $false
}

function Install-BackendRequirements {
  if (-not (Test-Path $Python)) {
    throw "Cannot install backend requirements because backend\.venv was not found."
  }

  Write-Host "Installing backend requirements..."
  & $Python -m pip install -r $Requirements
}

function Test-BackendEndpoint {
  param(
    [string]$Label,
    [string]$Url
  )

  try {
    $result = Invoke-RestMethod $Url -TimeoutSec 4
    Write-Host "PASS ${Label}:" ($result | ConvertTo-Json -Compress)
    return $true
  } catch {
    Write-Host "FAIL ${Label}: $($_.Exception.Message)"
    return $false
  }
}

function Start-BackendWindow {
  if (-not (Test-Path $Python)) {
    Test-BackendVenv | Out-Null
    return
  }

  $command = "cd `"$BackendDir`"; .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
  Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command
  Write-Host "Started backend window."
}

function Start-FrontendWindow {
  $command = "cd `"$Root`"; npm run dev"
  Start-Process powershell -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $command
  Write-Host "Started frontend window."
}

if ($BackendOnly) {
  if (-not (Test-BackendVenv)) { exit 1 }
  if ($InstallBackendRequirements) { Install-BackendRequirements }
  Set-Location $BackendDir
  & $Python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
  exit $LASTEXITCODE
}

Write-Host "Nanato Studio local auth workflow"

Write-Section "Environment"
$hasVenv = Test-BackendVenv
if ($InstallBackendRequirements -and $hasVenv) {
  Install-BackendRequirements
}

Write-Section "Current backend status"
$healthOk = Test-BackendEndpoint "backend health" $HealthUrl
if ($healthOk) {
  Test-BackendEndpoint "auth challenge" $ChallengeUrl | Out-Null
}

if ($StartAll) {
  $StartBackend = $true
  $StartFrontend = $true
}

if ($StartBackend) {
  Write-Section "Starting backend"
  Start-BackendWindow
}

if ($StartFrontend) {
  Write-Section "Starting frontend"
  Start-FrontendWindow
}

Write-Section "Commands"
Write-Host "Start backend:"
Write-Host "  npm run backend:dev"
Write-Host "or:"
Write-Host "  $BackendCommand"
Write-Host ""
Write-Host "Start frontend:"
Write-Host "  $FrontendCommand"
Write-Host "or:"
Write-Host "  $FallbackFrontendCommand"
Write-Host ""
Write-Host "Check auth stack:"
Write-Host "  npm run auth:check"
Write-Host "or:"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\check-auth.ps1"

Write-Section "URLs"
Write-Host "Frontend:          $FrontendUrl"
Write-Host "Login:             $LoginUrl"
Write-Host "Backend health:    $HealthUrl"
Write-Host "Backend challenge: $ChallengeUrl"

Write-Section "Local admin"
Write-Host "Local-only default admin bootstrap: adm1n / adm1n."
Write-Host "Change the password after first login."
