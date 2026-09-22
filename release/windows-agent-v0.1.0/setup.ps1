param()
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Config = Join-Path $Root "config.ps1"
$Example = Join-Path $Root "config.example.ps1"

if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
    Copy-Item -LiteralPath $Example -Destination $Config
    Write-Host "Created config.ps1 from template."
}

. $Config

foreach ($dir in @(
    (Join-Path $Root "data"),
    $SpoolRoot,
    (Join-Path $SpoolRoot "inbox"),
    (Join-Path $SpoolRoot "claimed"),
    (Join-Path $SpoolRoot "processed"),
    (Join-Path $SpoolRoot "rejected"),
    (Join-Path $SpoolRoot "outbox"),
    $CaseFeedDir,
    $AgentRuntimeDir
)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

if ($BaseUrl -match "REPLACE_WITH") {
    Write-Warning "Edit config.ps1 and set BaseUrl before runtime."
}
if (-not (Test-Path -LiteralPath $SecretFile -PathType Leaf)) {
    Write-Warning ("Create the Windows transport HMAC secret file locally: " + $SecretFile)
}
if (-not (Test-Path -LiteralPath $RelayDir -PathType Container)) {
    Write-Warning ("RelayDir not found: " + $RelayDir)
}
if (-not (Test-Path -LiteralPath $ReconciliationDir -PathType Container)) {
    Write-Warning ("ReconciliationDir not found: " + $ReconciliationDir)
}

Write-Host "WINDOWS_REMOTE_AGENT_SETUP_READY"
Write-Host ("Root=" + $Root)
Write-Host ("Config=" + $Config)
