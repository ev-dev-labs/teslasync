---
description: "Phase-17 — Test coverage for critical paths: smoke tests for backup + signal store"
---
# Prompt 08 — Test Coverage for Critical Paths (MEDIUM)
> **Severity:** Medium | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-08-test-coverage-critical.log` |
| Allowed files to change | `internal/backup/processor.go`, `internal/backup/processor_test.go` (CREATE), `internal/signal/store_test.go` (CREATE if missing), `internal/database/write_buffer_test.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (SQL injection fix provides `IsAllowedTable()` to test)

## Problem

Critical paths — backup, signal cache, telemetry ingest — have zero package-local tests.
The SQL injection fix from Prompt 00 (`IsAllowedTable()` validation) has no test to
prevent regression. Testing `exportTable()` directly is impractical — it requires a
database connection and will panic with a nil pool.

## Task

### 1. Survey

- Read `internal/backup/processor.go` to find the `IsAllowedTable()` function added in
  Prompt 00 and the processor's `backupTables` list
- Check if `internal/signal/store_test.go` already exists
- Read `internal/signal/store.go` to understand the `Update` + `Get` API
- Read `internal/database/write_buffer_test.go` to verify it exists and covers drop behavior

### 2. Create processor_test.go — Test `IsAllowedTable()` directly

The key insight: testing `exportTable()` with a nil pool will panic, not return an error.
Instead, test the pure validation function `IsAllowedTable()` which requires no DB.

Create `internal/backup/processor_test.go`:

```go
package backup

import "testing"

func TestSmoke_IsAllowedTable_ValidTables(t *testing.T) {
    // Test that every table in backupTables is allowed.
    // Iterate the processor's own table list and assert IsAllowedTable returns true.
    for _, table := range backupTables {
        if !IsAllowedTable(table) {
            t.Errorf("IsAllowedTable(%q) = false, want true", table)
        }
    }
}

func TestSmoke_IsAllowedTable_RejectsInvalid(t *testing.T) {
    // Test clearly invalid / malicious table names.
    bad := []string{
        "nonexistent_table",
        "; DROP TABLE vehicles; --",
        "vehicles\" OR 1=1 --",
        "",
        "../../etc/passwd",
    }
    for _, table := range bad {
        if IsAllowedTable(table) {
            t.Errorf("IsAllowedTable(%q) = true, want false", table)
        }
    }
}
```

If `IsAllowedTable` is not exported (lowercase `isAllowedTable`), the test file is in
the same package (`package backup`) so it can access it directly.

### 3. Create store_test.go — Test Update + Get roundtrip (if missing)

If `internal/signal/store_test.go` does not exist, create it:

```go
package signal

import "testing"

func TestSmoke_Store_UpdateGet(t *testing.T) {
    // Create a new in-memory store (if the store supports it)
    // or test the map-based cache directly.
    // Update a signal value, then Get it back.
    // Assert the value matches.
}
```

If the store requires a database, create a simpler test that exercises whatever in-memory
layer exists (cache map, etc.).

### 4. Verify write_buffer_test.go

Read `internal/database/write_buffer_test.go`. If it already tests the drop behavior,
note this in the log and move on. If it does NOT test drops, add a test — but only if
the file already exists (do not create it from scratch).

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...

# Run smoke tests — these MUST pass, not just compile:
go test ./internal/backup/ -v -count=1 -run TestSmoke 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "FAIL: backup smoke tests failed"; exit 1 }

go test ./internal/signal/ -v -count=1 -run TestSmoke 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "FAIL: signal smoke tests failed"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/08-test-coverage-critical: add smoke tests for backup allowlist + signal store roundtrip

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/08-test-coverage-critical` as the commit message prefix.
