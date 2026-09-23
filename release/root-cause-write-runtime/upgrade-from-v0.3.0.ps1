param(
  [string]$OldRelayDir = "D:\tools\ones-local-relay-v0.3.0",
  [string]$NewRelayDir = $PSScriptRoot
)
$ErrorActionPreference = "Stop"
$OldRelayDir = (Resolve-Path $OldRelayDir).Path
$NewRelayDir = (Resolve-Path $NewRelayDir).Path
$oldStop = Join-Path $OldRelayDir "stop.ps1"
if (Test-Path -LiteralPath $oldStop -PathType Leaf) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $oldStop }
$oldData = Join-Path $OldRelayDir "data"
$newData = Join-Path $NewRelayDir "data"
New-Item -ItemType Directory -Force -Path $newData | Out-Null
foreach ($name in @("relay.db","relay.db-wal","relay.db-shm","relay-token.txt")) {
  $src = Join-Path $oldData $name
  if (Test-Path -LiteralPath $src -PathType Leaf) { Copy-Item -LiteralPath $src -Destination (Join-Path $newData $name) -Force }
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $NewRelayDir "start.ps1")
if ($LASTEXITCODE -ne 0) { throw "RELAY_V032_START_FAILED" }
$health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18731/health" -TimeoutSec 5
if (-not $health.ok -or $health.version -ne "0.3.2") { throw "RELAY_V032_HEALTH_FAILED" }
Write-Host "RELAY_V032_UPGRADE_PASS"
Write-Host ("VERSION=" + $health.version)
Write-Host ("DB_PRESERVED=" + (Test-Path -LiteralPath (Join-Path $newData "relay.db")))
Write-Host ("TOKEN_PRESERVED=" + (Test-Path -LiteralPath (Join-Path $newData "relay-token.txt")))
