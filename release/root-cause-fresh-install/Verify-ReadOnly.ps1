#requires -Version 5.1
param(
    [string]$InstallRoot=$PSScriptRoot,
    [ValidateSet('Status','Ping','Field')][string]$Mode='Status',
    [string]$TaskUuid, [string]$FieldId, [string]$ExpectedValue,
    [ValidateRange(1,120)][int]$TimeoutSeconds=45
)
. (Join-Path $PSScriptRoot 'Common.ps1')
$i = Get-FiInstallation $InstallRoot
$owned = Get-FiOwnedProcess $i
if (-not $owned) { throw 'RELAY_NOT_RUNNING' }
$executor = Assert-FiReadOnlyExecutor (Assert-FiHealth $i $owned)
if ($Mode -eq 'Status') {
    Write-Host 'READONLY_HANDSHAKE=PASS; WRITE_CAPABILITIES=ABSENT; WRITE_GATE=OFF'
    return
}
if ($Mode -eq 'Field' -and ($TaskUuid -notmatch '^[A-Za-z0-9_-]{1,128}$' -or $FieldId -notmatch '^[A-Za-z0-9_-]{1,128}$')) {
    throw 'FIELD_READ_IDENTITY_REQUIRED: explicitly supply one task UUID and field ID'
}
$began = [DateTimeOffset]::UtcNow
$jobId = [Guid]::NewGuid().ToString()
$jobType = if ($Mode -eq 'Ping') { 'RELAY_PING' } else { 'ONES_FIELD_READ' }
$payload = if ($Mode -eq 'Ping') { @{requestedAt=$began.ToString('o'); source='fresh-install-read-only'} }
    else { @{onesTaskUuids=@($TaskUuid); fieldId=$FieldId} }
$key = 'fresh-install-read-only-' + $jobId
# Each explicit invocation creates one new read-only identity. An uncertain POST is never retried.
Write-Host ('JOB_ID=' + $jobId)
$response = Invoke-FiRelay $i '/v1/jobs' 'POST' @{jobId=$jobId; jobType=$jobType; idempotencyKey=$key; payload=$payload}
if ($response.ok -cne $true -or $response.deduplicated -cne $false -or $response.job.jobId -cne $jobId) { throw 'FRESH_JOB_CREATION_NOT_PROVEN: no retry' }
$job = $null
while ([DateTimeOffset]::UtcNow -lt $began.AddSeconds($TimeoutSeconds)) {
    $currentExecutor = Assert-FiReadOnlyExecutor (Assert-FiHealth $i (Get-FiOwnedProcess $i))
    if ($currentExecutor.executorId -cne $executor.executorId) { throw 'EXECUTOR_DRIFT: read job left for explicit inspection' }
    $job = (Invoke-FiRelay $i ('/v1/jobs/' + $jobId)).job
    if ($job.jobId -cne $jobId -or $job.jobType -cne $jobType -or $job.idempotencyKey -cne $key) { throw 'JOB_IDENTITY_MISMATCH' }
    Assert-FiFreshTime $job.createdAt $began
    if ($job.executorId -and $job.executorId -cne $executor.executorId) { throw 'CLAIMED_EXECUTOR_MISMATCH' }
    if ($Mode -eq 'Field') {
        if ($job.payload.fieldId -cne $FieldId -or @($job.payload.onesTaskUuids).Count -ne 1 -or $job.payload.onesTaskUuids[0] -cne $TaskUuid) { throw 'FIELD_PAYLOAD_MISMATCH' }
    } elseif ($job.payload.source -cne $payload.source -or $job.payload.requestedAt -cne $payload.requestedAt) { throw 'PING_PAYLOAD_MISMATCH' }
    if ($job.state -notin @('PENDING','CLAIMED')) { break }
    Start-Sleep -Milliseconds 250
}
if ($null -eq $job -or $job.state -ne $(if ($Mode -eq 'Ping') { 'RELAY_PING_OK' } else { 'FIELD_READ_VERIFIED' })) {
    throw 'READONLY_JOB_NOT_VERIFIED: inspect this new Job ID; no automatic re-enqueue'
}
if ($job.executorId -cne $executor.executorId) { throw 'RESULT_EXECUTOR_MISMATCH' }
Assert-FiFreshTime $job.claimedAt $began
Assert-FiFreshTime $job.updatedAt $began
$result = $job.result
if ($Mode -eq 'Ping') {
    if ($result.executorId -cne $executor.executorId -or $result.extensionVersion -cne '0.5.17' -or
        $result.echo.source -cne $payload.source -or $result.echo.requestedAt -cne $payload.requestedAt) { throw 'PING_RESULT_IDENTITY_MISMATCH' }
    Assert-FiFreshTime $result.receivedAt $began
    Write-Host 'RELAY_PING=PASS; READONLY_GATE=PASS; WRITE_GATE=OFF'
    return
}
if ($result.ok -cne $true -or $result.status -cne 'FIELD_READ_VERIFIED' -or
    $result.schema -cne 'ones.root-cause-field-read/v1alpha1' -or $result.readOnly -cne $true -or
    $result.complete -cne $true -or $result.fieldId -cne $FieldId -or $result.requestedTaskCount -ne 1 -or
    $result.relayJobId -cne $jobId -or @($result.reads).Count -ne 1) { throw 'FIELD_RESULT_NOT_COMPLETE_OR_EXACT' }
$row = $result.reads[0]
if ($row.onesTaskUuid -cne $TaskUuid -or $row.fieldId -cne $FieldId -or $row.status -cne 'READ_VERIFIED' -or $row.value -isnot [string]) {
    throw 'FIELD_ROW_IDENTITY_OR_VALUE_INVALID'
}
foreach ($time in @($result.capturedAt,$result.relayExecutedAt,$row.capturedAt)) { Assert-FiFreshTime $time $began }
$semantic = $row.value.Replace("`r`n", "`n").Replace("`r", "`n").Trim()
$expected = $ExpectedValue.Replace("`r`n", "`n").Replace("`r", "`n").Trim()
$state = if ($semantic -ceq '') { 'BLANK' }
    elseif ($PSBoundParameters.ContainsKey('ExpectedValue') -and $semantic -ceq $expected) { 'EQUAL' } else { 'CONFLICT' }
$file = Join-Path $i.Root ('output/field-read-' + $jobId + '.json')
Write-FiJson $file $result
Write-Host 'FIELD_READ=PASS; READONLY_GATE=PASS; WRITE_GATE=OFF'
Write-Host ('FIELD_VALUE_STATE=' + $state)
Write-Host ('FIELD_READ_FILE=' + $file)
Write-Host ('FIELD_READ_SHA256=' + (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant())
Write-Host 'STOP=READONLY_BARRIER; OPERATOR_RELEASE=HOLD_WRITER_FIX'
