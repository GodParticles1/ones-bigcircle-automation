# Copy to config.ps1 and edit only local paths / provider URL.
$BaseUrl = "https://REPLACE_WITH_TRANSPORT_WORKER_HOST"
$SecretFile = Join-Path $PSScriptRoot "data\windows-hmac-secret.txt"
$SpoolRoot = Join-Path $PSScriptRoot "runtime\spool"
$CaseFeedDir = Join-Path $PSScriptRoot "runtime\case-feeds"
$AgentRuntimeDir = Join-Path $PSScriptRoot "runtime\agent"

# Existing accepted Windows components from the previous iteration.
$RelayDir = "D:\tools\ones-local-relay-v0.2.1"
$ReconciliationDir = "D:\tools\ones-bigcircle-reconciliation-v0.2.1"
$PeriodicRuntimeDir = "D:\tools\periodic-alignment-runtime"
