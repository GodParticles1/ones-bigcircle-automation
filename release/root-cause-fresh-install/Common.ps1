#requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-FiJson($Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30), [Text.UTF8Encoding]::new($false))
}

function Read-FiJson($Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'FILE_MISSING' }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-FiRoot([string]$Path) {
    if (-not $Path) {
        if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA_MISSING: specify InstallRoot' }
        $Path = Join-Path $env:LOCALAPPDATA 'ONES\root-cause-fresh-install-v0.1.0'
    }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\', '/')) { throw 'INSTALL_ROOT_INVALID' }
    return $full
}

function Assert-FiBundle([string]$Root) {
    $m = Read-FiJson (Join-Path $Root 'BUNDLE-MANIFEST.json')
    $v = Read-FiJson (Join-Path $Root 'VERSION.json')
    if ($m.schema -cne 'ones.fresh-install-bundle/v1' -or
        $v.packageVersion -cne '0.1.0' -or
        $v.packageName -cne 'ones-root-cause-fresh-install-v0.1.0-b0.5.17-r0.3.8-p0.2.0' -or
        $v.bridgeVersion -cne '0.5.17' -or $v.relayVersion -cne '0.3.8' -or
        $v.plannerVersion -cne '0.2.0' -or $v.writeEnabled -cne $false -or
        $v.operatorRelease -cne 'HOLD_WRITER_FIX' -or $m.packageName -cne $v.packageName -or
        $m.sourceHead -notmatch '^[0-9a-f]{40}$') { throw 'BUNDLE_VERSION_MISMATCH' }
    $seen = @{}
    foreach ($entry in $m.files) {
        if ($entry.path -notmatch '^[A-Za-z0-9_.\-/]+$' -or $entry.path.StartsWith('/') -or
            @($entry.path.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' }).Count -or
            $entry.sha256 -notmatch '^[0-9a-f]{64}$' -or $seen.ContainsKey($entry.path)) { throw 'BUNDLE_MANIFEST_INVALID' }
        $seen[$entry.path] = $true
        $p = Join-Path $Root $entry.path
        if (-not (Test-Path -LiteralPath $p -PathType Leaf) -or
            (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256 -or
            (Get-Item -LiteralPath $p).Length -ne $entry.bytes) { throw ('BUNDLE_HASH_MISMATCH: ' + $entry.path) }
    }
    foreach ($required in @('Common.ps1','Preflight.ps1','Install.ps1','Start.ps1','Stop.ps1',
        'Verify-ReadOnly.ps1','Run-Planner.ps1','START_HERE.md','PREREQUISITES.md','VERSION.json',
        'components/browser-bridge/manifest.json','components/browser-bridge/service-worker.js',
        'components/browser-bridge/root-cause-writer.js','components/local-relay/relay.py',
        'components/planner/root-cause/extract.py','components/planner/root-cause-sync/plan.py')) {
        if (-not $seen.ContainsKey($required)) { throw ('BUNDLE_ARTIFACT_MISSING: ' + $required) }
    }
    $bridge = Read-FiJson (Join-Path $Root 'components/browser-bridge/manifest.json')
    if ($bridge.version -cne '0.5.17' -or $bridge.manifest_version -ne 3) { throw 'BRIDGE_VERSION_MISMATCH' }
    if ((Get-Content -LiteralPath (Join-Path $Root 'components/local-relay/relay.py') -Raw) -notmatch 'VERSION = "0\.3\.8"') {
        throw 'RELAY_VERSION_MISMATCH'
    }
    return $m
}

function Get-FiPython([string]$PythonPath) {
    $candidates = @()
    if ($PythonPath) {
        if (-not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) { throw 'PYTHON_NOT_FOUND' }
        $candidates += @{Exe=$PythonPath; Prefix=@()}
    } else {
        foreach ($name in @('py.exe','python.exe','python3.exe')) {
            $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue
            if ($command) { $candidates += @{Exe=$command.Source; Prefix=$(if ($name -eq 'py.exe') { @('-3') } else { @() })} }
        }
    }
    foreach ($candidate in $candidates) {
        try {
            $args = @($candidate.Prefix) + @('-c', "import sys,sqlite3,json,http.server,secrets; print(json.dumps({'exe':sys.executable,'version':list(sys.version_info[:3]),'sqlite':sqlite3.sqlite_version}))")
            $raw = & $candidate.Exe @args 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            $info = ($raw -join "`n") | ConvertFrom-Json
            if ($info.version[0] -ne 3 -or $info.version[1] -lt 12 -or
                [version]$info.sqlite -lt [version]'3.24.0' -or -not (Test-Path -LiteralPath $info.exe -PathType Leaf)) { continue }
            return $info
        } catch { continue }
    }
    throw 'PYTHON_NOT_FOUND_OR_INCOMPATIBLE: Python 3.12+ with SQLite 3.24+ required'
}

function Get-FiChrome([string]$ChromePath) {
    $candidates = @()
    if ($ChromePath) { $candidates = @($ChromePath) }
    else {
        foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
            if ($base) { $candidates += Join-Path $base 'Google\Chrome\Application\chrome.exe' }
        }
        $command = Get-Command chrome.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($command) { $candidates += $command.Source }
    }
    foreach ($p in $candidates) {
        if (Test-Path -LiteralPath $p -PathType Leaf) {
            $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($p)
            # The frozen popup uses storage.session (102+); MAIN scripting alone needs 95+.
            if ($info.ProductName -eq 'Google Chrome' -and $info.ProductMajorPart -ge 102) {
                return [pscustomobject]@{Path=[IO.Path]::GetFullPath($p); Version=$info.ProductVersion}
            }
        }
    }
    throw 'CHROME_NOT_FOUND_OR_INCOMPATIBLE: Google Chrome 102+ required'
}

function Get-FiInstallation([string]$InstallRoot) {
    $root = Get-FiRoot $InstallRoot
    $m = Assert-FiBundle $root
    $c = Read-FiJson (Join-Path $root 'installation.json')
    if ($c.schema -cne 'ones.fresh-install/v1' -or $c.installRoot -ine $root -or
        $c.packageName -cne $m.packageName -or $c.sourceHead -cne $m.sourceHead -or
        $c.writeEnabled -cne $false -or $c.port -lt 1024 -or $c.port -gt 65535) { throw 'INSTALLATION_INVALID_OR_WRITE_GATE_NOT_OFF' }
    return [pscustomobject]@{Root=$root; Config=$c; Manifest=$m}
}

function Get-FiToken([string]$Root) {
    $p = Join-Path $Root 'data/relay-token.txt'
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { throw 'TOKEN_MISSING: Start first' }
    $token = (Get-Content -LiteralPath $p -Raw -Encoding UTF8).Trim()
    if ($token -notmatch '^[A-Za-z0-9_-]{32,256}$') { throw 'TOKEN_INVALID' }
    return $token
}

function Invoke-FiRelay($Installation, [string]$Path, [string]$Method = 'GET', $Body = $null) {
    if ($Path -notmatch '^/(health|v1/stats|v1/jobs(/[A-Za-z0-9-]+)?)$') { throw 'RELAY_PATH_NOT_ALLOWED' }
    $args = @{Method=$Method; Uri=('http://127.0.0.1:' + $Installation.Config.port + $Path); TimeoutSec=3}
    if ($Path -ne '/health') { $args.Headers = @{'X-Relay-Token'=(Get-FiToken $Installation.Root)} }
    if ($Method -eq 'POST') {
        if ($Path -ne '/v1/jobs' -or $Body.jobType -notin @('RELAY_PING','ONES_FIELD_READ')) { throw 'READONLY_JOB_REQUIRED' }
        $args.ContentType = 'application/json; charset=utf-8'
        $args.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 20 -Compress))
    }
    try { return Invoke-RestMethod @args } catch { throw 'RELAY_REQUEST_FAILED: check local health/token; no retry or token rotation performed' }
}

