#requires -Version 5.1
param([string]$InstallRoot=$PSScriptRoot)
. (Join-Path $PSScriptRoot 'Common.ps1')
$i = Get-FiInstallation $InstallRoot
$owned = Get-FiOwnedProcess $i
if (-not $owned) {
    Write-Host 'STOP=ALREADY_STOPPED; DATA_PRESERVED=true'
    return
}
Stop-Process -Id $owned.Id -Force
if (-not $owned.WaitForExit(5000)) { throw 'STOP_TIMEOUT' }
Write-Host 'STOP=PASS; DATA_PRESERVED=true'
