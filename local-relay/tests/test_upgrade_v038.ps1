param([Parameter(Mandatory=$true)][string]$FixtureRoot)
$ErrorActionPreference = "Stop"
$oldDir = Join-Path $FixtureRoot "ones-local-relay-v0.3.7"
$newDir = Join-Path $FixtureRoot "ones-local-relay-v0.3.8"
$oldData = Join-Path $oldDir "data"
$newData = Join-Path $newDir "data"
New-Item -ItemType Directory -Force -Path $oldData, $newDir | Out-Null
[IO.File]::WriteAllText((Join-Path $oldDir "stop.ps1"), "throw 'test boundary was not intercepted'")
[IO.File]::WriteAllText((Join-Path $newDir "start.ps1"), "throw 'test boundary was not intercepted'")
$expected = @{}
foreach ($name in @("relay.db", "relay.db-wal", "relay.db-shm", "relay-token.txt")) {
  $bytes = [Text.Encoding]::UTF8.GetBytes("synthetic-preservation-fixture:" + $name)
  [IO.File]::WriteAllBytes((Join-Path $oldData $name), $bytes)
  $expected[$name] = [Convert]::ToBase64String($bytes)
}
function Assert-Preserved {
  foreach ($name in $expected.Keys) {
    foreach ($dir in @($oldData, $newData)) {
      if ([Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $dir $name))) -cne $expected[$name]) {
        throw "UPGRADE_CONTENT_CHANGED: $name"
      }
    }
  }
}
$upgradeTestCalls = [Collections.Generic.List[string]]::new()
# Test-only process and HTTP boundaries: never stop/start a live Relay or contact 18731.
function powershell.exe {
  param([switch]$NoProfile, [string]$ExecutionPolicy, [string]$File)
  if ($upgradeTestCalls.Count -eq 0 -and $File -eq (Join-Path $oldDir "stop.ps1")) {
    $upgradeTestCalls.Add("stop")
  } elseif ($upgradeTestCalls.Count -eq 1 -and $File -eq (Join-Path $newDir "start.ps1")) {
    Assert-Preserved
    $upgradeTestCalls.Add("start")
  } else { throw "UNEXPECTED_UPGRADE_PROCESS" }
  $global:LASTEXITCODE = 0
}
function Invoke-RestMethod {
  param($Method, $Uri, $TimeoutSec)
  if ($Method -cne "Get" -or $Uri -cne "http://127.0.0.1:18731/health" -or $upgradeTestCalls.Count -ne 2) {
    throw "UNEXPECTED_UPGRADE_HEALTH_REQUEST"
  }
  return @{ ok=$true; version="0.3.8" }
}
& (Join-Path $PSScriptRoot "../../release/root-cause-write-runtime/upgrade-from-v0.3.7.ps1") -OldRelayDir $oldDir -NewRelayDir $newDir
Assert-Preserved
if (($upgradeTestCalls -join ",") -cne "stop,start") { throw "UPGRADE_PROCESS_ORDER_INVALID" }
Write-Host "UPGRADE_V037_TO_V038_DB_WAL_SHM_TOKEN_PRESERVED_PASS"
