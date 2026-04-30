---
description: "Phase 37 - Re-run gates against the six new automation_handler files and the trimmed source file"
---

# Prompt 08 - Validate Split of automation_handler.go

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-37-08-validate-automation-handler-split.log` |
| Depends on | [`.github/prompts/db-refactor/logs/phase-37-07-split-automation-handler-test-run.log`](../logs/phase-37-07-split-automation-handler-test-run.log) STATUS=DONE |
| Allowed files to change | `.github/prompts/db-refactor/logs/phase-37-08-validate-automation-handler-split.log` (validation log only - no source edits permitted) |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. No red-as-green - EXIT != 0 means STATUS=BLOCKED, no exceptions.
2. No scope narrowing - run the exact gate command, no subsets.
3. No skip-and-assume - cannot run gate means BLOCKED, never DONE.
4. No field resurrection - do not add back deleted fields to "fix" things.
5. No stubs - no `return nil`, `// TODO`, or `panic("not impl")`.
6. No delegation - NO sub-agents, NO parallel, NO background tasks.
7. No predecessor bypass - verify predecessor STATUS=DONE first when a predecessor exists.
8. No commit on red - commit only the log when BLOCKED.
9. No silent drift - `git status` outside allowed files means BLOCKED.
10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED> on their own lines.
<!-- END COVENANT -->

## Logging Requirements

Append the following sections to the log in order: `## PREFLIGHT`, `## SURVEY`, `## REASONING`, `## CHANGES`, `## GATE`, `## COMMIT`. The GATE section MUST end with two lines containing exactly `EXIT=<int>` and `STATUS=DONE` or `STATUS=BLOCKED`.

## Problem

The preceding split prompts decomposed `internal/api/automation_handler.go` into multiple cohesive files in
package `api`. This prompt validates that the split preserved all behavior,
public APIs, SQL, JSON, route, config, and runtime ordering. **No `.go` file
may be edited in this prompt.** If a regression is found, mark BLOCKED and
defer the fix to a follow-up prompt.

Some predecessor split prompts may have legitimately taken the **G3 deferral
escape hatch** (`STATUS=DEFERRED`) - typically because an earlier split already
absorbed their cohesive area, leaving nothing to extract. The SURVEY step below
checks each predecessor's log: an expected file that is missing **only because
its source split was DEFERRED** is treated as `SKIP-DEFERRED`, not as drift.
A file missing while its source split is `STATUS=DONE` is real drift and BLOCKS.

## Action Steps

1. Verify predecessor: `.github/prompts/db-refactor/logs/phase-37-07-split-automation-handler-test-run.log` exists with `EXIT=0` and
   `STATUS=DONE` or `STATUS=DEFERRED`.
2. For every expected file, look up the split prompt that was supposed to
   produce it and check that prompt's log STATUS:
  - `internal/api/automation_handler.go`
  - `internal/api/automation_handler_dtos.go`
  - `internal/api/automation_handler_decode.go`
  - `internal/api/automation_handler_step_parsers.go`
  - `internal/api/automation_handler_crud.go`
  - `internal/api/automation_handler_history.go`
  - `internal/api/automation_handler_test_run.go`
   - If file exists: confirm it declares `package api`.
   - If file missing and source split STATUS=DEFERRED: record SKIP-DEFERRED.
   - If file missing and source split STATUS=DONE: BLOCKED.
3. Re-run `gofmt -l` on every expected file that exists (output must be empty).
4. Re-run `go build ./...`, `go vet ./internal/api`, and
   `go test ./internal/api -race -count=1`.
5. Inspect the diff range covered by the split commits and confirm:
   - no exported identifier was renamed or removed
   - no JSON tag, SQL string literal, error message, or log field changed
   - no route registration moved or changed path/method
   - no config key was added, removed, or renamed
   - import ordering changes are limited to gofmt-managed grouping
6. Do not edit any `.go` file. The only file permitted to change in this
   prompt is the validation log itself.

