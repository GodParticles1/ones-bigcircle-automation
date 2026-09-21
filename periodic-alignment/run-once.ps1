param(
    [Parameter(Mandatory=$true)][string]$CaseFeedDir,
    [Parameter(Mandatory=$true)][string]$RelayDir,
    [Parameter(Mandatory=$true)][string]$ReconciliationDir,
    [string]$RuntimeDir = (Join-Path $PSScriptRoot "runtime"),
    [int]$InventoryTimeoutSeconds = 180,
    [int]$ExecutorFreshSeconds = 150,
    [int]$PollIntervalSeconds = 2
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

function Get-ValidCaseFeed {
    param([Parameter(Mandatory=$true)][string]$Directory)

    if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
        return $null
    }

    $candidates = @()
    foreach ($file in Get-ChildItem -LiteralPath $Directory -Filter "*.json" -File -ErrorAction SilentlyContinue) {
        try {
            $doc = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($doc.schema -ne "bigcircle.confirmed-case-export/v1alpha1") { continue }
            if ($doc.complete -ne $true) { continue }
            if ($null -eq $doc.cases) { continue }
            $cases = @($doc.cases)
            if ([int]$doc.exportedCaseCount -ne $cases.Count) { continue }
            if (@($cases | Where-Object { $_.caseStatus -ne "CONFIRMED_REAL_CASE" }).Count -ne 0) { continue }
            $candidates += $file
        } catch {
            continue
        }
    }

    if ($candidates.Count -eq 0) { return $null }
    return $candidates | Sort-Object LastWriteTimeUtc, FullName -Descending | Select-Object -First 1
}

function Get-RelayHeaders {
    param([Parameter(Mandatory=$true)][string]$RelayDirectory)
    $tokenPath = Join-Path $RelayDirectory "data\relay-token.txt"
    if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
        return $null
    }
    $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($token)) { return $null }
    return @{ "X-Relay-Token" = $token }
}

