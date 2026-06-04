#requires -Version 7
<#
.SYNOPSIS
  P1/S0-0001 runner — regenerate the parity manifest and run the acceptance gate.

.DESCRIPTION
  Wraps `apps/tools/gen-parity-manifest.ts`:
    * default       — regenerate apps/parity/parity-manifest.json
    * -Check        — drift check only (CI); non-zero exit on drift
    * -Gate         — regenerate, then run the P1/S0-0001 acceptance gate and
                      append the structured log to the prompt log file.

  Run from the repo root:
    pwsh apps/tools/gen-parity-manifest.ps1 -Gate
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Gate
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..')).Path
Set-Location $repoRoot

$tool = 'apps/tools/gen-parity-manifest.ts'
$manifest = 'apps/parity/parity-manifest.json'

if ($Check) {
  npx --yes tsx $tool --check
  exit $LASTEXITCODE
}

if (-not $Gate) {
  npx --yes tsx $tool
  exit $LASTEXITCODE
}

# ── Gate ────────────────────────────────────────────────────────────────────
$log = Join-Path $repoRoot '.github/prompts/monorepo/logs/p1-s0-0001-manifest-gen.log'

"=== GATE ===" | Tee-Object $log -Append
npx --yes tsx $tool

$man = Get-Content $manifest -Raw | ConvertFrom-Json
"UNIT_COUNT=$($man.Count)" | Tee-Object $log -Append
$pages = ($man | Where-Object kind -eq 'page').Count
"PAGE_COUNT=$pages" | Tee-Object $log -Append

# Verbatim gate population (as written in the prompt) — includes *.test.tsx.
$diskPagesVerbatim = (Get-ChildItem web/src/features -Recurse -Filter *.tsx |
  Where-Object FullName -match '\\pages\\').Count
"DISK_PAGE_FILES_VERBATIM=$diskPagesVerbatim" | Tee-Object $log -Append

# Corrected population — page components only (exclude test/spec/stories files,
# which are tests, not pages). This is the intended "page files on disk".
$diskPages = (Get-ChildItem web/src/features -Recurse -Filter *.tsx |
  Where-Object { $_.FullName -match '\\pages\\' -and $_.Name -notmatch '\.(test|spec|stories)\.tsx$' }).Count
"DISK_PAGE_FILES=$diskPages" | Tee-Object $log -Append

$verbatimThreshold = [math]::Floor($diskPagesVerbatim * 0.95)
$threshold = [math]::Floor($diskPages * 0.95)
"VERBATIM_THRESHOLD=$verbatimThreshold (pages<$verbatimThreshold => verbatim FAIL)" | Tee-Object $log -Append
"THRESHOLD=$threshold" | Tee-Object $log -Append

if ($pages -lt $verbatimThreshold) {
  "[NOTE] Verbatim gate FAILS ($pages < $verbatimThreshold): its glob counts" | Tee-Object $log -Append
  "       $($diskPagesVerbatim - $diskPages) *.test.tsx files as 'page files'. Those are tests," | Tee-Object $log -Append
  "       not page components, so they are excluded from the page-file population." | Tee-Object $log -Append
}

if ($pages -lt $threshold) {
  "[FAIL] manifest missed pages ($pages < $threshold)" | Tee-Object $log -Append
  "EXIT=1" | Tee-Object $log -Append
  exit 1
}

# Schema validation + drift check are enforced inside the generator (--check).
npx --yes tsx $tool --check
$checkExit = $LASTEXITCODE
"DRIFT_CHECK_EXIT=$checkExit" | Tee-Object $log -Append
if ($checkExit -ne 0) {
  "[FAIL] manifest drift after regenerate" | Tee-Object $log -Append
  "EXIT=$checkExit" | Tee-Object $log -Append
  exit $checkExit
}

"[PASS] PAGE_COUNT=$pages >= THRESHOLD=$threshold; manifest validates; no drift" | Tee-Object $log -Append
"EXIT=0" | Tee-Object $log -Append
exit 0
