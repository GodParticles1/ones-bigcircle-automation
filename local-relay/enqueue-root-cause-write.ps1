param(
  [Parameter(Mandatory=$true)][string]$PlanFile,
  [Parameter(Mandatory=$true)][string]$ExpectedPlanSha256,
  [Parameter(Mandatory=$true)][string]$TaskUuid,
  [Parameter(Mandatory=$true)][string]$DisplayId,
  [string]$RelayUrl = "http://127.0.0.1:18731",
  [string]$TokenFile = (Join-Path $PSScriptRoot "data\relay-token.txt")
)
$ErrorActionPreference = "Stop"

if ($RelayUrl -ne "http://127.0.0.1:18731") { throw "RelayUrl must be loopback http://127.0.0.1:18731" }
if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) { throw ("TOKEN_FILE_NOT_FOUND: " + $TokenFile) }
if (-not (Test-Path -LiteralPath $PlanFile -PathType Leaf)) { throw ("PLAN_FILE_NOT_FOUND: " + $PlanFile) }
if ($ExpectedPlanSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw "EXPECTED_PLAN_SHA256_INVALID" }
if ($TaskUuid -notmatch '^[A-Za-z0-9_-]{1,128}$') { throw "TASK_UUID_INVALID" }
if ($DisplayId -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw "DISPLAY_ID_INVALID" }

$actualPlanSha = (Get-FileHash -LiteralPath $PlanFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualPlanSha -ne $ExpectedPlanSha256.ToLowerInvariant()) { throw ("PLAN_SHA256_MISMATCH actual=" + $actualPlanSha) }

$plan = Get-Content -LiteralPath $PlanFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($plan.status -ne "PLAN_READY") { throw "PLAN_NOT_READY" }
if ($plan.taskTargetPolicy -ne "UNIQUE_ONES_TASK_ONLY") { throw "TASK_TARGET_POLICY_INVALID" }

$targets = @($plan.taskTargets | Where-Object { $_.matchedOnesTaskUuid -eq $TaskUuid })
if ($targets.Count -ne 1) { throw ("TASK_TARGET_NOT_UNIQUE count=" + $targets.Count) }
$target = $targets[0]
if ($target.decision -ne "SET_CANDIDATE") { throw ("TARGET_NOT_SET_CANDIDATE decision=" + $target.decision) }
if ($target.distinctConfirmedRootCauseCount -ne 1) { throw "CONFIRMED_ROOT_CAUSE_NOT_UNIQUE" }
if ([string]::IsNullOrWhiteSpace([string]$target.fieldId)) { throw "FIELD_ID_MISSING" }
if ($target.fieldId -notmatch '^[A-Za-z0-9_-]{1,128}$') { throw "FIELD_ID_INVALID" }
$desiredValue = ([string]$target.proposedValue).Trim()
if ([string]::IsNullOrWhiteSpace($desiredValue)) { throw "PROPOSED_VALUE_EMPTY" }
if ($desiredValue.Length -gt 300 -or $desiredValue -match '[\r\n]') { throw "PROPOSED_VALUE_OUTSIDE_BOUNDED_WRITER_V1" }
$currentValue = if ($null -eq $target.currentValue) { "" } else { ([string]$target.currentValue).Trim() }
if ($currentValue -ne "") { throw "PLAN_CURRENT_VALUE_NOT_BLANK" }

$token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
$headers = @{ "X-Relay-Token" = $token }
$desiredBytes = [Text.Encoding]::UTF8.GetBytes($desiredValue)
$sha = [Security.Cryptography.SHA256]::Create()
try { $desiredHash = ([BitConverter]::ToString($sha.ComputeHash($desiredBytes))).Replace("-","").ToLowerInvariant() } finally { $sha.Dispose() }

$idempotencyKey = "root-cause-write-" + $actualPlanSha.Substring(0,12) + "-" + $TaskUuid + "-" + $target.fieldId + "-" + $desiredHash.Substring(0,16)
$body = @{
  jobType = "ONES_ROOT_CAUSE_WRITE"
  idempotencyKey = $idempotencyKey
  payload = @{
    taskTargetPolicy = $plan.taskTargetPolicy
    decision = $target.decision
    writeMode = "fill_empty_only"
    planSha256 = $actualPlanSha
    displayId = $DisplayId
    taskUuid = $TaskUuid
    fieldId = [string]$target.fieldId
    desiredValue = $desiredValue
  }
} | ConvertTo-Json -Depth 20

$result = Invoke-RestMethod -Method Post -Uri "$RelayUrl/v1/jobs" -Headers $headers -ContentType "application/json" -Body $body
Write-Host "ROOT_CAUSE_WRITE_JOB_ENQUEUED"
Write-Host ("JOB_ID=" + $result.job.jobId)
Write-Host ("STATE=" + $result.job.state)
Write-Host ("DEDUPLICATED=" + $result.deduplicated)
Write-Host ("PLAN_SHA256=" + $actualPlanSha)
Write-Host ("TASK_UUID=" + $TaskUuid)
Write-Host ("FIELD_ID=" + $target.fieldId)
Write-Host ("DESIRED_SHA256=" + $desiredHash)
$result.job | ConvertTo-Json -Depth 30
