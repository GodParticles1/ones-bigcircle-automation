$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$HealthUrl = "http://127.0.0.1:18731/health"
$PidPath = Join-Path $PSScriptRoot "data\relay.pid"

function Get-RelayHealth {
  try { return Invoke-RestMethod -Method Get -Uri $HealthUrl -TimeoutSec 1 } catch { return $null }
}

$health = Get-RelayHealth
$pidToStop = $null
if ($health -and $health.ok -and $health.pid) {
  $pidToStop = [int]$health.pid
} elseif (Test-Path $PidPath) {
  $raw = (Get-Content $PidPath -Raw).Trim()
  if ($raw -match '^\d+$') { $pidToStop = [int]$raw }
}

if (-not $pidToStop) {
  Write-Host "STOP=ALREADY_STOPPED"
  if (Test-Path $PidPath) { Remove-Item $PidPath -Force -ErrorAction SilentlyContinue }
  exit 0
}

$proc = Get-Process -Id $pidToStop -ErrorAction SilentlyContinue
if ($proc) { Stop-Process -Id $pidToStop -Force }

for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 250
  $health = Get-RelayHealth
  if (-not $health) {
    if (Test-Path $PidPath) { Remove-Item $PidPath -Force -ErrorAction SilentlyContinue }
    Write-Host "STOP=PASS"
    Write-Host ("PID=" + $pidToStop)
    exit 0
  }
}
throw "Relay still responds after stop attempt."
