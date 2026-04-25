---
description: "Phase-17 — SQL injection in backup processor: validate table against allowlist (CRITICAL)"
---
# Prompt 00 — SQL Injection in Backup Processor (CRITICAL)
> **Severity:** Critical | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-00-sql-injection-backup.log` |
| Allowed files to change | `internal/backup/processor.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

**File:** `internal/backup/processor.go:191`

The backup processor builds SQL queries using `fmt.Sprintf('SELECT ... FROM "%s" t', table)`
where `table` comes from user request parameters. This is a **SQL injection vulnerability** —
an attacker could pass a crafted table name to execute arbitrary SQL.

The processor already has its OWN `backupTables` slice/map that lists which tables it
backs up. This is the correct allowlist source — NOT `backup_handler.go`'s
`allowedBackupTables` (which is handler-layer only and may diverge).

## Task

### 1. Survey

Read `internal/backup/processor.go` to find:
- The `fmt.Sprintf` pattern around line 191
- The processor's own `backupTables` list (slice or map of table names the processor iterates over)
- The `exportTable()` function signature

Do NOT read `backup_handler.go` — the processor's own table list is the source of truth.

### 2. Extract an `IsAllowedTable()` validation helper

In `internal/backup/processor.go`, create a pure validation function:

```go
// IsAllowedTable returns true if the table name is in the processor's backup table list.
// Used to prevent SQL injection — table names in queries MUST pass this check.
func IsAllowedTable(table string) bool {
    for _, t := range backupTables {  // or check the map, depending on the data structure
        if t == table {
            return true
        }
    }
    return false
}
```

Adapt this to match the actual data structure (slice vs map).

### 3. Add validation in `exportTable()`

In `exportTable()`, BEFORE the `fmt.Sprintf` query construction:

1. Call `IsAllowedTable(table)`. If it returns false:
   - Log an error: `log.Error().Str("table", table).Msg("backup: table not in allowlist, skipping")`
   - Return an error (do NOT execute the query)
2. After validation, the `fmt.Sprintf` with the table name is safe because the value
   can only be one of the hardcoded strings from `backupTables`.
   Add a comment: `// table name is safe — validated against backupTables allowlist above`

### 4. Verify no other Sprintf-with-table patterns

Search `internal/backup/` for any other `Sprintf.*FROM.*%s` patterns and fix them
the same way.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify no unvalidated table interpolation remains:
$matches = Select-String -Path internal\backup\processor.go -Pattern 'Sprintf.*FROM.*%s'
if ($matches.Count -gt 0) { Write-Error "FAIL: unvalidated Sprintf with table name still exists"; exit 1 }

# Verify allowlist validation function exists:
$allowlist = Select-String -Path internal\backup\processor.go -Pattern 'IsAllowedTable'
if ($allowlist.Count -eq 0) { Write-Error "FAIL: IsAllowedTable not found"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/00-sql-injection-backup: validate table name against allowlist before query construction

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/00-sql-injection-backup` as the commit message prefix.
