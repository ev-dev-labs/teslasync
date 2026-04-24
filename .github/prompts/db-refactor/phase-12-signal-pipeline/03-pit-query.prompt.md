---
description: "Phase-12 — Point-in-time signal reconstruction helper"
---
# Prompt 03 — Point-in-Time Reconstruction from signal_history
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-12-03-pit-query.log` |
| Allowed files to change | `internal/database/signal_history_writer.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (hypertable conversion)

## Context

Tesla uses delta encoding — only sends changed signals. When a drive/charge session
completes, we need the full signal snapshot at that moment. Signals not in the final
batch were received earlier and are in `signal_history`.

The `signal_history` table (now a hypertable after prompt 00) stores every signal
value with timestamp. We need a helper that reconstructs the complete signal state
at any point in time.

## Task

Add two methods to `SignalHistoryWriter` (or create a separate `SignalHistoryReader`):

### 1. `SnapshotAt` — full signal state at a timestamp

```go
// SnapshotAt returns the latest value of every signal for a vehicle at or before
// the given timestamp. This reconstructs the full signal context at any point in time.
//
// SQL: SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool, created_at
//      FROM signal_history
//      WHERE vehicle_id = $1 AND created_at <= $2
//      ORDER BY signal, created_at DESC
func (w *SignalHistoryWriter) SnapshotAt(ctx context.Context, vehicleID int64, at time.Time) (map[string]interface{}, error)
```

Returns `map[string]interface{}` where:
- Numeric signals → `float64`
- String signals → `string`
- Boolean signals → `bool`

### 2. `SignalAt` — single signal value at a timestamp

```go
// SignalAt returns the value of a specific signal at or before the given timestamp.
// Returns nil if the signal was never recorded.
func (w *SignalHistoryWriter) SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (interface{}, error)
```

### 3. `SnapshotBetween` — signals received during a time window

```go
// SnapshotBetween returns the latest value of every signal received between two timestamps.
// Useful for getting "what signals changed during this drive/charge session".
func (w *SignalHistoryWriter) SnapshotBetween(ctx context.Context, vehicleID int64, from, to time.Time) (map[string]interface{}, error)
```

## Important constraints

- These are **read-only** methods — no writes
- Use query timeouts (10s) to prevent runaway scans on large tables
- The hypertable index `(vehicle_id, signal, created_at DESC)` makes these queries efficient
- Return empty map (not nil) when no data found

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify query works against real data
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "
  SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool
  FROM signal_history
  WHERE vehicle_id = 1 AND created_at <= NOW()
  ORDER BY signal, created_at DESC
  LIMIT 10;
"
```

Log result. STATUS=DONE only if build passes and the DISTINCT ON query returns data.
