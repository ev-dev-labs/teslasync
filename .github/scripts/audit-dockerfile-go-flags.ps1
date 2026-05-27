# Phase-45 / Prompt 10
# Asserts every Dockerfile* (except .web) that builds a Go binary uses
# the memory-conservative compile flags. Exits non-zero on regression.

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$failures = @()
$dockerfiles = Get-ChildItem -Path $repoRoot -Filter 'Dockerfile*' -File |
  Where-Object { $_.Name -notmatch '\.web$' }

foreach ($df in $dockerfiles) {
  $content = Get-Content $df.FullName -Raw
  if ($content -notmatch 'GOMEMLIMIT=2GiB') { $failures += "$($df.Name): missing GOMEMLIMIT=2GiB" }
  if ($content -notmatch '-p 2')            { $failures += "$($df.Name): missing -p 2" }
  if ($content -notmatch '-gcflags=all=-l') { $failures += "$($df.Name): missing -gcflags=all=-l" }
}

if ($failures) {
  Write-Host "Dockerfile Go-flag audit failures:" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "  $_" }
  exit 1
}
Write-Host "Dockerfile Go-flag audit: OK ($($dockerfiles.Count) files)" -ForegroundColor Green
exit 0
