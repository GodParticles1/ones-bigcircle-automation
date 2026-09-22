param(
    [Parameter(Mandatory=$true)][string]$CaseFeedDir,
    [Parameter(Mandatory=$true)][string]$RelayDir,
    [Parameter(Mandatory=$true)][string]$ReconciliationDir,
    [string]$RuntimeDir = (Join-Path $PSScriptRoot "runtime")
)

$ErrorActionPreference = "Stop"

function Write-ResultAndExit {
    param(
        [Parameter(Mandatory=$true)][string]$Status,
        [hashtable]$Fields = @{},
        [int]$ExitCode = 0
    )
    $payload = [ordered]@{
        status = $Status
        observedAt = [DateTime]::UtcNow.ToString("o")
    }
    foreach ($key in $Fields.Keys) {
        $payload[$key] = $Fields[$key]
    }
    $payload | ConvertTo-Json -Depth 12 -Compress
    exit $ExitCode
}

try {
    $caseFeed = Get-ChildItem -LiteralPath $CaseFeedDir -Filter "case-feed-*.json" -File |
        Sort-Object LastWriteTimeUtc, FullName -Descending |
        Select-Object -First 1
    if ($null -eq $caseFeed) {
        Write-ResultAndExit -Status "SYNTHETIC_ALIGNMENT_BLOCKED" -Fields @{ reason = "CASE_FEED_NOT_FOUND" } -ExitCode 2
    }

    $inventoryPath = Join-Path $RelayDir "synthetic-inventory.json"
    if (-not (Test-Path -LiteralPath $inventoryPath -PathType Leaf)) {
        Write-ResultAndExit -Status "SYNTHETIC_ALIGNMENT_BLOCKED" -Fields @{ reason = "SYNTHETIC_INVENTORY_NOT_FOUND" } -ExitCode 2
    }

    $caseSha = (Get-FileHash -LiteralPath $caseFeed.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    $inventorySha = (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash.ToLowerInvariant()

    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    $stateDir = Join-Path $RuntimeDir "reconciliation-state"
    $outputDir = Join-Path $RuntimeDir "reconciliation-output"
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

    $runStage = Join-Path $ReconciliationDir "run-stage.ps1"
    if (-not (Test-Path -LiteralPath $runStage -PathType Leaf)) {
        Write-ResultAndExit -Status "SYNTHETIC_ALIGNMENT_BLOCKED" -Fields @{ reason = "RECONCILIATION_RUNNER_NOT_FOUND" } -ExitCode 2
    }

    Push-Location $ReconciliationDir
    try {
        $lines = @(
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runStage `
                -Inventory $inventoryPath `
                -Cases $caseFeed.FullName `
                -StateDir $stateDir `
                -OutputDir $outputDir 2>&1
        )
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
    }

    $lastLine = $lines | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Last 1
    if ($exitCode -ne 0 -or $null -eq $lastLine) {
        Write-ResultAndExit -Status "SYNTHETIC_ALIGNMENT_BLOCKED" -Fields @{
            reason = "RECONCILIATION_EXECUTION_FAILED"
            caseFeedSha256 = $caseSha
            inventorySha256 = $inventorySha
        } -ExitCode 2
    }

    try {
        $recon = ([string]$lastLine) | ConvertFrom-Json
    } catch {
        Write-ResultAndExit -Status "SYNTHETIC_ALIGNMENT_BLOCKED" -Fields @{
            reason = "RECONCILIATION_RESULT_INVALID"
            caseFeedSha256 = $caseSha
            inventorySha256 = $inventorySha
        } -ExitCode 2
    }

    if ($recon.status -notin @("RECONCILIATION_VERIFIED", "RECONCILIATION_NOOP_VERIFIED")) {
        Write-ResultAndExit -Status "SYNTHETIC_ALIGNMENT_BLOCKED" -Fields @{
            reason = "RECONCILIATION_NOT_VERIFIED"
            reconciliationStatus = $recon.status
            caseFeedSha256 = $caseSha
            inventorySha256 = $inventorySha
        } -ExitCode 2
    }

    Write-ResultAndExit -Status $recon.status -Fields @{
        caseFeedSha256 = $caseSha
        inventorySha256 = $inventorySha
        reconciliationRunKey = $recon.runKey
        reconciliationOutput = $recon.output
    }
} catch {
    Write-ResultAndExit -Status "SYNTHETIC_ALIGNMENT_BLOCKED" -Fields @{
        reason = "UNHANDLED_ERROR"
        detail = $_.Exception.Message
    } -ExitCode 2
}
