#requires -Version 5.1
param([string]$PythonPath, [string]$ChromePath)
. (Join-Path $PSScriptRoot 'Common.ps1')
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_REQUIRED' }
$manifest = Assert-FiBundle $PSScriptRoot
$python = Get-FiPython $PythonPath
$chrome = Get-FiChrome $ChromePath
foreach ($relative in @('components/local-relay/relay.py','components/planner/root-cause/extract.py','components/planner/root-cause-sync/plan.py')) {
    & $python.exe -c "import pathlib,sys; p=pathlib.Path(sys.argv[1]); compile(p.read_text(encoding='utf-8-sig'),str(p),'exec')" (Join-Path $PSScriptRoot $relative)
    if ($LASTEXITCODE -ne 0) { throw 'PYTHON_COMPONENT_INCOMPATIBLE' }
}
Write-Host 'PREFLIGHT=PASS'
Write-Host ('PYTHON=' + ($python.version -join '.'))
Write-Host ('CHROME=' + $chrome.Version)
Write-Host 'WRITE_GATE=OFF'
[pscustomobject]@{PythonPath=$python.exe; ChromePath=$chrome.Path; PackageName=$manifest.packageName}