function Get-FiOwnedProcess($Installation) {
    $p = Join-Path $Installation.Root 'data/process.json'
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $null }
    $record = Read-FiJson $p
    $proc = Get-Process -Id ([int]$record.processId) -ErrorAction SilentlyContinue
    if (-not $proc) { return $null }
    $cim = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $proc.Id)
    $script = Join-Path $Installation.Root 'components/local-relay/relay.py'
    $data = Join-Path $Installation.Root 'data'
    if ($proc.StartTime.ToUniversalTime().Ticks -ne ([DateTimeOffset]$record.startTimeUtc).UtcDateTime.Ticks -or
        $cim.ExecutablePath -ine $Installation.Config.pythonPath -or
        -not $cim.CommandLine.Contains('"' + $script + '"') -or
        -not $cim.CommandLine.Contains('--data-dir "' + $data + '"') -or
        -not $cim.CommandLine.Contains('--port ' + $Installation.Config.port + ' ')) { throw 'PROCESS_IDENTITY_MISMATCH: refusing to stop or reuse process' }
    return $proc
}

function Assert-FiHealth($Installation, $Process) {
    $health = Invoke-FiRelay $Installation '/health'
    if ($health.ok -cne $true -or $health.service -cne 'ones-local-relay' -or
        $health.version -cne '0.3.8' -or $health.bind -cne ('127.0.0.1:' + $Installation.Config.port) -or
        $health.pid -ne $Process.Id) { throw 'RELAY_IDENTITY_MISMATCH' }
    $stats = Invoke-FiRelay $Installation '/v1/stats'
    if ($stats.ok -cne $true -or $stats.version -cne '0.3.8') { throw 'RELAY_AUTH_OR_VERSION_FAILED' }
    return $stats
}

function Assert-FiFreshTime($Value, [DateTimeOffset]$NotBefore, [int]$MaxAgeSeconds=120) {
    try { $time = [DateTimeOffset]$Value } catch { throw 'TIMESTAMP_INVALID' }
    $now = [DateTimeOffset]::UtcNow
    if ($time -lt $NotBefore.AddSeconds(-2) -or $time -lt $now.AddSeconds(-$MaxAgeSeconds) -or $time -gt $now.AddSeconds(2)) { throw 'EVIDENCE_NOT_FRESH' }
}

function Assert-FiReadOnlyExecutor($Stats) {
    $fresh = @($Stats.executors | Where-Object {
        try { Assert-FiFreshTime $_.lastSeenAt ([DateTimeOffset]::UtcNow.AddSeconds(-120)); $true } catch { $false }
    })
    if ($fresh.Count -ne 1) { throw 'FRESH_EXECUTOR_NOT_UNIQUE: require one current heartbeat' }
    $e = $fresh[0]
    $expected = @('ONES_FIELD_READ','ONES_INVENTORY_READ','RELAY_PING')
    $caps = @($e.capabilities | Sort-Object -Unique)
    if ($e.extensionVersion -cne '0.5.17' -or $e.onesTabCount -ne 1 -or
        ($caps -join ',') -cne ($expected -join ',') -or -not $e.executorId) { throw 'READONLY_EXECUTOR_GATE_FAILED: version, one tab and read-only capabilities required' }
    return $e
}
