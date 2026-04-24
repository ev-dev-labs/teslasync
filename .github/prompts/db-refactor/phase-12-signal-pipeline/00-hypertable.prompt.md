---
description: "Phase-12 — Convert signal_history to TimescaleDB hypertable"
---
# Prompt 00 — Hypertable Conversion + Compression
> **Severity:** Schema | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-12-00-hypertable.log` |
| Allowed files to change | `internal/database/migrations/` (new migration file), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Context

`signal_history` is a plain Postgres table that stores every signal value with timestamp.
It already has the right schema: `(id, vehicle_id, signal, value_num, value_str, value_bool, created_at)`.
It needs to be converted to a TimescaleDB hypertable for compression and efficient time-range queries.

Current schema:
```sql
CREATE TABLE signal_history (
    id         BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL,
    signal     VARCHAR(100) NOT NULL,
    value_num  DOUBLE PRECISION,
    value_str  VARCHAR(500),
    value_bool BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Indexes: idx_signal_history_created, idx_signal_history_vehicle_signal_time
```

## Task

Create a new migration file (next sequence number after existing migrations) that:

1. **Drop the `id` BIGSERIAL PRIMARY KEY** — hypertables need the time column in the PK
2. **Recreate PK** as `(created_at, vehicle_id, signal)` or similar composite
3. **Convert to hypertable**: `SELECT create_hypertable('signal_history', 'created_at', migrate_data => true, chunk_time_interval => INTERVAL '1 day');`
4. **Enable compression**:
   ```sql
   ALTER TABLE signal_history SET (
     timescaledb.compress,
     timescaledb.compress_segmentby = 'vehicle_id,signal',
     timescaledb.compress_orderby = 'created_at DESC'
   );
   SELECT add_compression_policy('signal_history', INTERVAL '1 hour');
   ```
5. **DO NOT add a retention policy** — the existing manual TTL cleanup in `signal_history_writer.go:162` handles retention based on user-configurable settings.
6. **Re-create necessary indexes** if dropped during conversion.

## Down migration

Reverse: decompress, drop compression policy, drop hypertable (convert back to regular table).

## Gate

```powershell
cd D:\repos\teslasync
# Apply migration
docker exec -i teslasync-postgres psql -U teslasync -d teslasync < internal/database/migrations/XXXXXX_signal_history_hypertable.up.sql
# Verify
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'signal_history';"
# Should return 1 row
```

Log result. STATUS=DONE only if hypertable conversion succeeds and compression policy is active.
