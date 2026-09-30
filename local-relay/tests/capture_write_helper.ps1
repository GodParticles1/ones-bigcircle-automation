param(
  [Parameter(Mandatory=$true)][string]$HelperPath,
  [Parameter(Mandatory=$true)][string]$PlanFile,
  [Parameter(Mandatory=$true)][string]$ExpectedPlanSha256,
  [Parameter(Mandatory=$true)][string]$TaskUuid,
  [Parameter(Mandatory=$true)][string]$DisplayId,
  [Parameter(Mandatory=$true)][string]$TokenFile,
  [Parameter(Mandatory=$true)][string]$CaptureFile
)
$ErrorActionPreference = "Stop"

# Test-only transport boundary: run the real helper but never contact a Relay.
# Python subsequently enqueues these captured synthetic bytes into its isolated test Relay.
function Invoke-RestMethod {
  param($Method, $Uri, $Headers, $ContentType, $Body)
  if ($Method -ne "Post" -or $Uri -ne "http://127.0.0.1:18731/v1/jobs") { throw "UNEXPECTED_HELPER_REQUEST" }
  if ($ContentType -ne "application/json; charset=utf-8" -or $Body -isnot [byte[]]) { throw "EXPECTED_UTF8_BYTES" }
  if ($Headers["X-Relay-Token"] -ne "synthetic-helper-token") { throw "UNEXPECTED_TEST_TOKEN" }
  $json = [Text.Encoding]::UTF8.GetString($Body)
  [IO.File]::WriteAllText($CaptureFile, $json, [Text.UTF8Encoding]::new($false))
  return @{ job = @{ jobId = "synthetic-capture"; state = "PENDING" }; deduplicated = $false }
}

& $HelperPath -PlanFile $PlanFile -ExpectedPlanSha256 $ExpectedPlanSha256 -TaskUuid $TaskUuid -DisplayId $DisplayId -TokenFile $TokenFile
