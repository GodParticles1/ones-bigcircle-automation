#requires -Version 5.1
param([string]$InstallRoot=$PSScriptRoot)
. (Join-Path $PSScriptRoot 'Common.ps1')
$i = Get-FiInstallation $InstallRoot
[void](Get-FiPython $i.Config.pythonPath)
$owned = Get-FiOwnedProcess $i
if ($owned) {
    [void](Assert-FiHealth $i $owned)
    Write-Host 'START=ALREADY_RUNNING'
    Write-Host ('PID=' + $owned.Id)
    return
}
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $i.Config.port)
try { $listener.Start() } catch { throw 'PORT_CONFLICT: no process stopped and no new state generated' } finally { $listener.Stop() }
$data = Join-Path $i.Root 'data'
if (Test-Path -LiteralPath (Join-Path $data 'relay.db') -PathType Leaf) {
    if (-not (Test-Path -LiteralPath (Join-Path $data 'relay-token.txt') -PathType Leaf)) { throw 'EXISTING_DB_WITHOUT_TOKEN: preserved; no fabricated restoration' }
}
if (Test-Path -LiteralPath (Join-Path $data 'relay-token.txt') -PathType Leaf) { [void](Get-FiToken $i.Root) }
$script = Join-Path $i.Root 'components/local-relay/relay.py'
$args = @(('"' + $script + '"'), '--data-dir', ('"' + $data + '"'), '--port', [string]$i.Config.port,
    '--error-log', ('"' + (Join-Path $data 'relay-error.log') + '"'))
$proc = Start-Process -FilePath $i.Config.pythonPath -ArgumentList $args -WorkingDirectory $i.Root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $data 'relay-stdout.log') -RedirectStandardError (Join-Path $data 'relay-stderr.log')
$started = $proc.StartTime.ToUniversalTime()
try {
    Write-FiJson (Join-Path $data 'process.json') @{processId=$proc.Id; startTimeUtc=$started.ToString('o')}
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 200
        $proc.Refresh()
        if ($proc.HasExited) { throw 'RELAY_EXITED: inspect local data/relay-stderr.log' }
        try {
            $owned = Get-FiOwnedProcess $i
            [void](Assert-FiHealth $i $owned)
            Write-Host 'START=PASS'
            Write-Host ('PID=' + $owned.Id)
            Write-Host ('LOOPBACK_URL=http://127.0.0.1:' + $i.Config.port)
            Write-Host ('TOKEN_FILE=' + (Join-Path $data 'relay-token.txt'))
            Write-Host 'WRITE_GATE=OFF; OPERATOR_RELEASE=HOLD_WRITER_FIX'
            return
        } catch { if ($attempt -eq 29) { throw } }
    }
} catch {
    # The returned child is owned by this invocation even if its receipt could not be written.
    # Compare creation time and executable before cleanup; no stale receipt chooses this PID.
    $child = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
    if ($child -and $child.StartTime.ToUniversalTime().Ticks -eq $started.Ticks -and $child.Path -ieq $i.Config.pythonPath) {
        $child.Kill()
        [void]$child.WaitForExit(5000)
    }
    throw
}
