param(
  [Parameter(Mandatory=$true)][string]$PlanFile,
  [Parameter(Mandatory=$true)][string]$ExpectedPlanSha256,
  [Parameter(Mandatory=$true)][string]$TaskUuid,
  [Parameter(Mandatory=$true)][string]$DisplayId,
  [Parameter(Mandatory=$true)][string]$TokenFile,
  [Parameter(Mandatory=$true)][int]$RelayPort,
  [string]$PreviousBlockedJobId = ""
)
$ErrorActionPreference = "Stop"
$productionBase = "http://127.0.0.1:18731"
$testBase = "http://127.0.0.1:$RelayPort"
function Invoke-RestMethod {
  param($Method, $Uri, $Headers, $ContentType, $Body)
  if ($Method -notin @("Get", "Post")) { throw "TEST_PROXY_UNEXPECTED_METHOD: $Method" }
  if (-not $Uri.StartsWith($productionBase + "/v1/jobs")) { throw "TEST_PROXY_UNEXPECTED_URI: $Uri" }
  $args = @{ Method=$Method; Uri=($testBase + $Uri.Substring($productionBase.Length)); Headers=$Headers; ErrorAction="Stop" }
  if ($PSBoundParameters.ContainsKey("ContentType")) { $args.ContentType=$ContentType }
  if ($PSBoundParameters.ContainsKey("Body")) { $args.Body=$Body }
  Microsoft.PowerShell.Utility\Invoke-RestMethod @args
}
& (Join-Path $PSScriptRoot "..\enqueue-root-cause-write.ps1") -PlanFile $PlanFile -ExpectedPlanSha256 $ExpectedPlanSha256 -TaskUuid $TaskUuid -DisplayId $DisplayId -TokenFile $TokenFile -PreviousBlockedJobId $PreviousBlockedJobId
