$ErrorActionPreference = "Stop"

$BackendUrl = "http://127.0.0.1:8000"
$HealthUrl = "$BackendUrl/api/health"
$ChallengeUrl = "$BackendUrl/api/auth/challenge"
$StartCommand = "cd backend; .venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"
$Failed = $false

function Write-Result {
  param(
    [bool]$Ok,
    [string]$Label,
    [string]$Message
  )

  if ($Ok) {
    Write-Host "PASS $Label - $Message"
  } else {
    Write-Host "FAIL $Label - $Message"
    $script:Failed = $true
  }
}

try {
  $health = Invoke-RestMethod $HealthUrl -TimeoutSec 4
  Write-Result $true "backend health" ($health | ConvertTo-Json -Compress)
} catch {
  Write-Result $false "backend health" $_.Exception.Message
}

try {
  $challenge = Invoke-RestMethod $ChallengeUrl -TimeoutSec 4
  if ($challenge.challenge_id -and $challenge.question) {
    Write-Result $true "auth challenge" "question=`"$($challenge.question)`" challenge_id=present"
  } else {
    Write-Result $false "auth challenge" "response did not include challenge_id and question"
  }
} catch {
  Write-Result $false "auth challenge" $_.Exception.Message
}

if ($Failed) {
  Write-Host ""
  Write-Host "Auth stack is not ready."
  Write-Host "Start the backend with:"
  Write-Host "  npm run backend:dev"
  Write-Host "or:"
  Write-Host "  $StartCommand"
  Write-Host ""
  Write-Host "Then start the frontend with:"
  Write-Host "  npm run dev"
  exit 1
}

Write-Host ""
Write-Host "Auth stack is ready."
Write-Host "Frontend URL: http://127.0.0.1:4321/"
Write-Host "Login URL:    http://127.0.0.1:4321/login/"
