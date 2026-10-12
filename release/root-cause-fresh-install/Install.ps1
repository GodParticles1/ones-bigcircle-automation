#requires -Version 5.1
param([string]$InstallRoot, [string]$PythonPath, [string]$ChromePath, [ValidateRange(1024,65535)][int]$Port=18731)
. (Join-Path $PSScriptRoot 'Common.ps1')
$pre = & (Join-Path $PSScriptRoot 'Preflight.ps1') -PythonPath $PythonPath -ChromePath $ChromePath
$manifest = Assert-FiBundle $PSScriptRoot
$root = Get-FiRoot $InstallRoot
if (Test-Path -LiteralPath (Join-Path $root 'installation.json') -PathType Leaf) {
    $existing = Get-FiInstallation $root
    if ($existing.Config.port -ne $Port -or $existing.Config.pythonPath -ine $pre.PythonPath -or
        $existing.Config.chromePath -ine $pre.ChromePath -or $existing.Manifest.sourceHead -cne $manifest.sourceHead -or
        (Get-FileHash -LiteralPath (Join-Path $root 'BUNDLE-MANIFEST.json')).Hash -cne
        (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'BUNDLE-MANIFEST.json')).Hash) { throw 'EXISTING_INSTALLATION_DIFFERS: no overwrite performed' }
    Write-Host 'INSTALL=ALREADY_INSTALLED'
    Write-Host ('INSTALL_ROOT=' + $root)
    return
}
if (Test-Path -LiteralPath $root) {
    if (-not (Test-Path -LiteralPath $root -PathType Container) -or @(Get-ChildItem -LiteralPath $root -Force).Count) { throw 'INSTALL_ROOT_NOT_EMPTY: existing data preserved' }
}
New-Item -ItemType Directory -Path $root -Force | Out-Null
foreach ($entry in $manifest.files) {
    $destination = Join-Path $root $entry.path
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $entry.path) -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'BUNDLE-MANIFEST.json') -Destination (Join-Path $root 'BUNDLE-MANIFEST.json')
[void](Assert-FiBundle $root)
foreach ($name in @('data','output')) { New-Item -ItemType Directory -Path (Join-Path $root $name) -Force | Out-Null }
Write-FiJson (Join-Path $root 'installation.json') ([ordered]@{
    schema='ones.fresh-install/v1'; installRoot=$root; packageName=$manifest.packageName; sourceHead=$manifest.sourceHead
    pythonPath=$pre.PythonPath; chromePath=$pre.ChromePath; port=$Port; writeEnabled=$false; installedAt=[DateTimeOffset]::UtcNow.ToString('o')
})
Write-Host 'INSTALL=PASS'
Write-Host ('INSTALL_ROOT=' + $root)
Write-Host 'STATE=NOT_STARTED; WRITE_GATE=OFF; OPERATOR_RELEASE=HOLD_WRITER_FIX'
