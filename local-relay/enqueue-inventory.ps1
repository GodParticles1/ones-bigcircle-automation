$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$tokenPath = Join-Path $PSScriptRoot "data\relay-token.txt"
if (-not (Test-Path $tokenPath)) { throw "relay token not found; start/install relay first" }
$token = (Get-Content $tokenPath -Raw).Trim()
$headers = @{ "X-Relay-Token" = $token }
$id = "manual-inventory-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$body = @{
  jobType = "ONES_INVENTORY_READ"
  idempotencyKey = $id
  payload = @{ requestedAt = [DateTime]::UtcNow.ToString("o"); source = "enqueue-inventory.ps1" }
} | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:18731/v1/jobs" -Headers $headers -ContentType "application/json" -Body $body | ConvertTo-Json -Depth 12
