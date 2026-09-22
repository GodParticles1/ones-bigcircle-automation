param()
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Config = Join-Path $Root "config.ps1"
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
    Write-Host "CONFIG=missing"
    exit 2
}
. $Config

function Count-Files([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return 0 }
    return @(Get-ChildItem -LiteralPath $Path -Filter "env-*.json" -File -ErrorAction SilentlyContinue).Count
}

Write-Host "VERSION=0.1.0"
Write-Host ("BASE_URL_CONFIGURED=" + (-not ($BaseUrl -match "REPLACE_WITH")))
Write-Host ("SECRET_FILE_PRESENT=" + (Test-Path -LiteralPath $SecretFile -PathType Leaf))
Write-Host ("RELAY_DIR_PRESENT=" + (Test-Path -LiteralPath $RelayDir -PathType Container))
Write-Host ("RECONCILIATION_DIR_PRESENT=" + (Test-Path -LiteralPath $ReconciliationDir -PathType Container))
Write-Host ("SPOOL_INBOX=" + (Count-Files (Join-Path $SpoolRoot "inbox")))
Write-Host ("SPOOL_CLAIMED=" + (Count-Files (Join-Path $SpoolRoot "claimed")))
Write-Host ("SPOOL_PROCESSED=" + (Count-Files (Join-Path $SpoolRoot "processed")))
Write-Host ("SPOOL_REJECTED=" + (Count-Files (Join-Path $SpoolRoot "rejected")))
Write-Host ("SPOOL_OUTBOX=" + (Count-Files (Join-Path $SpoolRoot "outbox")))
