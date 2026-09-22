param([string]$OutputDir = (Join-Path $PSScriptRoot "..\dist-field-read"))
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$bridgeName = "ones-browser-bridge-public-v0.4.2"
$relayName = "ones-local-relay-v0.2.2"
$bridgeStage = Join-Path $OutputDir $bridgeName
$relayStage = Join-Path $OutputDir $relayName
foreach ($p in @($bridgeStage,$relayStage)) { if (Test-Path $p) { Remove-Item $p -Recurse -Force }; New-Item -ItemType Directory -Force -Path $p | Out-Null }

foreach ($name in @("manifest.json","service-worker.js","popup.html","popup.js","popup.css","README.md")) {
    Copy-Item -LiteralPath (Join-Path $RepoRoot ("browser-bridge\" + $name)) -Destination (Join-Path $bridgeStage $name) -Force
}

foreach ($name in @("relay.py","start.ps1","stop.ps1","start-foreground.ps1","show-status.ps1","enqueue-ping.ps1","enqueue-inventory.ps1","job-example.json","job-inventory-example.json","README.md")) {
    Copy-Item -LiteralPath (Join-Path $RepoRoot ("local-relay\" + $name)) -Destination (Join-Path $relayStage $name) -Force
}
Copy-Item -LiteralPath (Join-Path $RepoRoot "release\field-read-runtime\upgrade-from-v0.2.1.ps1") -Destination (Join-Path $relayStage "upgrade-from-v0.2.1.ps1") -Force

$bridgeManifest = Get-Content -LiteralPath (Join-Path $bridgeStage "manifest.json") -Raw | ConvertFrom-Json
if ($bridgeManifest.version -ne "0.4.2") { throw "BRIDGE_VERSION_MISMATCH" }
$relayText = Get-Content -LiteralPath (Join-Path $relayStage "relay.py") -Raw
if ($relayText -notmatch 'VERSION = "0\.2\.2"') { throw "RELAY_VERSION_MISMATCH" }
if ($relayText -notmatch '"ONES_FIELD_READ"') { throw "RELAY_FIELD_READ_MISSING" }
$sw = Get-Content -LiteralPath (Join-Path $bridgeStage "service-worker.js") -Raw
if ($sw -notmatch '"ONES_FIELD_READ"') { throw "BRIDGE_FIELD_READ_MISSING" }
if ($sw -notmatch 'http://127\.0\.0\.1:18731') { throw "BRIDGE_LOOPBACK_RELAY_MISSING" }

$bridgeZip = Join-Path $OutputDir ($bridgeName + ".zip")
$relayZip = Join-Path $OutputDir ($relayName + ".zip")
foreach ($z in @($bridgeZip,$relayZip)) { if (Test-Path $z) { Remove-Item $z -Force } }
Compress-Archive -Path $bridgeStage -DestinationPath $bridgeZip -CompressionLevel Optimal
Compress-Archive -Path $relayStage -DestinationPath $relayZip -CompressionLevel Optimal

$bridgeHash = (Get-FileHash $bridgeZip -Algorithm SHA256).Hash.ToLowerInvariant()
$relayHash = (Get-FileHash $relayZip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($bridgeZip + ".sha256") -Value ($bridgeHash + "  " + [IO.Path]::GetFileName($bridgeZip)) -Encoding ASCII
Set-Content -LiteralPath ($relayZip + ".sha256") -Value ($relayHash + "  " + [IO.Path]::GetFileName($relayZip)) -Encoding ASCII

Write-Host "FIELD_READ_RUNTIME_PACKAGE_BUILD_PASS"
Write-Host ("BRIDGE_SHA256=" + $bridgeHash)
Write-Host ("RELAY_SHA256=" + $relayHash)
