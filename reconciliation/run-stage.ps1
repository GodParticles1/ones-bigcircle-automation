param(
    [Parameter(Mandatory=$true)][string]$Inventory,
    [Parameter(Mandatory=$true)][string]$Cases,
    [string]$StateDir = ".\state",
    [string]$OutputDir = ".\output",
    [string]$People = ""
)

$ErrorActionPreference = "Stop"

$argsList = @(
    ".\pipeline.py",
    "--inventory", $Inventory,
    "--cases", $Cases,
    "--state-dir", $StateDir,
    "--output-dir", $OutputDir
)

if ($People.Trim()) {
    $argsList += @("--people", $People)
}

& python @argsList
exit $LASTEXITCODE