try {
    $caseFeed = Get-ValidCaseFeed -Directory $CaseFeedDir
    if ($null -eq $caseFeed) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_BIGCIRCLE" -Fields @{
            reason = "NO_VALID_CASE_FEED"
        }
    }

    $caseSha = (Get-FileHash -LiteralPath $caseFeed.FullName -Algorithm SHA256).Hash.ToLowerInvariant()

    $headers = Get-RelayHeaders -RelayDirectory $RelayDir
    if ($null -eq $headers) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_RELAY" -Fields @{
            reason = "RELAY_TOKEN_UNAVAILABLE"
            caseFeedFile = $caseFeed.Name
            caseFeedSha256 = $caseSha
        }
    }

    try {
        $health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18731/health" -TimeoutSec 5
    } catch {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_RELAY" -Fields @{
            reason = "RELAY_HEALTH_UNAVAILABLE"
            caseFeedFile = $caseFeed.Name
            caseFeedSha256 = $caseSha
        }
    }

    if ($health.ok -ne $true) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_RELAY" -Fields @{
            reason = "RELAY_HEALTH_NOT_OK"
            caseFeedFile = $caseFeed.Name
            caseFeedSha256 = $caseSha
        }
    }

    try {
        $stats = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18731/v1/stats" -Headers $headers -TimeoutSec 5
    } catch {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_RELAY" -Fields @{
            reason = "RELAY_STATS_UNAVAILABLE"
            caseFeedFile = $caseFeed.Name
            caseFeedSha256 = $caseSha
        }
    }

    $freshThreshold = [DateTime]::UtcNow.AddSeconds(-1 * $ExecutorFreshSeconds)
    $executor = @($stats.executors) |
        Where-Object {
            $_.onesTabCount -gt 0 -and
            @($_.capabilities) -contains "ONES_INVENTORY_READ" -and
            ([DateTime]$_.lastSeenAt).ToUniversalTime() -ge $freshThreshold
        } |
        Sort-Object { ([DateTime]$_.lastSeenAt).ToUniversalTime() } -Descending |
        Select-Object -First 1

    if ($null -eq $executor) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_EXECUTOR" -Fields @{
            reason = "NO_FRESH_READONLY_BROWSER_EXECUTOR"
            caseFeedFile = $caseFeed.Name
            caseFeedSha256 = $caseSha
        }
    }

    $idempotencyKey = "periodic-inventory-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $body = @{
        jobType = "ONES_INVENTORY_READ"
        idempotencyKey = $idempotencyKey
        payload = @{
            requestedAt = [DateTime]::UtcNow.ToString("o")
            source = "periodic-alignment/run-once.ps1"
        }
    } | ConvertTo-Json -Depth 6

    try {
        $queued = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:18731/v1/jobs" -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 10
    } catch {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_RELAY" -Fields @{
            reason = "INVENTORY_ENQUEUE_FAILED"
            caseFeedFile = $caseFeed.Name
            caseFeedSha256 = $caseSha
        }
    }

    $jobId = $queued.job.jobId
    if ([string]::IsNullOrWhiteSpace($jobId)) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_BLOCKED" -Fields @{
            reason = "INVENTORY_JOB_ID_MISSING"
        } -ExitCode 2
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($InventoryTimeoutSeconds)
    $job = $null
    while ([DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Seconds $PollIntervalSeconds
        try {
            $jobResponse = Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:18731/v1/jobs/" + $jobId) -Headers $headers -TimeoutSec 10
            $job = $jobResponse.job
        } catch {
            continue
        }
        if ($job.state -notin @("PENDING", "CLAIMED")) { break }
    }

    if ($null -eq $job -or $job.state -in @("PENDING", "CLAIMED")) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_ONES" -Fields @{
            reason = "INVENTORY_TIMEOUT"
            relayJobId = $jobId
            caseFeedFile = $caseFeed.Name
            caseFeedSha256 = $caseSha
        }
    }

    $inventory = $job.result
    $tickets = @($inventory.tickets)
    $countsMatch = (
        $inventory.ticketCount -is [int] -or
        $inventory.ticketCount -is [long]
    ) -and (
        [int64]$inventory.ticketCount -eq [int64]$inventory.serverTotalCount
    ) -and (
        [int64]$inventory.ticketCount -eq [int64]$inventory.visiblePageTotal
    ) -and (
        [int64]$inventory.ticketCount -eq [int64]$tickets.Count
    )

    if (
        $job.state -ne "INVENTORY_VERIFIED" -or
        $inventory.status -ne "INVENTORY_VERIFIED" -or
        $inventory.readOnly -ne $true -or
        $inventory.inventoryComplete -ne $true -or
        $inventory.reconciliationAllowed -ne $true -or
        -not $countsMatch
    ) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_WAIT_ONES" -Fields @{
            reason = "INVENTORY_NOT_VERIFIED"
            relayJobId = $jobId
            inventoryState = $job.state
            inventoryStatus = $inventory.status
            caseFeedFile = $caseFeed.Name
            caseFeedSha256 = $caseSha
        }
    }

    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    $inventoryDir = Join-Path $RuntimeDir "inventory"
    $stateDir = Join-Path $RuntimeDir "reconciliation-state"
    $outputDir = Join-Path $RuntimeDir "reconciliation-output"
    New-Item -ItemType Directory -Force -Path $inventoryDir | Out-Null
    New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

    $stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
    $inventoryPath = Join-Path $inventoryDir ("ones-inventory-" + $stamp + ".json")
    $inventory | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $inventoryPath -Encoding UTF8
    $inventorySha = (Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash.ToLowerInvariant()

    $runStage = Join-Path $ReconciliationDir "run-stage.ps1"
    if (-not (Test-Path -LiteralPath $runStage -PathType Leaf)) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_BLOCKED" -Fields @{
            reason = "RECONCILIATION_RUNNER_NOT_FOUND"
            caseFeedSha256 = $caseSha
            inventorySha256 = $inventorySha
        } -ExitCode 2
    }

    $reconLines = @(
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runStage             -Inventory $inventoryPath             -Cases $caseFeed.FullName             -StateDir $stateDir             -OutputDir $outputDir 2>&1
    )
    $reconExit = $LASTEXITCODE
    $lastLine = $reconLines | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Last 1

    if ($reconExit -ne 0 -or $null -eq $lastLine) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_BLOCKED" -Fields @{
            reason = "RECONCILIATION_EXECUTION_FAILED"
            caseFeedSha256 = $caseSha
            inventorySha256 = $inventorySha
        } -ExitCode 2
    }

    try {
        $recon = ([string]$lastLine) | ConvertFrom-Json
    } catch {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_BLOCKED" -Fields @{
            reason = "RECONCILIATION_RESULT_INVALID"
            caseFeedSha256 = $caseSha
            inventorySha256 = $inventorySha
        } -ExitCode 2
    }

    if ($recon.status -notin @("RECONCILIATION_VERIFIED", "RECONCILIATION_NOOP_VERIFIED")) {
        Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_BLOCKED" -Fields @{
            reason = "RECONCILIATION_NOT_VERIFIED"
            reconciliationStatus = $recon.status
            caseFeedSha256 = $caseSha
            inventorySha256 = $inventorySha
        } -ExitCode 2
    }

    Write-ResultAndExit -Status $recon.status -Fields @{
        caseFeedFile = $caseFeed.FullName
        caseFeedSha256 = $caseSha
        inventoryFile = $inventoryPath
        inventorySha256 = $inventorySha
        inventoryCapturedAt = $inventory.capturedAt
        inventoryTicketCount = $inventory.ticketCount
        relayJobId = $jobId
        reconciliationRunKey = $recon.runKey
        reconciliationOutput = $recon.output
    }
} catch {
    Write-ResultAndExit -Status "PERIODIC_ALIGNMENT_BLOCKED" -Fields @{
        reason = "UNHANDLED_ERROR"
        detail = $_.Exception.Message
    } -ExitCode 2
}
