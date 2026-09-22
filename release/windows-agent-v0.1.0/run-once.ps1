param()
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Config = Join-Path $Root "config.ps1"
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
    throw "CONFIG_MISSING: run setup.ps1 first"
}
. $Config

if ($BaseUrl -match "REPLACE_WITH") { throw "BASE_URL_NOT_CONFIGURED" }
if (-not (Test-Path -LiteralPath $SecretFile -PathType Leaf)) { throw "WINDOWS_HMAC_SECRET_FILE_MISSING" }
if (-not (Test-Path -LiteralPath $RelayDir -PathType Container)) { throw "RELAY_DIR_MISSING" }
if (-not (Test-Path -LiteralPath $ReconciliationDir -PathType Container)) { throw "RECONCILIATION_DIR_MISSING" }

$Python = "python"
$Client = Join-Path $Root "remote-transport\client.py"
$Agent = Join-Path $Root "windows-agent\run_once.py"
$Periodic = Join-Path $Root "periodic-alignment\run-once.ps1"

Write-Host "[1/3] Pull remote CASE_FEED"
& $Python $Client --base-url $BaseUrl --spool-root $SpoolRoot --role windows-agent --secret-file $SecretFile pull-one
if ($LASTEXITCODE -ne 0) { throw "REMOTE_PULL_FAILED" }

Write-Host "[2/3] Run Windows Agent / read-only reconciliation"
& $Python $Agent `
  --spool-root $SpoolRoot `
  --case-feed-dir $CaseFeedDir `
  --relay-dir $RelayDir `
  --reconciliation-dir $ReconciliationDir `
  --periodic-script $Periodic `
  --runtime-dir $PeriodicRuntimeDir
if ($LASTEXITCODE -ne 0) { throw "WINDOWS_AGENT_RUN_FAILED" }

Write-Host "[3/3] Push RESULT/CHECKPOINT"
for ($i = 0; $i -lt 32; $i++) {
    $output = & $Python $Client --base-url $BaseUrl --spool-root $SpoolRoot --role windows-agent --secret-file $SecretFile push-one --cleanup
    if ($LASTEXITCODE -ne 0) { throw "REMOTE_PUSH_FAILED" }
    Write-Host $output
    try { $doc = $output | ConvertFrom-Json } catch { throw "REMOTE_PUSH_OUTPUT_INVALID" }
    if ($doc.status -eq "EMPTY") { break }
}

Write-Host "WINDOWS_REMOTE_AGENT_RUN_PASS"
