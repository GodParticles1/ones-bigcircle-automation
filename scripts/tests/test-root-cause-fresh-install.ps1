param(
  [string]$BundlePath,
  [string]$PythonPath,
  [string]$ChromePath
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_INSTALL_TEST_REQUIRES_WINDOWS' }
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('ones-fresh-install-test-' + [guid]::NewGuid().ToString('N'))
$utf8 = New-Object Text.UTF8Encoding($false)
$passes = 0
$workerProcesses = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$installedRoots = New-Object System.Collections.Generic.List[string]

function Assert-True([bool]$Condition, [string]$Name) {
  if (-not $Condition) { throw ('ASSERTION_FAILED: ' + $Name) }
  $script:passes++
  Write-Host ('PASS=' + $Name)
}
function Assert-Blocked([scriptblock]$Action, [string]$Name, [string]$Pattern = '.') {
  $blocked = $false
  try { & $Action | Out-Null } catch {
    if ($_.Exception.Message -notmatch $Pattern) { throw ('UNEXPECTED_BLOCKER for ' + $Name + ': ' + $_.Exception.Message) }
    $blocked = $true
  }
  Assert-True $blocked $Name
}
function Write-Json([string]$Path, $Value) {
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30), $script:utf8)
}
function Read-Json([string]$Path) { return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) }
function New-FreePort {
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}
function Relay-Request([string]$Method, [string]$Path, $Body = $null) {
  $args = @{ Uri = ($script:relayUrl + $Path); Method = $Method; Headers = @{ 'X-Relay-Token' = $script:relayToken }; TimeoutSec = 5; UseBasicParsing = $true }
  if ($null -ne $Body) { $args.Body = ($Body | ConvertTo-Json -Compress -Depth 30); $args.ContentType = 'application/json; charset=utf-8' }
  return (Invoke-RestMethod @args)
}
function Job-Count {
  $stats = Relay-Request 'GET' '/v1/stats'
  $sum = 0
  foreach ($prop in $stats.jobsByState.PSObject.Properties) { $sum += [int]$prop.Value }
  return $sum
}
function Heartbeat([string[]]$Capabilities = @('RELAY_PING', 'ONES_INVENTORY_READ', 'ONES_FIELD_READ'), [string]$Executor = 'synthetic-fresh-install') {
  Relay-Request 'POST' '/v1/extension/heartbeat' @{ executorId = $Executor; extensionVersion = '0.5.17'; capabilities = $Capabilities; onesTabCount = 1 } | Out-Null
}
function Set-SyntheticHeartbeatAge([string]$LastSeen = '2000-01-01T00:00:00.000Z') {
  & $script:PythonPath -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE executor_heartbeats SET last_seen_at=?',(sys.argv[2],)); c.commit(); c.close()" (Join-Path $script:install 'data\relay.db') $LastSeen
  if ($LASTEXITCODE -ne 0) { throw 'SYNTHETIC_HEARTBEAT_SETUP_FAILED' }
}
function Invoke-Verification([string]$Mode, [string]$Expected = '') {
  $args = @{ InstallRoot = $script:install; Mode = $Mode; TimeoutSeconds = 8 }
  if ($Mode -eq 'Field') { $args.TaskUuid = 'synthetic-task-001'; $args.FieldId = 'field-synthetic-root-cause'; $args.ExpectedValue = $Expected }
  return @(& (Join-Path $script:bundle 'Verify-ReadOnly.ps1') @args 6>&1)
}
function Start-SyntheticWorker([string]$Variant = 'valid', [string]$Value = '') {
  $fixture = Join-Path $script:testRoot ([guid]::NewGuid().ToString('N') + '.json')
  Write-Json $fixture @{ variant = $Variant; value = $Value; relayUrl = $script:relayUrl; tokenPath = (Join-Path $script:install 'data\relay-token.txt') }
  $args = '"' + $script:workerPath + '" "' + $fixture + '"'
  $proc = Start-Process -FilePath $script:PythonPath -ArgumentList $args -PassThru -WindowStyle Hidden
  $script:workerProcesses.Add($proc)
  return $proc
}
function Finish-SyntheticWorker($Process) {
  if (-not $Process.WaitForExit(12000)) { throw 'SYNTHETIC_WORKER_TIMEOUT' }
  if ($Process.ExitCode -ne 0) { throw ('SYNTHETIC_WORKER_FAILED: ' + $Process.ExitCode) }
}

