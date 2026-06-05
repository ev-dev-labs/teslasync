#requires -Version 7
<#
.SYNOPSIS
  P1/S10-0001 runner — generate the neutral i18n catalog + per-platform resources,
  or run the completeness / drift check.

.DESCRIPTION
  Wraps `apps/shared/i18n/generators/gen-i18n.ts`:
    * default   — (re)write apps/shared/i18n/catalog/** + native resources.
    * -Check    — read/compare-only completeness + drift gate (CI); non-zero on drift.
    * -Gate     — run GEN then -Check, append the structured P1/S10-0001 log, and end
                  the log with EXIT=<int> / STATUS=<DONE|BLOCKED>.

  Run from the repo root:
    pwsh apps/shared/i18n/generators/gen-i18n.ps1 -Gate
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Gate
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..' '..' '..' '..')).Path
Set-Location $repoRoot

$tool = 'apps/shared/i18n/generators/gen-i18n.ts'

if (-not $Gate) {
  if ($Check) {
    npx --yes tsx $tool --check
  } else {
    npx --yes tsx $tool
  }
  exit $LASTEXITCODE
}

# ── Gate ────────────────────────────────────────────────────────────────────
$log = Join-Path $repoRoot '.github/prompts/monorepo/logs/p1-s10-0001-i18n.log'

"P1/S10/0001 i18n catalog + resource generators — artifact log" | Set-Content $log
"=== GATE ===" | Tee-Object $log -Append

npx --yes tsx $tool 2>&1 | Tee-Object $log -Append
$genExit = $LASTEXITCODE
"GEN_EXIT=$genExit" | Tee-Object $log -Append

npx --yes tsx $tool --check 2>&1 | Tee-Object $log -Append
$checkExit = $LASTEXITCODE
"COMPLETE_EXIT=$checkExit" | Tee-Object $log -Append

if ($genExit -ne 0 -or $checkExit -ne 0) {
  "[FAIL] gen=$genExit check=$checkExit" | Tee-Object $log -Append
  "EXIT=1" | Tee-Object $log -Append
  "STATUS=BLOCKED" | Tee-Object $log -Append
  exit 1
}

"[PASS] catalog generated; completeness + drift check clean" | Tee-Object $log -Append
"EXIT=0" | Tee-Object $log -Append
"STATUS=DONE" | Tee-Object $log -Append
exit 0
