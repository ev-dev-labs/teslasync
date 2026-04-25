---
description: "Phase-14 — Rename signal_history → signal_log, hypertable + value_jsonb"
---
# Prompt 00 — signal_log Hypertable Conversion
> **Severity:** Schema | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-00-hypertable.log` |
| Allowed files to change | `internal/database/migrations/` (new up+down), `internal/database/signal_history_writer.go` (rename refs), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Context

`signal_history` is a plain Postgres table with `value_str VARCHAR(500)` that causes
overflow crashes in prod. It needs:
1. Rename to `signal_log` (new canonical name)
2. `value_str VARCHAR(500)` → `TEXT` (fixes prod crash)
3. `signal VARCHAR(100)` → `TEXT` (future-proof)
4. Add `value_jsonb JSONB` column (compound signals like DoorState)
5. Drop `id BIGSERIAL` PK (hypertables need time in PK)
6. Convert to hypertable with compression

## Task

### 1. Create migration UP

```sql
-- Rename table
ALTER TABLE signal_history RENAME TO signal_log;

-- Widen columns
ALTER TABLE signal_log ALTER COLUMN signal TYPE TEXT;
ALTER TABLE signal_log ALTER COLUMN value_str TYPE TEXT;

-- Add compound signal column
ALTER TABLE signal_log ADD COLUMN IF NOT EXISTS value_jsonb JSONB;

-- Drop old PK (hypertable needs time column in PK)
ALTER TABLE signal_log DROP CONSTRAINT IF EXISTS signal_history_pkey;
ALTER TABLE signal_log DROP COLUMN IF EXISTS id;

-- Add new PK
ALTER TABLE signal_log ADD PRIMARY KEY (created_at, vehicle_id, signal);

-- Rename indexes
ALTER INDEX IF EXISTS idx_signal_history_created RENAME TO idx_signal_log_created;
ALTER INDEX IF EXISTS idx_signal_history_vehicle_signal_time RENAME TO idx_signal_log_vehicle_signal_time;

-- Convert to hypertable
SELECT create_hypertable('signal_log', 'created_at',
  migrate_data => true,
  chunk_time_interval => INTERVAL '1 day'
);

-- Enable compression
ALTER TABLE signal_log SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id,signal',
  timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('signal_log', INTERVAL '1 hour');
```

### 2. Create migration DOWN

Reverse: drop compression, convert back, rename to signal_history, restore id column.

### 3. Update Go code references

In `signal_history_writer.go`: rename all `signal_history` string references to `signal_log`.
Update the `CopyFrom` table name, TTL cleanup query, and any log messages.

Also update the `Append()` method to handle compound signals:
```go
case map[string]interface{}:
    // Compound signal (DoorState, DetailedChargeState, etc.)
    jsonBytes, err := json.Marshal(v)
    if err == nil {
        s := string(jsonBytes)
        row.ValueStr = nil  // don't put JSON in value_str
        row.ValueJsonb = &s // put in value_jsonb
    }
```

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Apply migration and verify
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'signal_log';"
# Should return 1 row
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "\d signal_log" 
# Should show value_jsonb JSONB column, TEXT types, no id column
```

Log result. STATUS=DONE only if hypertable exists AND go build passes.
