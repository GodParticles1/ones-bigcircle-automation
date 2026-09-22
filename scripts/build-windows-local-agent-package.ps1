param([string]$OutputDir = (Join-Path $PSScriptRoot "..\dist"))
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Version = "0.1.1"
$Name = "ones-bigcircle-windows-agent-v$Version"
$StageRoot = Join-Path $OutputDir $Name
$ZipPath = Join-Path $OutputDir ($Name + ".zip")

if (Test-Path -LiteralPath $StageRoot) { Remove-Item -LiteralPath $StageRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null

$PeriodicDst = Join-Path $StageRoot "periodic-alignment"
New-Item -ItemType Directory -Force -Path $PeriodicDst | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot "periodic-alignment\run-once.ps1") -Destination (Join-Path $PeriodicDst "run-once.ps1") -Force

$ReleaseDir = Join-Path $RepoRoot "release\windows-agent-v0.1.1"
foreach ($file in @("config.example.ps1","setup.ps1","run-once.ps1","show-status.ps1","README.md","VERSION.json")) {
    Copy-Item -LiteralPath (Join-Path $ReleaseDir $file) -Destination (Join-Path $StageRoot $file) -Force
}

$Head = (& git -C $RepoRoot rev-parse HEAD).Trim()
$BuildInfo = [ordered]@{
    name = "ones-bigcircle-windows-agent"
    version = $Version
    mode = "LOCAL_PROVIDER_NEUTRAL"
    packageCandidateSha = $Head
    builtAt = [DateTime]::UtcNow.ToString("o")
    remoteBaseUrlRequired = $false
    cloudflareApiKeyRequired = $false
    httpsTransportRequired = $false
    onesMutation = $false
}
$BuildInfo | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $StageRoot "BUILD.json") -Encoding UTF8

foreach ($ps1 in @("setup.ps1","run-once.ps1","show-status.ps1","config.example.ps1","periodic-alignment\run-once.ps1")) {
    [void][scriptblock]::Create((Get-Content -LiteralPath (Join-Path $StageRoot $ps1) -Raw))
}

if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
Compress-Archive -Path $StageRoot -DestinationPath $ZipPath -CompressionLevel Optimal
$Hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($ZipPath + ".sha256") -Value ($Hash + "  " + [IO.Path]::GetFileName($ZipPath)) -Encoding ASCII
Write-Host "WINDOWS_LOCAL_AGENT_PACKAGE_BUILD_PASS"
Write-Host ("ZIP=" + $ZipPath)
Write-Host ("SHA256=" + $Hash)
