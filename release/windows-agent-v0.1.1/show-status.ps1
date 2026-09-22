param()
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Config = Join-Path $Root "config.ps1"
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
    Write-Host "CONFIG=missing"
    exit 2
}
. $Config

Write-Host "VERSION=0.1.1"
Write-Host "MODE=LOCAL_PROVIDER_NEUTRAL"
Write-Host ("CASE_FEED_DIR_PRESENT=" + (Test-Path -LiteralPath $CaseFeedDir -PathType Container))
Write-Host ("RELAY_DIR_PRESENT=" + (Test-Path -LiteralPath $RelayDir -PathType Container))
Write-Host ("RECONCILIATION_DIR_PRESENT=" + (Test-Path -LiteralPath $ReconciliationDir -PathType Container))
Write-Host ("RUNTIME_DIR_PRESENT=" + (Test-Path -LiteralPath $RuntimeDir -PathType Container))
Write-Host "REMOTE_BASE_URL_REQUIRED=false"
Write-Host "CLOUDFLARE_API_KEY_REQUIRED=false"
Write-Host "HTTPS_TRANSPORT_REQUIRED=false"