## Gate

```powershell
$log = '.github/prompts/db-refactor/logs/phase-37-08-validate-automation-handler-split.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"## PREFLIGHT" | Set-Content -Path $log
"start_utc=$([DateTimeOffset]::UtcNow.ToString('o'))" | Add-Content $log
"go_version=$((go version 2>$null) -replace '\s+',' ')" | Add-Content $log
"engineer_email=$((git config user.email 2>$null))" | Add-Content $log
"powershell_version=$($PSVersionTable.PSVersion.ToString())" | Add-Content $log
"os_platform=$($PSVersionTable.Platform)" | Add-Content $log
$exit = 0

$prev = '.github/prompts/db-refactor/logs/phase-37-07-split-automation-handler-test-run.log'
if (-not (Test-Path $prev)) { "predecessor log missing: $prev" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^EXIT=0$' -Quiet)) { "predecessor not EXIT=0" | Add-Content $log; $exit = 1 }
elseif (-not (Select-String -Path $prev -Pattern '^STATUS=(DONE|DEFERRED)$' -Quiet)) { "predecessor STATUS not DONE or DEFERRED" | Add-Content $log; $exit = 1 }

"## SURVEY" | Add-Content $log
$expected = @(
  @{ Path = 'internal/api/automation_handler.go'; SrcNum = 0; SrcSlug = '' },
  @{ Path = 'internal/api/automation_handler_dtos.go'; SrcNum = 2; SrcSlug = 'split-automation-handler-dtos' },
  @{ Path = 'internal/api/automation_handler_decode.go'; SrcNum = 3; SrcSlug = 'split-automation-handler-decode-validate' },
  @{ Path = 'internal/api/automation_handler_step_parsers.go'; SrcNum = 4; SrcSlug = 'split-automation-handler-step-parsers' },
  @{ Path = 'internal/api/automation_handler_crud.go'; SrcNum = 5; SrcSlug = 'split-automation-handler-crud' },
  @{ Path = 'internal/api/automation_handler_history.go'; SrcNum = 6; SrcSlug = 'split-automation-handler-history' },
  @{ Path = 'internal/api/automation_handler_test_run.go'; SrcNum = 7; SrcSlug = 'split-automation-handler-test-run' }
)
$existing = New-Object System.Collections.Generic.List[string]
foreach ($e in $expected) {
  $f = $e.Path
  if (Test-Path $f) {
    $head = (Get-Content -LiteralPath $f -TotalCount 80) -join "`n"
    if ($head -notmatch '(?m)^package\s+api\b') {
      "wrong package decl in $f (expected package api)" | Add-Content $log
      $exit = 1
    }
    $lc = (Get-Content -LiteralPath $f | Measure-Object -Line).Lines
    "expected_file=$f lines=$lc" | Add-Content $log
    $existing.Add($f) | Out-Null
  } else {
    if ($e.SrcNum -eq 0) {
      "missing source file: $f (this is the original; must remain in tree)" | Add-Content $log
      $exit = 1
    } else {
      $srcLog = ".github/prompts/db-refactor/logs/phase-37-$('{0:D2}' -f $e.SrcNum)-$($e.SrcSlug).log"
      if (-not (Test-Path $srcLog)) {
        "missing expected file: $f (source prompt $($e.SrcNum) $($e.SrcSlug) - log not found)" | Add-Content $log
        $exit = 1
      } elseif (Select-String -Path $srcLog -Pattern '^STATUS=DEFERRED$' -Quiet) {
        "SKIP-DEFERRED: $f (source prompt $($e.SrcNum) $($e.SrcSlug) STATUS=DEFERRED - cohesive area absorbed by another split or otherwise non-extractable)" | Add-Content $log
      } elseif (Select-String -Path $srcLog -Pattern '^STATUS=DONE$' -Quiet) {
        "missing expected file: $f (source prompt $($e.SrcNum) $($e.SrcSlug) STATUS=DONE - real drift)" | Add-Content $log
        $exit = 1
      } else {
        "missing expected file: $f (source prompt $($e.SrcNum) $($e.SrcSlug) STATUS not DONE/DEFERRED)" | Add-Content $log
        $exit = 1
      }
    }
  }
}

