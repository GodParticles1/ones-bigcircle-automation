param([string]$OutputDir = (Join-Path $PSScriptRoot "..\dist-root-cause-write"))
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$bridgeName = "ones-browser-bridge-v0.5.17"
$relayName = "ones-local-relay-v0.3.7"
$bridgeStage = Join-Path $OutputDir $bridgeName
$relayStage = Join-Path $OutputDir $relayName
foreach ($p in @($bridgeStage,$relayStage)) {
  if (Test-Path $p) { Remove-Item $p -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $p | Out-Null
}

foreach ($name in @("manifest.json","service-worker.js","root-cause-writer.js","popup.html","popup.js","popup.css","README.md")) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot ("browser-bridge\" + $name)) -Destination (Join-Path $bridgeStage $name) -Force
}
foreach ($name in @("relay.py","start.ps1","stop.ps1","start-foreground.ps1","show-status.ps1","enqueue-ping.ps1","enqueue-inventory.ps1","enqueue-root-cause-write.ps1","enqueue-root-cause-format-repair.ps1","job-example.json","job-inventory-example.json","README.md")) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot ("local-relay\" + $name)) -Destination (Join-Path $relayStage $name) -Force
}
Copy-Item -LiteralPath (Join-Path $RepoRoot "release\root-cause-write-runtime\upgrade-from-v0.3.6.ps1") -Destination (Join-Path $relayStage "upgrade-from-v0.3.6.ps1") -Force

$manifest = Get-Content -LiteralPath (Join-Path $bridgeStage "manifest.json") -Raw | ConvertFrom-Json
if ($manifest.version -ne "0.5.17") { throw "BRIDGE_VERSION_MISMATCH" }
if ($manifest.permissions -notcontains "debugger") { throw "BRIDGE_DEBUGGER_PERMISSION_MISSING" }

$worker = Get-Content -LiteralPath (Join-Path $bridgeStage "service-worker.js") -Raw
$writer = Get-Content -LiteralPath (Join-Path $bridgeStage "root-cause-writer.js") -Raw
if ($worker -notmatch '"ONES_ROOT_CAUSE_WRITE"') { throw "BRIDGE_WRITE_CAPABILITY_MISSING" }
if ($worker -notmatch 'u\.pathname \+ u\.search \+ u\.hash') { throw "BRIDGE_HASH_ROUTE_FIELD_READ_GUARD_MISSING" }
if ($worker -notmatch 'writeEnabled') { throw "BRIDGE_WRITE_GATE_MISSING" }
if ($writer -notmatch 'UNIQUE_ONES_TASK_ONLY') { throw "TASK_TARGET_POLICY_MISSING" }
if ($writer -notmatch 'fill_empty_only') { throw "FILL_EMPTY_ONLY_MISSING" }
if ($writer -notmatch 'desiredSha256') { throw "DESIRED_HASH_GATE_MISSING" }
if ($writer -notmatch 'DESIRED_VALUE_HASH_MISMATCH') { throw "DESIRED_HASH_MISMATCH_GATE_MISSING" }
if ($writer -notmatch 'FORMAT_REPAIR_VERIFIED') { throw "FORMAT_REPAIR_GATE_MISSING" }
if ($writer -match 'tasks/update3') { throw "DIRECT_RICHTEXT_UPDATE3_FORBIDDEN" }

$relay = Get-Content -LiteralPath (Join-Path $relayStage "relay.py") -Raw
if ($relay -notmatch 'VERSION = "0\.3\.7"') { throw "RELAY_VERSION_MISMATCH" }
if ($relay -notmatch '"ONES_ROOT_CAUSE_WRITE"') { throw "RELAY_WRITE_JOB_MISSING" }

[void][scriptblock]::Create((Get-Content (Join-Path $relayStage "upgrade-from-v0.3.6.ps1") -Raw))
$upgradeHelper = Get-Content -LiteralPath (Join-Path $relayStage "upgrade-from-v0.3.6.ps1") -Raw
if ($upgradeHelper -notmatch 'ones-local-relay-v0\.3\.6') { throw "RELAY_V037_UPGRADE_SOURCE_MISMATCH" }
[void][scriptblock]::Create((Get-Content (Join-Path $relayStage "enqueue-root-cause-write.ps1") -Raw))
$writeHelper = Get-Content -LiteralPath (Join-Path $relayStage "enqueue-root-cause-write.ps1") -Raw
if ($writeHelper -notmatch 'root-cause-write-utf8v3-') { throw "WRITE_IDEMPOTENCY_V3_MISSING" }
if ($writeHelper -match 'root-cause-write-utf8v2-') { throw "WRITE_IDEMPOTENCY_V2_STALE" }
if ($writeHelper -notmatch 'PreviousBlockedJobId' -or $writeHelper -notmatch 'ROOT_CAUSE_LABEL_NOT_UNIQUE' -or $writeHelper -notmatch 'PREVIOUS_JOB_PAYLOAD_MISMATCH' -or $writeHelper -notmatch '-after-') { throw "PREINPUT_REATTEMPT_CONTRACT_MISSING" }
[void][scriptblock]::Create((Get-Content (Join-Path $relayStage "enqueue-root-cause-format-repair.ps1") -Raw))
$formatHelper = Get-Content -LiteralPath (Join-Path $relayStage "enqueue-root-cause-format-repair.ps1") -Raw
if ($formatHelper -notmatch 'root-cause-format-left-v2-') { throw "FORMAT_REPAIR_IDEMPOTENCY_V2_MISSING" }
if ($formatHelper -match 'root-cause-format-left-v1-') { throw "FORMAT_REPAIR_IDEMPOTENCY_V1_STALE" }

$bridgeZip = Join-Path $OutputDir ($bridgeName + ".zip")
$relayZip = Join-Path $OutputDir ($relayName + ".zip")
foreach ($z in @($bridgeZip,$relayZip)) { if (Test-Path $z) { Remove-Item $z -Force } }
Compress-Archive -Path $bridgeStage -DestinationPath $bridgeZip -CompressionLevel Optimal
Compress-Archive -Path $relayStage -DestinationPath $relayZip -CompressionLevel Optimal

# Verify the shipped canonical helper, not only the staging copy.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($relayZip)
try {
  $entries = @($archive.Entries | Where-Object { ($_.FullName -replace '\\', '/') -eq ($relayName + '/enqueue-root-cause-write.ps1') })
  if ($entries.Count -ne 1) { throw "PACKAGED_WRITE_HELPER_NOT_UNIQUE" }
  $reader = [IO.StreamReader]::new($entries[0].Open())
  try { $packagedHelper = $reader.ReadToEnd() } finally { $reader.Dispose() }
  if ($packagedHelper -cne $writeHelper) { throw "PACKAGED_WRITE_HELPER_MISMATCH" }
} finally { $archive.Dispose() }

$bridgeHash=(Get-FileHash $bridgeZip -Algorithm SHA256).Hash.ToLowerInvariant()
$relayHash=(Get-FileHash $relayZip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($bridgeZip + ".sha256") -Value ($bridgeHash + "  " + [IO.Path]::GetFileName($bridgeZip)) -Encoding ASCII
Set-Content -LiteralPath ($relayZip + ".sha256") -Value ($relayHash + "  " + [IO.Path]::GetFileName($relayZip)) -Encoding ASCII

Write-Host "ROOT_CAUSE_WRITE_RUNTIME_PACKAGE_PASS"
Write-Host ("BRIDGE_SHA256=" + $bridgeHash)
Write-Host ("RELAY_SHA256=" + $relayHash)