New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  if (-not $BundlePath) {
    $out = Join-Path $testRoot 'package one'
    & (Join-Path $repo 'scripts\build-root-cause-fresh-install.ps1') -OutputDir $out | Out-Null
    $zips = @(Get-ChildItem -LiteralPath $out -Filter '*.zip' -File)
    Assert-True ($zips.Count -eq 1) 'one_versioned_package'
    $BundlePath = $zips[0].FullName
  }
  $zipHash = (Get-FileHash -LiteralPath $BundlePath -Algorithm SHA256).Hash
  $secondOut = Join-Path $testRoot 'package two'
  & (Join-Path $repo 'scripts\build-root-cause-fresh-install.ps1') -OutputDir $secondOut | Out-Null
  $secondZip = @(Get-ChildItem -LiteralPath $secondOut -Filter '*.zip' -File)
  Assert-True ($secondZip.Count -eq 1 -and (Get-FileHash -LiteralPath $secondZip[0].FullName -Algorithm SHA256).Hash -ceq $zipHash) 'bundle_is_reproducible'
  Assert-True ([IO.Path]::GetFileName($BundlePath) -ceq 'ones-root-cause-fresh-install-v0.1.0-b0.5.17-r0.3.8-p0.2.0.zip') 'accepted_component_version_filename'
  $expanded = Join-Path $testRoot 'extracted package'
  Expand-Archive -LiteralPath $BundlePath -DestinationPath $expanded
  $manifests = @(Get-ChildItem -LiteralPath $expanded -Recurse -Filter 'BUNDLE-MANIFEST.json' -File)
  Assert-True ($manifests.Count -eq 1) 'one_bundle_manifest'
  $bundle = $manifests[0].DirectoryName
  $manifest = Read-Json $manifests[0].FullName
  $manifestPaths = @($manifest.files | ForEach-Object { $_.path })
  $shippedFiles = @(Get-ChildItem -LiteralPath $bundle -Recurse -File | Where-Object { $_.Name -ne 'BUNDLE-MANIFEST.json' })
  Assert-True ($manifestPaths.Count -eq $shippedFiles.Count -and @($manifestPaths | Sort-Object -Unique).Count -eq $manifestPaths.Count) 'manifest_covers_every_immutable_file_once'
  foreach ($file in $shippedFiles) {
    $relative = $file.FullName.Substring($bundle.Length + 1) -replace '\\', '/'
    $entry = @($manifest.files | Where-Object { $_.path -ceq $relative })
    Assert-True ($entry.Count -eq 1 -and $entry[0].sha256 -ceq (Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant()) ('shipped_hash_' + $relative)
  }
  Assert-True (@($shippedFiles | Where-Object { $_.Name -in @('relay.db', 'relay-token.txt', 'installation.json', 'process.json') }).Count -eq 0) 'bundle_contains_no_old_runtime_state'
  $scripts = @('Preflight.ps1', 'Install.ps1', 'Start.ps1', 'Stop.ps1', 'Verify-ReadOnly.ps1')
  foreach ($name in $scripts) {
    $path = Join-Path $bundle $name
    Assert-True (Test-Path -LiteralPath $path -PathType Leaf) ('packaged_' + $name)
    [void][scriptblock]::Create((Get-Content -LiteralPath $path -Raw -Encoding UTF8))
  }
  foreach ($name in @('manifest.json', 'service-worker.js', 'root-cause-writer.js', 'popup.html', 'popup.js', 'popup.css', 'README.md')) {
    $original = Join-Path $repo ('browser-bridge\' + $name)
    $shipped = Join-Path $bundle ('components\browser-bridge\' + $name)
    Assert-True ((Get-FileHash -LiteralPath $original).Hash -ceq (Get-FileHash -LiteralPath $shipped).Hash) ('accepted_bridge_unchanged_' + $name)
  }
  foreach ($pair in @(
    @('local-relay\relay.py', 'components\local-relay\relay.py'),
    @('root-cause\extract.py', 'components\planner\root-cause\extract.py'),
    @('root-cause-sync\plan.py', 'components\planner\root-cause-sync\plan.py'),
    @('release\root-cause-planner-runtime-v0.2.0\run-planner.ps1', 'components\planner\run-planner.ps1')
  )) {
    Assert-True ((Get-FileHash -LiteralPath (Join-Path $repo $pair[0])).Hash -ceq (Get-FileHash -LiteralPath (Join-Path $bundle $pair[1])).Hash) ('accepted_component_unchanged_' + $pair[0])
  }
  $preArgs = @{}
  if ($PythonPath) { $preArgs.PythonPath = $PythonPath }
  if ($ChromePath) { $preArgs.ChromePath = $ChromePath }
  $preflight = & (Join-Path $bundle 'Preflight.ps1') @preArgs
  if (-not $PythonPath) { $PythonPath = $preflight.pythonPath }
  if (-not $ChromePath) { $ChromePath = $preflight.chromePath }
  Assert-True ((Test-Path -LiteralPath $PythonPath -PathType Leaf) -and (Test-Path -LiteralPath $ChromePath -PathType Leaf)) 'real_prerequisites_preflight'
  $tamperedExpanded = Join-Path $testRoot 'tampered package'
  Expand-Archive -LiteralPath $BundlePath -DestinationPath $tamperedExpanded
  $tamperedManifest = @(Get-ChildItem -LiteralPath $tamperedExpanded -Recurse -Filter 'BUNDLE-MANIFEST.json' -File)[0]
  $tamperedRoot = $tamperedManifest.DirectoryName
  [IO.File]::AppendAllText((Join-Path $tamperedRoot 'components\local-relay\relay.py'), "`n# synthetic changed bytes`n", $utf8)
  Assert-Blocked { & (Join-Path $tamperedRoot 'Preflight.ps1') -PythonPath $PythonPath -ChromePath $ChromePath } 'tampered_component_rejected' 'BUNDLE_HASH_MISMATCH'
  $unicode = [string][char]0x5168 + [string][char]0x65b0 + [string][char]0x5b89 + [string][char]0x88c5
  $install = Join-Path $testRoot ('new install ' + $unicode)
  $port = New-FreePort
  & (Join-Path $bundle 'Install.ps1') -InstallRoot $install -PythonPath $PythonPath -ChromePath $ChromePath -Port $port | Out-Null
  $installedRoots.Add($install)
  Assert-True (Test-Path -LiteralPath (Join-Path $install 'installation.json')) 'fresh_install_has_configuration'
  $configuration = Read-Json (Join-Path $install 'installation.json')
  Assert-True ($configuration.writeEnabled -ceq $false) 'installation_write_gate_off'
  Assert-True ((-not (Test-Path -LiteralPath (Join-Path $install 'data\relay-token.txt'))) -and (-not (Test-Path -LiteralPath (Join-Path $install 'data\relay.db')))) 'install_does_not_fabricate_runtime_state'
  foreach ($path in @(Get-ChildItem -LiteralPath (Join-Path $bundle 'components') -Recurse -File)) {
    $relative = $path.FullName.Substring($bundle.Length + 1)
    Assert-True ((Get-FileHash -LiteralPath $path.FullName).Hash -ceq (Get-FileHash -LiteralPath (Join-Path $install $relative)).Hash) ('installed_immutable_' + ($relative -replace '\\', '/'))
  }

  $missingPythonRoot = Join-Path $testRoot 'missing python target'
  Assert-Blocked { & (Join-Path $bundle 'Install.ps1') -InstallRoot $missingPythonRoot -PythonPath (Join-Path $testRoot 'missing-python.exe') -ChromePath $ChromePath -Port (New-FreePort) } 'explicit_missing_python_rejected'
  Assert-True (-not (Test-Path -LiteralPath $missingPythonRoot)) 'missing_python_does_not_initialize'
  $missingChromeRoot = Join-Path $testRoot 'missing chrome target'
  Assert-Blocked { & (Join-Path $bundle 'Install.ps1') -InstallRoot $missingChromeRoot -PythonPath $PythonPath -ChromePath (Join-Path $testRoot 'missing-chrome.exe') -Port (New-FreePort) } 'explicit_missing_chrome_rejected'
  Assert-True (-not (Test-Path -LiteralPath $missingChromeRoot)) 'missing_chrome_does_not_initialize'
  $unrelatedRoot = Join-Path $testRoot 'unrelated existing directory'
  New-Item -ItemType Directory -Path $unrelatedRoot | Out-Null
  $unrelatedFile = Join-Path $unrelatedRoot 'keep.txt'
  [IO.File]::WriteAllText($unrelatedFile, 'synthetic unrelated file', $utf8)
  $unrelatedHash = (Get-FileHash -LiteralPath $unrelatedFile).Hash
  Assert-Blocked { & (Join-Path $bundle 'Install.ps1') -InstallRoot $unrelatedRoot -PythonPath $PythonPath -ChromePath $ChromePath -Port (New-FreePort) } 'unrelated_install_root_rejected'
  Assert-True ((Get-FileHash -LiteralPath $unrelatedFile).Hash -ceq $unrelatedHash -and @(Get-ChildItem -LiteralPath $unrelatedRoot -Force).Count -eq 1) 'unrelated_install_root_unchanged'

  $tokenPath = Join-Path $install 'data\relay-token.txt'
  $dbPath = Join-Path $install 'data\relay.db'
  [IO.File]::WriteAllText($tokenPath, 'short-invalid-synthetic-token', $utf8)
  Assert-Blocked { & (Join-Path $bundle 'Start.ps1') -InstallRoot $install } 'invalid_existing_token_start_rejected'
  Assert-True ((Get-Content -LiteralPath $tokenPath -Raw) -ceq 'short-invalid-synthetic-token' -and -not (Test-Path -LiteralPath $dbPath)) 'invalid_token_preserved_without_database'
  Remove-Item -LiteralPath $tokenPath
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
  $listener.Start()
  try { Assert-Blocked { & (Join-Path $bundle 'Start.ps1') -InstallRoot $install } 'occupied_port_start_rejected' }
  finally { $listener.Stop() }
  Assert-True ((-not (Test-Path -LiteralPath $tokenPath)) -and (-not (Test-Path -LiteralPath $dbPath))) 'occupied_port_does_not_create_state'

  $failedReceiptRoot = Join-Path $testRoot 'receipt failure install'
  $failedReceiptPort = New-FreePort
  & (Join-Path $bundle 'Install.ps1') -InstallRoot $failedReceiptRoot -PythonPath $PythonPath -ChromePath $ChromePath -Port $failedReceiptPort | Out-Null
  $installedRoots.Add($failedReceiptRoot)
  New-Item -ItemType Directory -Path (Join-Path $failedReceiptRoot 'data\process.json') | Out-Null
  Assert-Blocked { & (Join-Path $bundle 'Start.ps1') -InstallRoot $failedReceiptRoot } 'receipt_write_failure_blocks_start'
  Start-Sleep -Milliseconds 200
  $freeAgain = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $failedReceiptPort)
  try { $freeAgain.Start(); Assert-True $true 'receipt_write_failure_leaves_no_orphan_listener' } finally { $freeAgain.Stop() }

  & (Join-Path $bundle 'Start.ps1') -InstallRoot $install | Out-Null
  $relayUrl = 'http://127.0.0.1:' + $port
  $relayToken = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
  $tokenBytes = [IO.File]::ReadAllBytes($tokenPath)
  $tokenHash = (Get-FileHash -LiteralPath $tokenPath).Hash
  $health = Invoke-RestMethod -Uri ($relayUrl + '/health') -UseBasicParsing -TimeoutSec 5
  Assert-True ($health.ok -eq $true -and $health.version -ceq '0.3.8' -and $health.bind -ceq ('127.0.0.1:' + $port)) 'real_relay_created_loopback_state'
  Assert-True ($relayToken.Length -ge 32 -and (Test-Path -LiteralPath $dbPath)) 'new_token_and_database_created_normally'
  Assert-True ((Job-Count) -eq 0) 'fresh_database_has_no_jobs'
  & (Join-Path $bundle 'Start.ps1') -InstallRoot $install | Out-Null
  $again = Invoke-RestMethod -Uri ($relayUrl + '/health') -UseBasicParsing -TimeoutSec 5
  Assert-True ($again.pid -eq $health.pid -and (Get-FileHash -LiteralPath $tokenPath).Hash -ceq $tokenHash) 'repeated_start_same_owned_process'

  $before = Job-Count
  Assert-Blocked { Invoke-Verification 'Ping' } 'no_heartbeat_blocks_ping'
  Assert-True ((Job-Count) -eq $before) 'no_heartbeat_does_not_enqueue'
  Heartbeat
  Set-SyntheticHeartbeatAge
  Assert-Blocked { Invoke-Verification 'Ping' } 'stale_heartbeat_blocks_ping'
  Assert-True ((Job-Count) -eq $before) 'stale_heartbeat_does_not_enqueue'
  Heartbeat @('RELAY_PING', 'ONES_INVENTORY_READ', 'ONES_FIELD_READ', 'ONES_ROOT_CAUSE_WRITE')
  Assert-Blocked { Invoke-Verification 'Ping' } 'write_capability_blocks_readonly_acceptance'
  Assert-True ((Job-Count) -eq $before) 'write_capability_does_not_enqueue'
  Heartbeat

  $workerPath = Join-Path $testRoot 'synthetic worker.py'
  [IO.File]::WriteAllText($workerPath, @'
import json, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
config = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
token = Path(config["tokenPath"]).read_text(encoding="utf-8-sig").strip()
executor = "synthetic-fresh-install"
def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
def post(path, body):
    req = urllib.request.Request(config["relayUrl"] + path, data=json.dumps(body).encode("utf-8"), headers={"X-Relay-Token": token, "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=3) as response:
        raw = response.read()
        return json.loads(raw) if raw else None
deadline = time.monotonic() + 10
while time.monotonic() < deadline:
    response = post("/v1/extension/claim", {"executorId": executor, "capabilities": ["RELAY_PING", "ONES_FIELD_READ"]})
    if response:
        job = response["job"]
        if job["jobType"] == "RELAY_PING":
            status = "RELAY_PING_OK"
            result = {"executorId": executor, "extensionVersion": "0.5.17", "receivedAt": now(), "echo": job["payload"]}
        else:
            status = "FIELD_READ_VERIFIED"
            payload = job["payload"]
            field = payload["fieldId"]
            task = payload["onesTaskUuids"][0]
            stamp = now()
            result = {"ok": True, "status": status, "schema": "ones.root-cause-field-read/v1alpha1", "capturedAt": stamp, "readOnly": True, "complete": True, "fieldId": field, "requestedTaskCount": 1, "reads": [{"onesTaskUuid": task, "fieldId": field, "status": "READ_VERIFIED", "value": config["value"], "capturedAt": stamp}], "relayJobId": job["jobId"], "relayExecutedAt": now()}
            variant = config["variant"]
            if variant == "field-mismatch": result["reads"][0]["fieldId"] = "field-synthetic-different"
            if variant == "task-mismatch": result["reads"][0]["onesTaskUuid"] = "synthetic-other-task"
            if variant == "job-mismatch": result["relayJobId"] = "synthetic-other-job"
            if variant == "stale-result": result["capturedAt"] = result["reads"][0]["capturedAt"] = result["relayExecutedAt"] = "2000-01-01T00:00:00.000Z"
        post("/v1/extension/result", {"jobId": job["jobId"], "executorId": executor, "status": status, "result": result})
        sys.exit(0)
    time.sleep(0.05)
sys.exit(2)
'@, $utf8)
  $worker = Start-SyntheticWorker
  $verification = Invoke-Verification 'Ping'
  Finish-SyntheticWorker $worker
  Assert-True (($verification | Out-String) -match 'PASS') 'synthetic_real_relay_ping_pass'
  foreach ($case in @(@('', 'BLANK'), @('synthetic confirmed cause', 'EQUAL'), @('synthetic different cause', 'CONFLICT'))) {
    $worker = Start-SyntheticWorker 'valid' $case[0]
    $verification = Invoke-Verification 'Field' 'synthetic confirmed cause'
    Finish-SyntheticWorker $worker
    Assert-True (($verification | Out-String) -match $case[1]) ('synthetic_field_' + $case[1])
  }
  $snapshots = @(Get-ChildItem -LiteralPath (Join-Path $install 'output') -Filter 'field-read-*.json' -File)
  Assert-True ($snapshots.Count -eq 3) 'exact_field_results_saved_locally'
  foreach ($snapshotFile in $snapshots) {
    $snapshot = Read-Json $snapshotFile.FullName
    Assert-True ($snapshot.readOnly -eq $true -and $snapshot.complete -eq $true -and $snapshot.relayJobId) 'saved_result_preserves_planner_contract'
  }
  $worker = Start-SyntheticWorker 'valid' "synthetic line one`r`nsynthetic line two"
  $verification = Invoke-Verification 'Field' "  synthetic line one`nsynthetic line two  "
  Finish-SyntheticWorker $worker
  Assert-True (($verification | Out-String) -match 'FIELD_VALUE_STATE=EQUAL') 'normalized_equal_value_matches_frozen_comparison'
  foreach ($variant in @('field-mismatch', 'task-mismatch', 'job-mismatch', 'stale-result')) {
    $worker = Start-SyntheticWorker $variant 'synthetic confirmed cause'
    Assert-Blocked { Invoke-Verification 'Field' 'synthetic confirmed cause' } ('reject_result_' + $variant)
    Finish-SyntheticWorker $worker
  }
  Assert-True (@(Get-ChildItem -LiteralPath (Join-Path $install 'output') -Filter 'field-read-*.json' -File).Count -eq 4) 'rejected_results_not_saved_as_verified'

  $verifySource = [IO.File]::ReadAllText((Join-Path $bundle 'Verify-ReadOnly.ps1'))
  # Simulate response loss only after the real server has accepted the single POST.
  # Run the actual caller with one throw inserted at that network boundary; no second submission.
  $responseLine = '$response = Invoke-FiRelay $i ''/v1/jobs'' ''POST'' @{jobId=$jobId; jobType=$jobType; idempotencyKey=$key; payload=$payload}'
  Assert-True ($verifySource.Contains($responseLine)) 'uncertain_delivery_probe_binds_exact_submit_boundary'
  $uncertainCode = $verifySource.Replace($responseLine, ($responseLine + "`nthrow 'SYNTHETIC_RESPONSE_LOST'"))
  $commonDirective = '. (Join-Path $PSScriptRoot ''Common.ps1'')'
  $commonProbePath = (Join-Path $bundle 'Common.ps1').Replace("'", "''")
  $uncertainCode = $uncertainCode.Replace($commonDirective, (". '" + $commonProbePath + "'"))
  $uncertainOutput = New-Object System.Collections.Generic.List[string]
  $jobsBeforeUncertain = Job-Count
  Assert-Blocked {
    & ([scriptblock]::Create($uncertainCode)) -InstallRoot $install -Mode Ping 6>&1 |
      ForEach-Object { $uncertainOutput.Add([string]$_) }
  } 'accepted_response_loss_blocks_without_retry' 'SYNTHETIC_RESPONSE_LOST'
  $idLine = @($uncertainOutput | Where-Object { $_ -match '^JOB_ID=' })
  Assert-True ($idLine.Count -eq 1 -and (Job-Count) -eq ($jobsBeforeUncertain + 1)) 'uncertain_delivery_identity_visible_and_one_post_only'
  $uncertainId = $idLine[0].Substring(7)
  $uncertainJob = (Relay-Request 'GET' ('/v1/jobs/' + $uncertainId)).job
  Assert-True ($uncertainJob.jobId -ceq $uncertainId -and $uncertainJob.jobType -ceq 'RELAY_PING') 'uncertain_delivery_is_readonly_and_recoverable_by_exact_id'

  $inputsRoot = Join-Path $testRoot 'trusted synthetic inputs'
  New-Item -ItemType Directory -Path $inputsRoot | Out-Null
  $casesInput = Join-Path $inputsRoot 'cases.json'
  $reconInput = Join-Path $inputsRoot 'recon.json'
  $readsInput = Join-Path $inputsRoot 'reads.json'
  Write-Json $casesInput @{}
  Write-Json $reconInput @{}
  $stamp = [DateTimeOffset]::UtcNow.ToString('o')
  Write-Json $readsInput @{schema='ones.root-cause-field-read/v1alpha1';readOnly=$true;complete=$true;fieldId='field-synthetic-root-cause';requestedTaskCount=1;capturedAt=$stamp;reads=@(@{onesTaskUuid='synthetic-task-001';fieldId='field-synthetic-root-cause';status='READ_VERIFIED';value=$null;capturedAt=$stamp})}
  $plannerArgs = @{InstallRoot=$install;Cases=$casesInput;Reconciliation=$reconInput;FieldReads=$readsInput;FieldId='field-synthetic-root-cause';CasesSha256=(Get-FileHash $casesInput).Hash.ToLowerInvariant();ReconciliationSha256=(Get-FileHash $reconInput).Hash.ToLowerInvariant();FieldReadsSha256=(Get-FileHash $readsInput).Hash.ToLowerInvariant()}
  Assert-Blocked { & (Join-Path $bundle 'Run-Planner.ps1') @plannerArgs } 'planner_null_read_value_never_becomes_blank' 'FRESH_FIELD_READ_EVIDENCE_REQUIRED'
  $plannerArgs.Cases = Join-Path $inputsRoot 'missing-cases.json'
  Assert-Blocked { & (Join-Path $bundle 'Run-Planner.ps1') @plannerArgs } 'planner_missing_trusted_inputs_block' 'TRUSTED_PLANNER_INPUT_MISSING'

  $before = Job-Count
  [IO.File]::WriteAllText($tokenPath, ('x' * 44), $utf8)
  try { Assert-Blocked { Invoke-Verification 'Ping' } 'invalid_running_token_blocks_verification' }
  finally { [IO.File]::WriteAllBytes($tokenPath, $tokenBytes) }
  Assert-True ((Job-Count) -eq $before) 'invalid_running_token_does_not_enqueue'
  $jobCountBeforeStop = Job-Count
  & (Join-Path $bundle 'Stop.ps1') -InstallRoot $install | Out-Null
  $dbHash = (Get-FileHash -LiteralPath $dbPath).Hash
  $preserveFile = Join-Path $install 'data\synthetic-checkpoint.json'
  [IO.File]::WriteAllText($preserveFile, '{"synthetic":true,"preserve":true}', $utf8)
  $preserveHash = (Get-FileHash -LiteralPath $preserveFile).Hash
  & (Join-Path $bundle 'Install.ps1') -InstallRoot $install -PythonPath $PythonPath -ChromePath $ChromePath -Port $port | Out-Null
  Assert-True ((Get-FileHash -LiteralPath $dbPath).Hash -ceq $dbHash -and (Get-FileHash -LiteralPath $preserveFile).Hash -ceq $preserveHash -and (Get-FileHash -LiteralPath $tokenPath).Hash -ceq $tokenHash) 'idempotent_reinstall_preserves_database_token_checkpoint'
  & (Join-Path $bundle 'Start.ps1') -InstallRoot $install | Out-Null
  Assert-True ((Job-Count) -eq $jobCountBeforeStop -and (Get-FileHash -LiteralPath $tokenPath).Hash -ceq $tokenHash) 'restart_preserves_jobs_and_token'

  $receiptPath = Join-Path $install 'data\process.json'
  $receiptText = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8
  $receipt = $receiptText | ConvertFrom-Json
  $otherArgs = '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 30"'
  $other = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $otherArgs -WindowStyle Hidden -PassThru
  try {
    $receipt.processId = $other.Id
    $receipt.startTimeUtc = $other.StartTime.ToUniversalTime().ToString('o')
    Write-Json $receiptPath $receipt
    Assert-Blocked { & (Join-Path $bundle 'Stop.ps1') -InstallRoot $install } 'stale_receipt_never_stops_unrelated_process'
    Assert-True (-not $other.HasExited) 'unrelated_process_still_alive'
    $still = Invoke-RestMethod -Uri ($relayUrl + '/health') -UseBasicParsing -TimeoutSec 5
    Assert-True ($still.ok -eq $true) 'owned_relay_preserved_on_receipt_mismatch'
  } finally {
    [IO.File]::WriteAllText($receiptPath, $receiptText, $utf8)
    if (-not $other.HasExited) { $other.Kill(); $other.WaitForExit(3000) | Out-Null }
  }
  & (Join-Path $bundle 'Stop.ps1') -InstallRoot $install | Out-Null
  Assert-True ((Test-Path -LiteralPath $dbPath) -and (Get-FileHash -LiteralPath $tokenPath).Hash -ceq $tokenHash) 'stop_preserves_database_and_token'
  Write-Host ('FRESH_INSTALL_TEST_PASS assertions=' + $passes)
  Write-Host 'CLEAN_INSTALL=PASS'
  Write-Host 'RESTART=PASS'
  Write-Host 'READONLY_GATE=PASS'
  Write-Host 'PRODUCTION_RUNTIME=NOT_RUN'
} finally {
  foreach ($process in $workerProcesses) { if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit(3000) | Out-Null } }
  $cleanupBlocked = $false
  foreach ($root in $installedRoots) {
    try { & (Join-Path $bundle 'Stop.ps1') -InstallRoot $root | Out-Null } catch {
      $cleanupBlocked = $true
      Write-Warning ('TEST_RELAY_CLEANUP_BLOCKED; isolated test root preserved: ' + $testRoot)
    }
  }
  $full = [IO.Path]::GetFullPath($testRoot)
  $temp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $full.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($full) -notlike 'ones-fresh-install-test-*') { throw 'UNSAFE_TEST_CLEANUP_TARGET' }
  if (-not $cleanupBlocked -and (Test-Path -LiteralPath $full)) {
    try { Remove-Item -LiteralPath $full -Recurse -Force } catch { Write-Warning ('TEST_ARTIFACT_CLEANUP_BLOCKED: ' + $testRoot) }
  }
}
