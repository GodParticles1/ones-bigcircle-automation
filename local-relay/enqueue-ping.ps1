$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$tokenPath = Join-Path $PSScriptRoot "data\relay-token.txt"
if (-not (Test-Path $tokenPath)) { throw "relay token not found; start relay first" }
$token = (Get-Content $tokenPath -Raw).Trim()
$headers = @{ "X-Relay-Token" = $token }
$id = "manual-ping-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$body = @{
  jobType = "RELAY_PING"
  idempotencyKey = $id
  payload = @{ requestedAt = [DateTime]::UtcNow.ToString("o"); source = "enqueue-ping.ps1" }
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:18731/v1/jobs" -Headers $headers -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 10
