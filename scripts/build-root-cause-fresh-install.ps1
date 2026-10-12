#requires -Version 5.1
param([string]$OutputDir=(Join-Path ([IO.Path]::GetTempPath()) 'ones-fresh-install-build'))
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$release = Join-Path $repo 'release/root-cause-fresh-install'
$version = Get-Content -LiteralPath (Join-Path $release 'VERSION.json') -Raw | ConvertFrom-Json
$name = $version.packageName
if ($name -cne 'ones-root-cause-fresh-install-v0.1.0-b0.5.17-r0.3.8-p0.2.0') { throw 'PACKAGE_NAME_INVALID' }
$head = (& git -C $repo rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$') { throw 'SOURCE_HEAD_UNAVAILABLE' }
$output = [IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$stage = Join-Path $output ('stage-' + [Guid]::NewGuid().ToString())
$root = Join-Path $stage $name
New-Item -ItemType Directory -Path $root -Force | Out-Null
$origins = @{}
function Copy-BundleFile([string]$Source, [string]$Relative) {
    $path = Join-Path $repo $Source
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw ('BLOCKED_MISSING_ARTIFACT: producer repository/' + $Source) }
    $destination = Join-Path $root $Relative
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $path -Destination $destination
    $origins[$Relative] = $Source
}
try {
    foreach ($file in @('Common.ps1','Preflight.ps1','Install.ps1','Start.ps1','Stop.ps1','Verify-ReadOnly.ps1',
        'Run-Planner.ps1','START_HERE.md','PREREQUISITES.md','VERSION.json')) {
        Copy-BundleFile ('release/root-cause-fresh-install/' + $file) $file
    }
    foreach ($file in @('manifest.json','service-worker.js','root-cause-writer.js','popup.html','popup.js','popup.css','README.md')) {
        Copy-BundleFile ('browser-bridge/' + $file) ('components/browser-bridge/' + $file)
    }
    foreach ($file in @('relay.py','README.md')) { Copy-BundleFile ('local-relay/' + $file) ('components/local-relay/' + $file) }
    foreach ($file in @('run-planner.ps1','README.md')) {
        Copy-BundleFile ('release/root-cause-planner-runtime-v0.2.0/' + $file) ('components/planner/' + $file)
    }
    Copy-BundleFile 'root-cause/extract.py' 'components/planner/root-cause/extract.py'
    Copy-BundleFile 'root-cause-sync/plan.py' 'components/planner/root-cause-sync/plan.py'
    $files = @()
    foreach ($relative in ($origins.Keys | Sort-Object)) {
        $p = Join-Path $root $relative
        $files += [ordered]@{path=$relative; origin=$origins[$relative]; bytes=(Get-Item -LiteralPath $p).Length; sha256=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()}
    }
    . (Join-Path $release 'Common.ps1')
    Write-FiJson (Join-Path $root 'BUNDLE-MANIFEST.json') ([ordered]@{
        schema='ones.fresh-install-bundle/v1'; packageName=$name; sourceHead=$head
        components=[ordered]@{bridge='0.5.17';relay='0.3.8';planner='0.2.0'}; operatorRelease='HOLD_WRITER_FIX'; files=$files
    })
    [void](Assert-FiBundle $root)
    foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Filter '*.ps1') {
        $parseErrors = $null
        [void][Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$null, [ref]$parseErrors)
        if ($parseErrors.Count) { throw ('POWERSHELL_PARSE_FAILED: ' + $file.Name) }
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $zip = Join-Path $output ($name + '.zip')
    # All entry order, timestamps, UTF-8 JSON and compression parameters are deterministic.
    $stream = [IO.File]::Open($zip, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $archive = $null
    try {
        $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false)
        $paths = @($origins.Keys) + @('BUNDLE-MANIFEST.json')
        foreach ($relative in ($paths | Sort-Object)) {
            $entry = $archive.CreateEntry(($name + '/' + $relative), [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [DateTimeOffset]::new(2020,1,1,0,0,0,[TimeSpan]::Zero)
            $entryStream = $entry.Open()
            $sourceStream = [IO.File]::OpenRead((Join-Path $root $relative))
            try { $sourceStream.CopyTo($entryStream) } finally { $sourceStream.Dispose(); $entryStream.Dispose() }
        }
    } finally { if ($archive) { $archive.Dispose() }; $stream.Dispose() }
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(($zip + '.sha256'), ($hash + '  ' + [IO.Path]::GetFileName($zip) + "`n"), [Text.Encoding]::ASCII)
    Write-Host 'FRESH_INSTALL_PACKAGE=PASS'
    Write-Host ('PACKAGE=' + $zip)
    Write-Host ('SHA256=' + $hash)
    Write-Host ('SOURCE_HEAD=' + $head)
    Write-Host 'OPERATOR_RELEASE=HOLD_WRITER_FIX'
} finally {
    # Only the freshly created, resolved build staging directory is removed.
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if ($resolvedStage.StartsWith($output.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path $resolvedStage -Leaf) -like 'stage-*') { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}
