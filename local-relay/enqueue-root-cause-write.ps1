param(
  [Parameter(Mandatory=$true)][string]$PlanFile,
  [Parameter(Mandatory=$true)][string]$ExpectedPlanSha256,
  [Parameter(Mandatory=$true)][string]$TaskUuid,
  [Parameter(Mandatory=$true)][string]$DisplayId,
  [string]$PreviousBlockedJobId = "",
  [string]$RelayUrl = "http://127.0.0.1:18731",
  [string]$TokenFile = (Join-Path $PSScriptRoot "data\relay-token.txt"),
  [string]$ResumeJobId
)
$ErrorActionPreference = "Stop"

if ($RelayUrl -ne "http://127.0.0.1:18731") { throw "RelayUrl must be loopback http://127.0.0.1:18731" }
if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) { throw ("TOKEN_FILE_NOT_FOUND: " + $TokenFile) }
if (-not (Test-Path -LiteralPath $PlanFile -PathType Leaf)) { throw ("PLAN_FILE_NOT_FOUND: " + $PlanFile) }
if ($ExpectedPlanSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw "EXPECTED_PLAN_SHA256_INVALID" }
if ($TaskUuid -notmatch '^[A-Za-z0-9_-]{1,128}$') { throw "TASK_UUID_INVALID" }
if ($DisplayId -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw "DISPLAY_ID_INVALID" }

$planSha = [Security.Cryptography.SHA256]::Create()
try { $actualPlanSha = ([BitConverter]::ToString($planSha.ComputeHash([IO.File]::ReadAllBytes($PlanFile)))).Replace("-","").ToLowerInvariant() } finally { $planSha.Dispose() }
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

$payload = [ordered]@{
  taskTargetPolicy = $plan.taskTargetPolicy
  decision = $target.decision
  writeMode = "fill_empty_only"
  planSha256 = $actualPlanSha
  displayId = $DisplayId
  taskUuid = $TaskUuid
  fieldId = [string]$target.fieldId
  desiredValue = $desiredValue
  desiredSha256 = $desiredHash
}
$idempotencyKey = "root-cause-write-utf8v3-" + $actualPlanSha.Substring(0,12) + "-" + $TaskUuid + "-" + $target.fieldId + "-" + $desiredHash.Substring(0,16)
function Test-ExactWritePayload($observed) {
  if ($observed -isnot [PSCustomObject]) { return $false }
  $names = @($observed.PSObject.Properties.Name)
  if ($names.Count -ne $payload.Count) { return $false }
  foreach ($field in $payload.Keys) {
    if ($names -cnotcontains $field) { return $false }
    $value = $observed.PSObject.Properties[$field].Value
    if ($value -isnot [string] -or -not [string]::Equals($value, $payload[$field], [StringComparison]::Ordinal)) {
      return $false
    }
  }
  return $true
}

$hasParent = -not [string]::IsNullOrWhiteSpace($PreviousBlockedJobId)
if ($hasParent) {
  if ($PreviousBlockedJobId -notmatch '^[A-Za-z0-9-]{1,128}$') { throw "PREVIOUS_BLOCKED_JOB_ID_INVALID" }
  $idempotencyKey += "-after-" + $PreviousBlockedJobId
}
if ($PSBoundParameters.ContainsKey("ResumeJobId")) {
  if ($ResumeJobId -notmatch '\A[A-Za-z0-9-]{1,128}\z') { throw "RESUME_JOB_ID_INVALID" }
  try {
    $receipt = Invoke-RestMethod -Method Get -Uri "$RelayUrl/v1/jobs/$ResumeJobId" -Headers $headers -TimeoutSec 5 -MaximumRedirection 0
  } catch {
    if ($null -ne $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) {
      throw "RESUME_RECEIPT_NOT_FOUND"
    }
    throw "RESUME_RECEIPT_UNAVAILABLE"
  }
  $job = $receipt.job
  if ($receipt.ok -isnot [bool] -or -not $receipt.ok -or $null -eq $job -or $job.jobId -cne $ResumeJobId -or
      $job.jobType -cne "ONES_ROOT_CAUSE_WRITE" -or $job.idempotencyKey -cne $idempotencyKey -or
      -not (Test-ExactWritePayload $job.payload) -or $job.state -isnot [string] -or
      $job.state -cnotmatch '\A[A-Z][A-Z_]{0,63}\z') {
    throw "RESUME_RECEIPT_MISMATCH"
  }
  $action = switch -CaseSensitive ($job.state) {
    "PENDING" { "WAIT_EXISTING_JOB" }
    "CLAIMED" { "WAIT_EXISTING_JOB" }
    "WRITE_VERIFIED" { "CHECK_INDEPENDENT_READBACK_AND_RESTORE" }
    default { "READ_ONLY_RECONCILIATION" }
  }
  [ordered]@{ jobId=$ResumeJobId; state=$job.state; action=$action; newSubmissions=0 } | ConvertTo-Json -Compress
  return
}
if ($hasParent) {
  $parentResponse = Invoke-RestMethod -Method Get -Uri "$RelayUrl/v1/jobs/$PreviousBlockedJobId" -Headers $headers
  $parent = $parentResponse.job
  if ($null -eq $parent) { throw "PREVIOUS_BLOCKED_JOB_NOT_FOUND" }
  if ([string]$parent.jobType -ne "ONES_ROOT_CAUSE_WRITE") { throw "PREVIOUS_JOB_TYPE_INVALID" }
  if ([string]$parent.state -ne "WRITE_BLOCKED") { throw "PREVIOUS_JOB_STATE_INVALID" }
  # JSON member order is irrelevant. The canonical nine string fields are not.
  if (-not (Test-ExactWritePayload $parent.payload)) { throw "PREVIOUS_JOB_PAYLOAD_MISMATCH" }
  if ($null -eq $parent.result -or $parent.result.writeAttempted -ne $false) { throw "PREVIOUS_JOB_WRITE_ATTEMPTED" }
  if ($parent.result.saveDispatched -eq $true) { throw "PREVIOUS_JOB_SAVE_DISPATCHED" }
  $allowed = @("ROOT_CAUSE_LABEL_NOT_UNIQUE", "DRAFT_DOM_MISMATCH")
  if ($allowed -notcontains [string]$parent.result.blockedBy) { throw "PREVIOUS_JOB_BLOCKER_NOT_ALLOWED" }
}
$body = @{

  jobType = "ONES_ROOT_CAUSE_WRITE"
  idempotencyKey = $idempotencyKey
  payload = $payload
} | ConvertTo-Json -Depth 20

$bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
$result = Invoke-RestMethod -Method Post -Uri "$RelayUrl/v1/jobs" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bodyBytes
Write-Host "ROOT_CAUSE_WRITE_JOB_ENQUEUED"
Write-Host ("JOB_ID=" + $result.job.jobId)
Write-Host ("STATE=" + $result.job.state)
Write-Host ("DEDUPLICATED=" + $result.deduplicated)
Write-Host ("PLAN_SHA256=" + $actualPlanSha)
Write-Host ("TASK_UUID=" + $TaskUuid)
Write-Host ("FIELD_ID=" + $target.fieldId)
Write-Host ("DESIRED_SHA256=" + $desiredHash)
$result.job | ConvertTo-Json -Depth 30
