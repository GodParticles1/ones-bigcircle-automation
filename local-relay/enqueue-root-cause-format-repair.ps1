param(
  [Parameter(Mandatory=$true)][string]$PlanFile,
  [Parameter(Mandatory=$true)][string]$ExpectedPlanSha256,
  [Parameter(Mandatory=$true)][string]$TaskUuid,
  [Parameter(Mandatory=$true)][string]$DisplayId,
  [string]$RelayUrl = "http://127.0.0.1:18731",
  [string]$TokenFile = (Join-Path $PSScriptRoot "data\relay-token.txt")
)
$ErrorActionPreference = "Stop"
if ($RelayUrl -ne "http://127.0.0.1:18731") { throw "RelayUrl must be loopback" }
if (-not (Test-Path -LiteralPath $PlanFile -PathType Leaf)) { throw "PLAN_FILE_NOT_FOUND" }
if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) { throw "TOKEN_FILE_NOT_FOUND" }
$actualPlanSha=(Get-FileHash -LiteralPath $PlanFile -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualPlanSha -ne $ExpectedPlanSha256.ToLowerInvariant()) { throw "PLAN_SHA256_MISMATCH" }
$plan=Get-Content -LiteralPath $PlanFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($plan.taskTargetPolicy -ne "UNIQUE_ONES_TASK_ONLY") { throw "TASK_TARGET_POLICY_INVALID" }
$targets=@($plan.taskTargets | Where-Object { $_.matchedOnesTaskUuid -eq $TaskUuid })
if ($targets.Count -ne 1) { throw "TASK_TARGET_NOT_UNIQUE" }
$target=$targets[0]
$expected=([string]$target.proposedValue).Trim()
if ([string]::IsNullOrWhiteSpace($expected)) { throw "EXPECTED_VALUE_EMPTY" }
if ($expected.Length -gt 300 -or $expected -match '[\r\n]') { throw "EXPECTED_VALUE_OUTSIDE_BOUND" }
if ([string]::IsNullOrWhiteSpace([string]$target.fieldId)) { throw "FIELD_ID_MISSING" }
$bytes=[Text.Encoding]::UTF8.GetBytes($expected)
$sha=[Security.Cryptography.SHA256]::Create()
try { $expectedSha=([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-","").ToLowerInvariant() } finally { $sha.Dispose() }
$token=(Get-Content -LiteralPath $TokenFile -Raw).Trim()
$headers=@{ "X-Relay-Token" = $token }
$body=@{
  jobType="ONES_ROOT_CAUSE_FORMAT_REPAIR"
  idempotencyKey=("root-cause-format-left-v1-" + $actualPlanSha.Substring(0,12) + "-" + $TaskUuid + "-" + $target.fieldId + "-" + $expectedSha.Substring(0,16))
  payload=@{
    formatPolicy="EXACT_VALUE_LEFT_ALIGN_ONLY"
    planSha256=$actualPlanSha
    displayId=$DisplayId
    taskUuid=$TaskUuid
    fieldId=[string]$target.fieldId
    expectedValue=$expected
    expectedValueSha256=$expectedSha
  }
} | ConvertTo-Json -Depth 20
$bodyBytes=[Text.Encoding]::UTF8.GetBytes($body)
$result=Invoke-RestMethod -Method Post -Uri "$RelayUrl/v1/jobs" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bodyBytes
Write-Host "ROOT_CAUSE_FORMAT_REPAIR_ENQUEUED"
Write-Host ("JOB_ID=" + $result.job.jobId)
Write-Host ("STATE=" + $result.job.state)
Write-Host ("EXPECTED_VALUE_SHA256=" + $expectedSha)
$result.job | ConvertTo-Json -Depth 30
