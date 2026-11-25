param([string]$OutputDir = (Join-Path $PSScriptRoot "..\dist"))
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Version = "0.1.1"
$Head = (& git -C $RepoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $Head -notmatch '^[a-f0-9]{40}$') { throw "SOURCE_HEAD_UNAVAILABLE" }
$Name = "ones-bigcircle-windows-agent-CANDIDATE-c" + $Head.Substring(0,12)
$StageRoot = Join-Path $OutputDir $Name
$ZipPath = Join-Path $OutputDir ($Name + ".zip")

$ReleaseFiles = @("config.example.ps1","setup.ps1","run-once.ps1","show-status.ps1","README.md","VERSION.json")
$PairedFiles = @("run-stage.ps1","pipeline.py","reconcile.py","observe_inventory.py")
$Sources = @("scripts/build-windows-local-agent-package.ps1","periodic-alignment/run-once.ps1") + @($ReleaseFiles | ForEach-Object { "release/windows-agent-v0.1.1/$_" }) + @($PairedFiles | ForEach-Object { "reconciliation/$_" })
foreach ($relative in $Sources) {
    $source = Join-Path $RepoRoot $relative
    $expected = (& git -C $RepoRoot rev-parse "${Head}:$relative").Trim()
    if ($LASTEXITCODE -ne 0) { throw "SOURCE_NOT_TRACKED: $relative" }
    $actual = (& git -C $RepoRoot hash-object "--path=$relative" $source).Trim()
    if ($LASTEXITCODE -ne 0 -or $expected -ne $actual) { throw "SOURCE_HEAD_MISMATCH: $relative" }
}
foreach ($target in @($StageRoot,$ZipPath,($ZipPath + ".sha256"))) {
    if (Test-Path -LiteralPath $target) { throw "CANDIDATE_OUTPUT_EXISTS: $target" }
}
New-Item -ItemType Directory -Path $StageRoot | Out-Null

$PeriodicDst = Join-Path $StageRoot "periodic-alignment"
New-Item -ItemType Directory -Force -Path $PeriodicDst | Out-Null
Copy-Item -LiteralPath (Join-Path $RepoRoot "periodic-alignment\run-once.ps1") -Destination (Join-Path $PeriodicDst "run-once.ps1") -Force

$ReleaseDir = Join-Path $RepoRoot "release\windows-agent-v0.1.1"
foreach ($file in $ReleaseFiles) {
    Copy-Item -LiteralPath (Join-Path $ReleaseDir $file) -Destination (Join-Path $StageRoot $file) -Force
}

$BuildInfo = [ordered]@{
    name = "ones-bigcircle-windows-agent"
    version = $Version
    releaseStatus = "CANDIDATE"
    candidateName = $Name
    mode = "LOCAL_PROVIDER_NEUTRAL"
    packageCandidateSha = $Head
    pairedReconciliation = @($PairedFiles | ForEach-Object {
        $file = $_
        [ordered]@{
            file = $file
            sha256 = (Get-FileHash -LiteralPath (Join-Path $RepoRoot "reconciliation/$file") -Algorithm SHA256).Hash.ToLowerInvariant()
            gitBlob = (& git -C $RepoRoot rev-parse "${Head}:reconciliation/$file").Trim()
        }
    })
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

if ((& git -C $RepoRoot rev-parse HEAD).Trim() -ne $Head) { throw "SOURCE_HEAD_CHANGED" }
Compress-Archive -Path $StageRoot -DestinationPath $ZipPath -CompressionLevel Optimal
$Hash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath ($ZipPath + ".sha256") -Value ($Hash + "  " + [IO.Path]::GetFileName($ZipPath)) -Encoding ASCII
Write-Host "WINDOWS_LOCAL_AGENT_PACKAGE_BUILD_PASS"
Write-Host ("ZIP=" + $ZipPath)
Write-Host ("SHA256=" + $Hash)
