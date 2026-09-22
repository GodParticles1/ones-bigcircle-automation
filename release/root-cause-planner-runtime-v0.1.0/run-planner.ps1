param(
  [Parameter(Mandatory=$true)][string]$Cases,
  [Parameter(Mandatory=$true)][string]$Reconciliation,
  [Parameter(Mandatory=$true)][string]$FieldReads,
  [Parameter(Mandatory=$true)][string]$FieldId,
  [string]$OutputDir = (Join-Path $PSScriptRoot "output")
)
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

foreach ($p in @($Cases,$Reconciliation,$FieldReads)) {
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw ("INPUT_MISSING: " + $p) }
}

$Extraction = Join-Path $OutputDir "root-cause-extraction.json"
$Plan = Join-Path $OutputDir "root-cause-sync-plan.json"

Write-Host "===== INPUT HASHES ====="
Write-Host ("CASE_FEED_SHA256=" + (Get-FileHash -LiteralPath $Cases -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host ("RECONCILIATION_SHA256=" + (Get-FileHash -LiteralPath $Reconciliation -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host ("FIELD_READS_SHA256=" + (Get-FileHash -LiteralPath $FieldReads -Algorithm SHA256).Hash.ToLowerInvariant())

python (Join-Path $Root "root-cause\extract.py") --input $Cases --output $Extraction
if ($LASTEXITCODE -ne 0) { throw "ROOT_CAUSE_EXTRACTION_FAILED" }

python (Join-Path $Root "root-cause-sync\plan.py") `
  --cases $Cases `
  --reconciliation $Reconciliation `
  --root-cause $Extraction `
  --field-reads $FieldReads `
  --field-id $FieldId `
  --output $Plan
if ($LASTEXITCODE -ne 0) { throw "ROOT_CAUSE_PLANNER_FAILED" }

$ExtractDoc = Get-Content -LiteralPath $Extraction -Raw -Encoding UTF8 | ConvertFrom-Json
$PlanDoc = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json

Write-Host ""
Write-Host "===== EXTRACTION ====="
Write-Host ("CONFIRMED=" + $ExtractDoc.totals.CONFIRMED)
Write-Host ("PROVISIONAL=" + $ExtractDoc.totals.PROVISIONAL)
Write-Host ("ABSENT=" + $ExtractDoc.totals.ABSENT)
Write-Host ("CONFLICT=" + $ExtractDoc.totals.CONFLICT)
Write-Host ("EXTRACTION_SHA256=" + (Get-FileHash -LiteralPath $Extraction -Algorithm SHA256).Hash.ToLowerInvariant())

Write-Host ""
Write-Host "===== PLAN ====="
Write-Host ("STATUS=" + $PlanDoc.status)
Write-Host ("CASE_COUNT=" + $PlanDoc.caseCount)
Write-Host ("SET_CANDIDATE=" + $PlanDoc.totals.SET_CANDIDATE)
Write-Host ("NOOP=" + $PlanDoc.totals.NOOP)
Write-Host ("CONFLICT_REVIEW=" + $PlanDoc.totals.CONFLICT_REVIEW)
Write-Host ("BLOCK=" + $PlanDoc.totals.BLOCK)
Write-Host ("PLAN_SHA256=" + (Get-FileHash -LiteralPath $Plan -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host ("PLAN_FILE=" + $Plan)
Write-Host "PRODUCTION_ONES_MUTATION=DISABLED"
