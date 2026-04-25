---
description: "Phase-15 — Add fsm_type column migration to fsm_transitions"
---
# Prompt 00 — fsm_type Column Migration
> **Severity:** Schema | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-15-00-fsm-type-migration.log` |
| Allowed files to change | `internal/database/migrations/` (new up+down), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

The `fsm_transitions` table has no `fsm_type` column. The `FSMTransitionRepo.Insert()`
writes `fsm_type` and `Query()` filters by it, but the column doesn't exist in the
schema — it was added manually via `ALTER TABLE` during a dev session but never as a
proper migration.

## Task

Create a new migration (next sequence number):

### UP
```sql
ALTER TABLE fsm_transitions ADD COLUMN IF NOT EXISTS fsm_type TEXT NOT NULL DEFAULT 'vehicle';
CREATE INDEX IF NOT EXISTS idx_fsm_transitions_type ON fsm_transitions (vehicle_id, fsm_type, ts DESC);
```

### DOWN
```sql
DROP INDEX IF EXISTS idx_fsm_transitions_type;
ALTER TABLE fsm_transitions DROP COLUMN IF EXISTS fsm_type;
```

## Gate

```powershell
cd D:\repos\teslasync
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "\d fsm_transitions" | Select-String "fsm_type"
# Should show: fsm_type | text | not null | 'vehicle'
```

## Commit

After gate passes, commit:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-15/00-fsm-type-migration: add fsm_type column to fsm_transitions

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-15/00-fsm-type-migration` as the commit message prefix.
