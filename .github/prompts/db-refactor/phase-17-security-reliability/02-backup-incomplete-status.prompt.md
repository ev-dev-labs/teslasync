---
description: "Phase-17 — Backup marked successful when incomplete: track per-table failures"
---
# Prompt 02 — Backup Marked Successful When Incomplete (HIGH)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-02-backup-incomplete-status.log` |
| Allowed files to change | `internal/backup/processor.go`, `internal/database/backup_run_repo.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (allowlist validation)

## Problem

**File:** `internal/backup/processor.go`

Per-table export failures are logged but skipped — the backup run is still marked
`"completed"` even when tables failed to export. Operators see a green status for
an incomplete backup.

## Task

### 1. Survey

Read the backup run function in `internal/backup/processor.go` to find where the final
status is set (look for `"completed"` string or status assignment).

Also read `internal/database/backup_run_repo.go` to find the `Complete()` method — it
likely hardcodes `status='completed'` in its SQL UPDATE. This needs to accept a status
parameter.

### 2. Change `BackupRunRepo.Complete()` to accept a status parameter

In `internal/database/backup_run_repo.go`, change the `Complete()` method signature to
accept a `status string` parameter:

```go
// Before: func (r *BackupRunRepo) Complete(ctx context.Context, runID int64) error
// After:  func (r *BackupRunRepo) Complete(ctx context.Context, runID int64, status string) error
```

Update the SQL to use the parameter instead of hardcoding `'completed'`:
```sql
UPDATE backup_runs SET status = $2, completed_at = NOW() WHERE id = $1
```

### 3. Track failed table count

Add counters at the start of the backup run function:
```go
totalTables := len(tables)
failedTables := 0
```

In the per-table loop, when a table export fails (the existing error handling path),
increment `failedTables++`.

### 4. Set status based on failure count

After the table loop completes, set the run status:

```go
var status string
switch {
case failedTables == 0:
    status = "completed"
case failedTables == totalTables:
    status = "failed"
default:
    status = "partial"
}
```

Pass this `status` to the updated `BackupRunRepo.Complete(ctx, runID, status)` call.
Replace any hardcoded `"completed"` with the computed status.

Log a summary: `log.Info().Int("total", totalTables).Int("failed", failedTables).Str("status", status).Msg("backup run finished")`

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify partial status exists:
$partial = Select-String -Path internal\backup\processor.go -Pattern '"partial"'
if ($partial.Count -eq 0) { Write-Error "FAIL: 'partial' status not found in processor.go"; exit 1 }

# Verify Complete() accepts status parameter:
$complete = Select-String -Path internal\database\backup_run_repo.go -Pattern 'func.*Complete.*status string'
if ($complete.Count -eq 0) { Write-Error "FAIL: Complete() does not accept status parameter"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/02-backup-incomplete-status: track per-table failures, mark backup partial/failed when incomplete

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/02-backup-incomplete-status` as the commit message prefix.
