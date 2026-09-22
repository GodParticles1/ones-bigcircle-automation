param()
$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Config = Join-Path $Root "config.ps1"
$Example = Join-Path $Root "config.example.ps1"
if (-not (Test-Path -LiteralPath $Config -PathType Leaf)) {
    Copy-Item -LiteralPath $Example -Destination $Config
}
. $Config

foreach ($dir in @($RuntimeDir)) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
}

Write-Host "WINDOWS_LOCAL_AGENT_SETUP_READY"
Write-Host ("Config=" + $Config)
Write-Host ("CaseFeedDir=" + $CaseFeedDir)
Write-Host ("RelayDir=" + $RelayDir)
Write-Host ("ReconciliationDir=" + $ReconciliationDir)
Write-Host ("RuntimeDir=" + $RuntimeDir)
