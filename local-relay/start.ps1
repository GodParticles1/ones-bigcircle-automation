$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$HealthUrl = "http://127.0.0.1:18731/health"
$DataDir = Join-Path $PSScriptRoot "data"
$TokenPath = Join-Path $DataDir "relay-token.txt"

function Get-RelayHealth {
  try { return Invoke-RestMethod -Method Get -Uri $HealthUrl -TimeoutSec 1 } catch { return $null }
}

$health = Get-RelayHealth
if ($health -and $health.ok) {
  Write-Host "START=ALREADY_RUNNING"
  Write-Host ("VERSION=" + $health.version)
  Write-Host ("PID=" + $health.pid)
  exit 0
}

if (-not (Test-Path $TokenPath)) {
  $parent = Split-Path $PSScriptRoot -Parent
  foreach ($oldName in @("ones-local-relay-v0.2.0", "ones-local-relay-v0.1.0")) {
    $oldData = Join-Path (Join-Path $parent $oldName) "data"
    $oldToken = Join-Path $oldData "relay-token.txt"
    if (Test-Path $oldToken) {
      New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
      foreach ($name in @("relay-token.txt", "relay.db", "relay.db-wal", "relay.db-shm")) {
        $src = Join-Path $oldData $name
        if (Test-Path $src) { Copy-Item $src (Join-Path $DataDir $name) -Force }
      }
      Write-Host ("MIGRATED_DATA_FROM=" + $oldName)
      break
    }
  }
}

$py = Get-Command py.exe -ErrorAction SilentlyContinue
if ($py) {
  $exe = $py.Source
  $args = @("-3", (Join-Path $PSScriptRoot "relay.py"))
} else {
  $python = Get-Command python.exe -ErrorAction SilentlyContinue
  if (-not $python) { throw "Python 3 not found in PATH" }
  $exe = $python.Source
  $args = @((Join-Path $PSScriptRoot "relay.py"))
}

Start-Process -FilePath $exe -ArgumentList $args -WorkingDirectory $PSScriptRoot -WindowStyle Hidden | Out-Null

for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  $health = Get-RelayHealth
  if ($health -and $health.ok) {
    Write-Host "START=PASS"
    Write-Host ("VERSION=" + $health.version)
    Write-Host ("PID=" + $health.pid)
    Write-Host ("LISTEN=" + $health.bind)
    Write-Host ("TOKEN=" + $(if (Test-Path $TokenPath) { "READY" } else { "MISSING" }))
    exit 0
  }
}
throw "Relay failed to become healthy. Check data\relay-error.log if present."
