---
description: "Phase 39 - delete SignalLogReader.SignalAt"
---

# Prompt 39 - Delete SignalLogReader.SignalAt

> **Severity:** Deletion | **Atomic:** yes (1 file, ~30 ln removed) | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-39-39-delete-signalat-method.log` |
| Depends on | `phase-39-38-delete-snapshot-methods.log` |
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

`SignalLogReader.SignalAt(ctx, vID, signalName, at)` returns the latest row WITH `created_at <= at` for ONE signal. The bug: if no row exists in the recent window (signal hasn't re-emitted), it returns nothing — instead of the actual current value (which is whatever it was at the last emission, regardless of how old).

The replacement is `signal.StateReader.SignalAt` which forward-folds across the entire history.

## Action Steps

> **Note (post Phase 37 split):** `SignalAt` now lives in
> `internal/database/signal_log_reader_query.go` (split commit 7530c1c7c).

1. Open `internal/database/signal_log_reader_query.go`.
2. Delete `func (r *SignalLogReader) SignalAt(...)`.
3. Run `gofmt -w` then `go build ./...`. Build failure = a caller still references the method, OR an `errors`/`pgx` import became unused after the deletion. Either fix the caller (only inside the allowed file family) or remove the now-unused import in the same allowed file.
4. Run `go test ./...`.

## Gate

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-39-39-delete-signalat-method.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
"=== GATE ===" | Tee-Object -FilePath $log -Append

$prev = ".github\prompts\db-refactor\logs\phase-39-38-delete-snapshot-methods.log"
if (-not (Test-Path $prev) -or -not (Select-String -Path $prev -Pattern "^EXIT=0$" -Quiet) -or -not (Select-String -Path $prev -Pattern "^STATUS=DONE$" -Quiet)) {
  "Predecessor log missing or not DONE: $prev" | Tee-Object -FilePath $log -Append
  "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1
}

$src = "internal\database\signal_log_reader_query.go"

$anchors = @{
  "FILE_EXISTS"   = (Test-Path $src)
  "NO_SIGNALAT"   = -not (Select-String -Path $src -Pattern "func \(r \*SignalLogReader\) SignalAt\(" -Quiet)
}
foreach ($k in $anchors.Keys) { "$k=$($anchors[$k])" | Tee-Object -FilePath $log -Append }
if ($anchors.Values -contains $false) { "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

$env:CGO_ENABLED = "0"
go build ./... 2>&1 | Tee-Object -FilePath $log -Append
$buildExit = $LASTEXITCODE
if ($buildExit -ne 0) {
  "BUILD FAILED — a caller still references SignalLogReader.SignalAt. Fix the caller." | Tee-Object -FilePath $log -Append
  "EXIT=$buildExit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $buildExit
}

go test ./... 2>&1 | Tee-Object -FilePath $log -Append
$testExit = $LASTEXITCODE
"GO_TEST_EXIT=$testExit" | Tee-Object -FilePath $log -Append
if ($testExit -ne 0) { "EXIT=$testExit" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit $testExit }

$status = git --no-pager status --short
$unexpected = $status | Where-Object {
  $_ -notmatch "internal[\\/]database[\\/]signal_log_reader_query\.go$" -and
  $_ -notmatch "\.github[\\/]prompts[\\/]db-refactor[\\/]logs[\\/]phase-39-39-delete-signalat-method\.log$"
}
"UNEXPECTED_STATUS_COUNT=$(@($unexpected).Count)" | Tee-Object -FilePath $log -Append
if ($unexpected) { $unexpected | Tee-Object -FilePath $log -Append; "EXIT=1" | Tee-Object -FilePath $log -Append; "STATUS=BLOCKED" | Tee-Object -FilePath $log -Append; exit 1 }

"EXIT=0" | Tee-Object -FilePath $log -Append
"STATUS=DONE" | Tee-Object -FilePath $log -Append
```

## Commit

```powershell
cd D:\repos\teslasync
$log = ".github\prompts\db-refactor\logs\phase-39-39-delete-signalat-method.log"
git add -f -- internal\database\signal_log_reader_query.go $log
git commit -m "phase-39/39: delete SignalLogReader.SignalAt

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Blocked Path

If predecessor missing, any anchor false, or build/test non-zero, write `STATUS=BLOCKED`, commit only the log, exit non-zero.
