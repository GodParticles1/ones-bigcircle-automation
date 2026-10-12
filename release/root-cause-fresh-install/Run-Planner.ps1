#requires -Version 5.1
param(
    [string]$InstallRoot=$PSScriptRoot,
    [Parameter(Mandatory=$true)][string]$Cases,
    [Parameter(Mandatory=$true)][string]$Reconciliation,
    [Parameter(Mandatory=$true)][string]$FieldReads,
    [Parameter(Mandatory=$true)][string]$FieldId,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$CasesSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$ReconciliationSha256,
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{64}$')][string]$FieldReadsSha256
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$i = Get-FiInstallation $InstallRoot
$python = Get-FiPython $i.Config.pythonPath
foreach ($inputFile in @(@{Path=$Cases;Hash=$CasesSha256},@{Path=$Reconciliation;Hash=$ReconciliationSha256},@{Path=$FieldReads;Hash=$FieldReadsSha256})) {
    if (-not (Test-Path -LiteralPath $inputFile.Path -PathType Leaf)) { throw 'TRUSTED_PLANNER_INPUT_MISSING' }
    if ((Get-FileHash -LiteralPath $inputFile.Path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $inputFile.Hash) { throw 'TRUSTED_PLANNER_INPUT_HASH_MISMATCH' }
}
$reads = Read-FiJson $FieldReads
if ($reads.schema -cne 'ones.root-cause-field-read/v1alpha1' -or $reads.readOnly -cne $true -or
    $reads.complete -cne $true -or $reads.fieldId -cne $FieldId -or @($reads.reads).Count -lt 1 -or
    $reads.requestedTaskCount -ne @($reads.reads).Count) { throw 'FRESH_FIELD_READ_EVIDENCE_REQUIRED' }
Assert-FiFreshTime $reads.capturedAt ([DateTimeOffset]::UtcNow.AddSeconds(-120))
foreach ($row in $reads.reads) {
    if ($row.status -cne 'READ_VERIFIED' -or $row.fieldId -cne $FieldId -or $row.value -isnot [string] -or
        $row.onesTaskUuid -notmatch '^[A-Za-z0-9_-]{1,128}$') { throw 'FRESH_FIELD_READ_EVIDENCE_REQUIRED' }
    Assert-FiFreshTime $row.capturedAt ([DateTimeOffset]::UtcNow.AddSeconds(-120))
}
$run = Join-Path $i.Root ('output/planner-' + [Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $run | Out-Null
$extract = Join-Path $run 'root-cause-extraction.json'
$plan = Join-Path $run 'root-cause-sync-plan.json'
# Only the accepted algorithms execute. This wrapper never submits a Relay job.
& $python.exe (Join-Path $i.Root 'components/planner/root-cause/extract.py') --input $Cases --output $extract
if ($LASTEXITCODE -ne 0) { throw 'ROOT_CAUSE_EXTRACTION_FAILED' }
& $python.exe (Join-Path $i.Root 'components/planner/root-cause-sync/plan.py') --cases $Cases --reconciliation $Reconciliation --root-cause $extract --field-reads $FieldReads --field-id $FieldId --output $plan
if ($LASTEXITCODE -ne 0) { throw 'ROOT_CAUSE_PLANNER_FAILED' }
Write-Host ('PLAN_FILE=' + $plan)
Write-Host ('PLAN_SHA256=' + (Get-FileHash -LiteralPath $plan -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host 'TASK_TARGET_POLICY=UNIQUE_ONES_TASK_ONLY; WRITE_GATE=OFF; AUTHORIZATION=SEPARATE_FUTURE_GATE'