"## REASONING" | Add-Content $log
"validation only - confirm split preserved behavior, no source edits" | Add-Content $log
"existing_files_count=$($existing.Count)" | Add-Content $log

"## CHANGES" | Add-Content $log
"none (validation only)" | Add-Content $log

"## GATE" | Add-Content $log
$env:CGO_ENABLED = '0'
if ($existing.Count -gt 0) {
  $gofmtOut = & gofmt -l @($existing) 2>&1
  if ($LASTEXITCODE -ne 0 -or $gofmtOut) {
    "gofmt issues:" | Add-Content $log
    $gofmtOut | Out-String | Add-Content $log
    $exit = 1
  }
} else {
  "skipping gofmt - no expected files exist (all sources deferred?)" | Add-Content $log
  $exit = 1
}

# Fast-fail: build the affected package first, then the whole repo
$pkgDir = 'internal/api'
$pkgBuildOut = & go build "./$pkgDir/..." 2>&1
$pkgBuildExit = $LASTEXITCODE
"go build ./$pkgDir/... exit=$pkgBuildExit" | Add-Content $log
$pkgBuildOut | Out-String | Add-Content $log
if ($pkgBuildExit -ne 0) { $exit = 1 }

if ($exit -eq 0) {
  $buildOut = & go build ./... 2>&1
  $buildExit = $LASTEXITCODE
  "go build ./... exit=$buildExit" | Add-Content $log
  $buildOut | Out-String | Add-Content $log
  if ($buildExit -ne 0) { $exit = 1 }
} else {
  "skipping go build ./... because package build failed" | Add-Content $log
}

if ($exit -eq 0) {
  $vetOut = & go vet ./internal/api 2>&1
  $vetExit = $LASTEXITCODE
  "go vet exit=$vetExit" | Add-Content $log
  $vetOut | Out-String | Add-Content $log
  if ($vetExit -ne 0) { $exit = 1 }
} else {
  "skipping go vet because earlier step failed" | Add-Content $log
}

if ($exit -eq 0) {
  # -race requires CGO. Scope CGO_ENABLED=1 to the test step only; restore project default after.
  $env:CGO_ENABLED = '1'
  $testOut = & go test ./internal/api -race -count=1 2>&1
  $testExit = $LASTEXITCODE
  $env:CGO_ENABLED = '0'
  "go test exit=$testExit (race=on, cgo=1 for this step only)" | Add-Content $log
  $testOut | Out-String | Add-Content $log
  if ($testExit -ne 0) { $exit = 1 }
} else {
  "skipping go test because earlier step failed" | Add-Content $log
}

$drift = git --no-pager status --short
if ($drift) {
  $allowed = '^\s*[?MAR]+\s+\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-37-08-validate-automation-handler-split\.log$'
  $bad = $drift | Where-Object { $_ -notmatch $allowed }
  if ($bad) {
    "drift detected (validation prompts must not edit Go files):" | Add-Content $log
    $bad | Add-Content $log
    $exit = 1
  }
}

"EXIT=$exit" | Add-Content $log
if ($exit -eq 0) { "STATUS=DONE" | Add-Content $log } else { "STATUS=BLOCKED" | Add-Content $log }
exit $exit
```

## Commit

```powershell
git add -f '.github/prompts/db-refactor/logs/phase-37-08-validate-automation-handler-split.log'
git commit -m "chore(phase-37): prompt 08 - validate split of internal/api/automation_handler.go" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If `STATUS=BLOCKED`, do not author a fix prompt yet. Re-read the failing
output, mark the validation log committed, and decide whether to defer the
fix as a follow-up prompt or to revert the split commits and retry.
