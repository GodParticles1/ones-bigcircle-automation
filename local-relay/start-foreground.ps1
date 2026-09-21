$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (Get-Command py.exe -ErrorAction SilentlyContinue) {
  & py -3 .\relay.py --foreground
} elseif (Get-Command python.exe -ErrorAction SilentlyContinue) {
  & python .\relay.py --foreground
} else {
  throw "Python 3 not found in PATH"
}
