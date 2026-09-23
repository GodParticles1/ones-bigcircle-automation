param(
  [Parameter(Mandatory=$true)][string]$DisplayId,
  [Parameter(Mandatory=$true)][string]$TaskUuid,
  [Parameter(Mandatory=$true)][string]$FieldId,
  [Parameter(Mandatory=$true)][string]$DesiredValue,
  [Parameter(Mandatory=$true)][string]$PlanSha256,
  [string]$RelayUrl = "http://127.0.0.1:18731",
  [string]$TokenFile = (Join-Path $PSScriptRoot "data\relay-token.txt")
)
$ErrorActionPreference = "Stop"

if ($RelayUrl -ne "http://127.0.0.1:18731") { throw "RelayUrl must be loopback http://127.0.0.1:18731" }
if (-not (Test-Path -LiteralPath $TokenFile -PathType Leaf)) { throw ("TOKEN_FILE_NOT_FOUND: " + $TokenFile) }
if ($PlanSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw "PLAN_SHA256_INVALID" }
foreach ($pair in @(@("DisplayId",$DisplayId),@("TaskUuid",$TaskUuid),@("FieldId",$FieldId))) {
  if ($pair[1] -notmatch '^[A-Za-z0-9_.-]{1,128}$') { throw ($pair[0] + "_INVALID") }
}
$DesiredValue = $DesiredValue.Trim()
if ([string]::IsNullOrWhiteSpace($DesiredValue) -or $DesiredValue.Length -gt 2000) { throw "DESIRED_VALUE_INVALID" }

$token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
$headers = @{ "X-Relay-Token" = $token }

$desiredBytes = [Text.Encoding]::UTF8.GetBytes($DesiredValue)
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $desiredHash = ([BitConverter]::ToString($sha.ComputeHash($desiredBytes))).Replace("-","").ToLowerInvariant()
} finally { $sha.Dispose() }

$body = @{
  jobType = "ONES_ROOT_CAUSE_WRITE"
  idempotencyKey = ("root-cause-write-" + $TaskUuid + "-" + $FieldId + "-" + $desiredHash.Substring(0,16))
  payload = @{
    taskTargetPolicy = "UNIQUE_ONES_TASK_ONLY"
    decision = "SET_CANDIDATE"
    writeMode = "fill_empty_only"
    planSha256 = $PlanSha256.ToLowerInvariant()
    displayId = $DisplayId
    taskUuid = $TaskUuid
    fieldId = $FieldId
    desiredValue = $DesiredValue
  }
} | ConvertTo-Json -Depth 10

$result = Invoke-RestMethod -Method Post -Uri "$RelayUrl/v1/jobs" -Headers $headers -ContentType "application/json" -Body $body
Write-Host ("JOB_ID=" + $result.job.jobId)
Write-Host ("STATE=" + $result.job.state)
Write-Host ("DEDUPLICATED=" + $result.deduplicated)
Write-Host ("DESIRED_SHA256=" + $desiredHash)
$result.job | ConvertTo-Json -Depth 20
