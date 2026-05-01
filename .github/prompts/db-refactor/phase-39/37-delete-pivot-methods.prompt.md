---
description: "Phase 39 - delete SignalLogReader pivot methods (compile-time enforcement)"
---

# Prompt 37 - Delete SignalLogReader.SignalTracePivot{,Flat} + PivotMapping/Row types

> **Severity:** Deletion | **Atomic:** yes (1 file, ~150 ln removed) | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-39-37-delete-pivot-methods.log` |
| Depends on | `phase-39-36-migrate-chatbot-positions.log` |
| Allowed files to change | `internal/database/signal_log_reader_query.go`, log file |

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

Write `=== PREFLIGHT ===`, `=== DELETED ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

The pivot methods on `database.SignalLogReader` are the broken state-read primitives. They MUST be deleted from the codebase so the compiler enforces that no future handler can re-introduce the bug.

This prompt is the **compile-time gate** for migrations 10-36 of the pivot family. If `go build ./...` fails after deletion, a handler still references the old method — fix that handler in a follow-up before this prompt can be DONE.

## Action Steps

> **Note (post Phase 37 split):** All four pivot symbols and the keep-list
> aggregations `SignalTrace` + `LatestTimestamp` now live in
> `internal/database/signal_log_reader_query.go` (split commit 7530c1c7c).
> The remaining keep-list aggregations (`BrickVoltageHistory`, `DriveAggregates`,
> `RegenEnergy`, `ChargeAggregates`) live in `signal_log_reader_aggregations.go`
> and are NOT touched by this prompt.

1. Open `internal/database/signal_log_reader_query.go`.
2. **Delete** the following symbols:
   - `func (r *SignalLogReader) SignalTracePivot(...)`
   - `func (r *SignalLogReader) SignalTracePivotFlat(...)`
   - `type PivotMapping struct { ... }`
   - `type PivotRow struct { ... }` (or equivalent type returned by the pivot funcs)
3. **KEEP** all aggregation methods: `SignalTrace`, `BrickVoltageHistory`, `DriveAggregates`, `RegenEnergy`, `ChargeAggregates`, `LatestTimestamp`. These are valid change-feed reads.
4. Run `gofmt -w internal/database/signal_log_reader_query.go`.
5. Run `go build ./...` — if this fails, a caller is still using the old method (Migrations 10-36 must have skipped a file). Fix the caller before continuing.
6. Run `go test ./...` to ensure no regression.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-39-37-delete-pivot-methods.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-39-36-migrate-chatbot-positions.log"
if (-not (Test-Path $prev) -or -not (Select-String -Path $prev -Pattern "^EXIT=0$" -Quiet) -or -not (Select-String -Path $prev -Pattern "^STATUS=DONE$" -Quiet)) {
  "Predecessor log missing or not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

$src = "internal\database\signal_log_reader_query.go"

$anchors = @{
  "FILE_EXISTS"             = (Test-Path $src)
  "NO_SIGNALTRACEPIVOT"     = -not (Select-String -Path $src -Pattern "func \(r \*SignalLogReader\) SignalTracePivot\(" -Quiet)
  "NO_SIGNALTRACEPIVOTFLAT" = -not (Select-String -Path $src -Pattern "func \(r \*SignalLogReader\) SignalTracePivotFlat\(" -Quiet)
  "NO_PIVOTMAPPING_TYPE"    = -not (Select-String -Path $src -Pattern "^type PivotMapping " -Quiet)
  "NO_PIVOTROW_TYPE"        = -not (Select-String -Path $src -Pattern "^type PivotRow " -Quiet)
  "AGGS_KEPT_TRACE"         = (Select-String -Path $src -Pattern "func \(r \*SignalLogReader\) SignalTrace\(" -Quiet)
  "AGGS_KEPT_LATESTTS"      = (Select-String -Path $src -Pattern "LatestTimestamp" -Quiet)
}
foreach ($k in $anchors.Keys) { "$k=$($anchors[$k])" | Tee-Object -FilePath $log -Append }
if ($anchors.Values -contains $false) { "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

$env:CGO_ENABLED = "0"
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
$buildExit = $LASTEXITCODE
if ($buildExit -ne 0) {
  "BUILD FAILED — a caller still references SignalTracePivot. Fix that caller, do not re-add the method." | Tee-Object -FilePath $log -Append
  "EXIT=$buildExit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $buildExit
}

go test ./... 2>&1 | Tee-Object -FilePath $log -Append
$testExit = $LASTEXITCODE
"GO_TEST_EXIT=$testExit" | Tee-Object -FilePath $log -Append
if ($testExit -ne 0) { "EXIT=$testExit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $testExit }

$status = git --no-pager status --short
$unexpected = $status | Where-Object {
  $_ -notmatch "internal[\\/]database[\\/]signal_log_reader_query\.go$" -and
  $_ -notmatch "\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-39-37-delete-pivot-methods\.log$"
}
"UNEXPECTED_STATUS_COUNT=$(@($unexpected).Count)" | Tee-Object -FilePath $log -Append
if ($unexpected) { $unexpected | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
```

## Commit

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-39-37-delete-pivot-methods.log"
git add -f -- internal\database\signal_log_reader_query.go $log
git commit -m "phase-39/37: delete SignalLogReader pivot methods + types (compile-time enforcement)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If predecessor missing, any anchor false, or build/test non-zero, write `STATUS=BLOCKED`, commit only the log, exit non-zero. **Build failure here = a migration prompt missed a file.**
