$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$tokenPath = Join-Path $PSScriptRoot "data\relay-token.txt"
if (-not (Test-Path $tokenPath)) { throw "relay token not found; start relay first" }
$token = (Get-Content $tokenPath -Raw).Trim()
$headers = @{ "X-Relay-Token" = $token }
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:18731/v1/stats" -Headers $headers | ConvertTo-Json -Depth 10
