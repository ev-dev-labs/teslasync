---
description: "Phase-14 — SnapshotAt + SnapshotBetween point-in-time helpers"
---
# Prompt 06 — Point-in-Time Signal Reconstruction
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-06-snapshot.log` |
| Allowed files to change | `internal/database/signal_log_reader.go` (CREATE), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (signal_log hypertable with correct index)

## Task

### 1. Create `internal/database/signal_log_reader.go`

```go
type SignalLogReader struct {
    db *DB
}

func NewSignalLogReader(db *DB) *SignalLogReader

// SnapshotAt returns the latest value of every signal for a vehicle at or before
// the given timestamp. Reconstructs full signal context at any point in time.
//
// Uses: SELECT DISTINCT ON (signal) signal, value_num, value_str, value_bool, value_jsonb
//       FROM signal_log WHERE vehicle_id = $1 AND created_at <= $2
//       ORDER BY signal, created_at DESC
func (r *SignalLogReader) SnapshotAt(ctx context.Context, vehicleID int64, at time.Time) (map[string]interface{}, error)

// SignalAt returns a single signal's value at or before the given timestamp.
func (r *SignalLogReader) SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (interface{}, error)

// SnapshotBetween returns the latest value of every signal received within a time window.
func (r *SignalLogReader) SnapshotBetween(ctx context.Context, vehicleID int64, from, to time.Time) (map[string]interface{}, error)

// SignalTrace returns all values of specific signals within a time window (for position traces, energy curves).
// Returns []SignalLogEntry sorted by timestamp ASC.
func (r *SignalLogReader) SignalTrace(ctx context.Context, vehicleID int64, signals []string, from, to time.Time) ([]SignalLogEntry, error)

type SignalLogEntry struct {
    Timestamp time.Time
    Signal    string
    ValueNum  *float64
    ValueStr  *string
    ValueBool *bool
    ValueJson map[string]interface{}
}
```

### Value decoding rules

In `SnapshotAt` / `SnapshotBetween`, return map values as:
- If `value_num IS NOT NULL` → `float64`
- Else if `value_bool IS NOT NULL` → `bool`
- Else if `value_jsonb IS NOT NULL` → `map[string]interface{}` (unmarshal)
- Else if `value_str IS NOT NULL` → `string`
- Else → skip (no value)

### Query timeout

All queries use `context.WithTimeout(ctx, 10*time.Second)` to prevent runaway scans.

### Return empty map, not nil

If no data found, return `make(map[string]interface{})`.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
# Verify query works
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "
SELECT DISTINCT ON (signal) signal,
  COALESCE(value_num::text, value_str, value_bool::text) as value
FROM signal_log WHERE vehicle_id = 1 AND created_at <= NOW()
ORDER BY signal, created_at DESC LIMIT 10;"
```

Log result. STATUS=DONE only if build passes AND query returns data.
