# Start DSH with Code Mode released (CODE-09 + CODE-10)
#
# The host must be started with BOTH:
#   - DSH_PTC_CONFINEMENT_EVIDENCE pointing at an artifact recorded for THIS package
#     version (scripts/record-confinement-evidence.mjs writes it only when every
#     confinement arm passes), and
#   - TMP/TEMP on a directory where the Windows ACL sandbox can provision its grants.
#     `%TEMP%` is commonly a directory whose inherited ACL grants no WRITE_DAC, and the
#     sandbox then reports `SetNamedSecurityInfoW failed (Win32 5)`.
#
# Stop the running host first (it owns the port), then run from anywhere:
#   pwsh -File scripts/dsh-code-mode.ps1 -Port 3080
param(
  [int]$Port = 3080,
  [string]$Evidence = (Join-Path (Split-Path -Parent $PSScriptRoot) 'verification/ptc-confinement-evidence.json'),
  [string]$TempRoot = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '.dsh-confinement-tmp'),
  [string]$Harness = 'D:\deepseek-harness'
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Evidence)) {
  throw "No confinement evidence at $Evidence. Run: node packages/dsh-tool-mode/scripts/record-confinement-evidence.mjs"
}
New-Item -ItemType Directory -Force -Path $TempRoot | Out-Null
$user = "$env:USERDOMAIN\$env:USERNAME"
& icacls $TempRoot /grant "${user}:(OI)(CI)F" /T | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not grant the temp root ACL on $TempRoot" }

$env:DSH_PTC_CONFINEMENT_EVIDENCE = (Resolve-Path $Evidence).Path
$env:TMP = $TempRoot
$env:TEMP = $TempRoot
Write-Host "Code Mode: evidence=$env:DSH_PTC_CONFINEMENT_EVIDENCE"
Write-Host "Code Mode: temp=$TempRoot"
Write-Host "Starting the web host on port $Port (the profile must set hostedCode: true)"

$checkoutEntry = Join-Path $Harness 'apps/cli/src/bin.ts'
if (Test-Path $checkoutEntry) {
  & node --import tsx/esm $checkoutEntry --profile web --port $Port
} else {
  & dsh --profile web --port $Port
}
