param([string]$OutputDir = (Join-Path $PSScriptRoot "..\dist-root-cause-planner-v020"))
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Name = "ones-root-cause-planner-runtime-v0.2.0"
$Stage = Join-Path $OutputDir $Name
$Zip = Join-Path $OutputDir ($Name + ".zip")
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
foreach ($dir in @("root-cause","root-cause-sync")) { New-Item -ItemType Directory -Force -Path (Join-Path $Stage $dir) | Out-Null }
Copy-Item (Join-Path $RepoRoot "root-cause\extract.py") (Join-Path $Stage "root-cause\extract.py")
Copy-Item (Join-Path $RepoRoot "root-cause-sync\plan.py") (Join-Path $Stage "root-cause-sync\plan.py")
Copy-Item (Join-Path $RepoRoot "release\root-cause-planner-runtime-v0.2.0\run-planner.ps1") (Join-Path $Stage "run-planner.ps1")
Copy-Item (Join-Path $RepoRoot "release\root-cause-planner-runtime-v0.2.0\README.md") (Join-Path $Stage "README.md")
[void][scriptblock]::Create((Get-Content (Join-Path $Stage "run-planner.ps1") -Raw))
python -m py_compile (Join-Path $Stage "root-cause\extract.py") (Join-Path $Stage "root-cause-sync\plan.py")
if ($LASTEXITCODE -ne 0) { throw "PY_COMPILE_FAILED" }
if (Test-Path $Zip) { Remove-Item $Zip -Force }
Compress-Archive -Path $Stage -DestinationPath $Zip -CompressionLevel Optimal
$Hash=(Get-FileHash $Zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($Zip + ".sha256") -Encoding ASCII -Value ($Hash + "  " + [IO.Path]::GetFileName($Zip))
Write-Host "ROOT_CAUSE_PLANNER_RUNTIME_V020_PACKAGE_PASS"
Write-Host ("SHA256=" + $Hash)
