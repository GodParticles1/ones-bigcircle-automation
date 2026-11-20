<#
.SYNOPSIS
Runs the configured local read-only alignment.
.PARAMETER ObserveAssignee
Optional exact ONES assignee UUID. Passes the observation request to periodic alignment.
Omit it for normal full alignment. Requires the reconciliation sources from the same candidate.
.EXAMPLE
.\run-once.ps1
.EXAMPLE
.\run-once.ps1 -ObserveAssignee user-a
#>
param(
    [string]$CaseFeedDir,
    [string]$RelayDir,
    [string]$ReconciliationDir,
    [string]$RuntimeDir,
    [ValidateNotNullOrEmpty()][string]$ObserveAssignee
)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Config = Join-Path $Root "config.ps1"
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
    throw "CONFIG_MISSING: run setup.ps1 first"
}
. $Config

if ($PSBoundParameters.ContainsKey("CaseFeedDir")) { $script:CaseFeedDir = $PSBoundParameters["CaseFeedDir"] }
if ($PSBoundParameters.ContainsKey("RelayDir")) { $script:RelayDir = $PSBoundParameters["RelayDir"] }
if ($PSBoundParameters.ContainsKey("ReconciliationDir")) { $script:ReconciliationDir = $PSBoundParameters["ReconciliationDir"] }
if ($PSBoundParameters.ContainsKey("RuntimeDir")) { $script:RuntimeDir = $PSBoundParameters["RuntimeDir"] }

foreach ($pair in @(
    @{Name="CaseFeedDir";Value=$script:CaseFeedDir},
    @{Name="RelayDir";Value=$script:RelayDir},
    @{Name="ReconciliationDir";Value=$script:ReconciliationDir},
    @{Name="RuntimeDir";Value=$script:RuntimeDir}
)) {
    if ([string]::IsNullOrWhiteSpace([string]$pair.Value)) { throw ($pair.Name + "_MISSING") }
}

$Periodic = Join-Path $Root "periodic-alignment\run-once.ps1"
$observationArgs = @()
if ($PSBoundParameters.ContainsKey("ObserveAssignee")) {
    $observationArgs = @("-ObserveAssignee", $ObserveAssignee)
}
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Periodic `
  -CaseFeedDir $script:CaseFeedDir `
  -RelayDir $script:RelayDir `
  -ReconciliationDir $script:ReconciliationDir `
  -RuntimeDir $script:RuntimeDir @observationArgs
exit $LASTEXITCODE
