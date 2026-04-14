---
description: "Wire signal_history Postgres table as primary backend for Signal Explorer/Log Viewer — make MongoDB fully optional"
---

# Feature: Postgres-First Signal History (MongoDB Fully Optional)

## Problem

Signal Explorer, Signal Log Viewer, and Signal Diff pages return empty/503 because they
query MongoDB (`SignalLogRepo`) which isn't running locally. We now have `signal_history`
in Postgres (55K+ rows from replay) but the API endpoints don't use it.

## Current State

| Endpoint | Current Source | Fallback |
|----------|---------------|----------|
| `GET /signals/{vehicleID}/available` | MongoDB → PG columns → static | ✅ Already works |
| `GET /signals/{vehicleID}/{signalName}/history` | MongoDB ONLY | ❌ Returns 503 |
| `GET /signals/{vehicleID}/stats` | MongoDB ONLY | ❌ Returns 503 |

### Postgres `signal_history` table (already populated)
```sql
-- 55K+ rows, indexed by (vehicle_id, signal, created_at DESC)
id BIGSERIAL, vehicle_id BIGINT, signal VARCHAR(100),
value_num FLOAT8, value_str VARCHAR(500), value_bool BOOLEAN,
created_at TIMESTAMPTZ
```

### `SignalHistoryWriter` (already working)
`internal/database/signal_history_writer.go` — buffers signals, batch-inserts via
`pgx CopyFrom` every 2s. Called in `ProcessSignals()` for every MQTT batch.

## Implementation Plan

### Step 1: Add Postgres query methods to `signal_history_writer.go`

**File:** `internal/database/signal_history_writer.go`

Add read methods that mirror `SignalLogRepo`'s interface:

```go
// GetHistory returns time-series data for a signal within a date range.
func (w *SignalHistoryWriter) GetHistory(ctx context.Context, vehicleID int64, signalName string,
    from, to time.Time, limit int) ([]SignalHistoryRow, error) {
    if limit <= 0 || limit > 10000 {
        limit = 1000
    }
    query := `SELECT vehicle_id, signal, value_num, value_str, value_bool, created_at
              FROM signal_history
              WHERE vehicle_id = $1 AND signal = $2 AND created_at BETWEEN $3 AND $4
              ORDER BY created_at ASC
              LIMIT $5`
    rows, err := w.db.Pool.Query(ctx, query, vehicleID, signalName, from, to, limit)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var results []SignalHistoryRow
    for rows.Next() {
        var r SignalHistoryRow
        if err := rows.Scan(&r.VehicleID, &r.Signal, &r.ValueNum, &r.ValueStr, &r.ValueBool, &r.CreatedAt); err != nil {
            return nil, err
        }
        results = append(results, r)
    }
    return results, rows.Err()
}

// GetAvailableSignals returns distinct signal names for a vehicle.
func (w *SignalHistoryWriter) GetAvailableSignals(ctx context.Context, vehicleID int64) ([]string, error) {
    rows, err := w.db.Pool.Query(ctx,
        `SELECT DISTINCT signal FROM signal_history WHERE vehicle_id = $1 ORDER BY signal`,
        vehicleID)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    var signals []string
    for rows.Next() {
        var s string
        if err := rows.Scan(&s); err == nil {
            signals = append(signals, s)
        }
    }
    return signals, rows.Err()
}

// GetStats returns signal count and date range for a vehicle.
func (w *SignalHistoryWriter) GetStats(ctx context.Context, vehicleID int64) (int64, *time.Time, *time.Time, error) {
    var count int64
    var oldest, newest *time.Time
    err := w.db.Pool.QueryRow(ctx,
        `SELECT COUNT(*), MIN(created_at), MAX(created_at)
         FROM signal_history WHERE vehicle_id = $1`, vehicleID).Scan(&count, &oldest, &newest)
    return count, oldest, newest, err
}
```

### Step 2: Update SignalHandler to use Postgres as primary

**File:** `internal/api/signal_handler.go`

Add `signalHistoryWriter` field and update all endpoints:

```go
type SignalHandler struct {
    signalLogRepo       *database.SignalLogRepo        // MongoDB (optional)
    signalHistoryWriter *database.SignalHistoryWriter   // Postgres (primary)
    db                  *database.DB
}

func (h *SignalHandler) WithSignalHistory(w *database.SignalHistoryWriter) *SignalHandler {
    h.signalHistoryWriter = w
    return h
}
```

Update `History()` — try Postgres first, MongoDB fallback:
```go
func (h *SignalHandler) History(w http.ResponseWriter, r *http.Request) {
    // Parse params...

    // Try Postgres signal_history first
    if h.signalHistoryWriter != nil {
        rows, err := h.signalHistoryWriter.GetHistory(r.Context(), vehicleID, signalName, from, to, limit)
        if err == nil && len(rows) > 0 {
            writeJSON(w, http.StatusOK, formatHistoryResponse(vehicleID, signalName, rows))
            return
        }
    }

    // Fallback to MongoDB
    if h.signalLogRepo != nil {
        // existing MongoDB query...
    }

    writeJSON(w, http.StatusOK, map[string]interface{}{
        "vehicle_id": vehicleID, "signal": signalName, "points": []interface{}{}, "count": 0,
    })
}
```

Apply the same pattern to `AvailableSignals()` and `Stats()`.

### Step 3: Wire SignalHistoryWriter into the handler

**File:** `internal/api/router.go`

Where the signal handler is created, pass the writer:
```go
signalHandler := NewSignalHandler(telemetryHandler.signalLogRepo)
if db != nil {
    signalHandler.WithDB(db)
}
if telemetryHandler.signalHistoryWriter != nil {
    signalHandler.WithSignalHistory(telemetryHandler.signalHistoryWriter)
}
```

Also expose the writer from TelemetryHandler:
```go
func (h *TelemetryHandler) SignalHistoryWriter() *database.SignalHistoryWriter {
    return h.signalHistoryWriter
}
```

### Step 4: Update response format to match frontend expectations

The frontend `SignalExplorerPage` and `SignalLogViewerPage` expect specific response shapes.
Make sure the Postgres response matches:

```json
{
  "vehicle_id": 1,
  "signal": "BatteryLevel",
  "count": 150,
  "points": [
    {"value": 85.5, "timestamp": "2026-04-14T07:23:03Z"},
    {"value": 85.3, "timestamp": "2026-04-14T07:24:03Z"}
  ]
}
```

Map `SignalHistoryRow` fields:
- `value_num` → `value` (for numeric signals)
- `value_str` → `value` (for string signals)
- `value_bool` → `value` (for boolean signals)
- `created_at` → `timestamp`

### Step 5: Update comment/documentation

Change `SignalHandler` doc comment from "querying signal history from MongoDB" to
"querying signal history (Postgres primary, MongoDB optional fallback)".

## Files to Modify

| File | Change |
|------|--------|
| `internal/database/signal_history_writer.go` | Add `GetHistory`, `GetAvailableSignals`, `GetStats` query methods |
| `internal/api/signal_handler.go` | Add `signalHistoryWriter` field, update History/Available/Stats to use PG first |
| `internal/api/router.go` | Wire `SignalHistoryWriter` into signal handler |
| `internal/api/telemetry_handler.go` | Add `SignalHistoryWriter()` getter if not present |

## Verification

```bash
go build ./...

# Test with curl:
curl -s "http://localhost:8080/api/v1/signals/1/BatteryLevel/history?from=2026-04-01&to=2026-04-15&limit=10" | jq '.count, .points[:2]'
# Should return data from signal_history table, NOT 503

curl -s "http://localhost:8080/api/v1/signals/1/available" | jq '.count, .signals[:5]'
# Should include signal names from signal_history

curl -s "http://localhost:8080/api/v1/signals/1/stats" | jq
# Should return count + date range
```

**COMPLETION DEFINITION:**
- [ ] `SignalHistoryWriter` has `GetHistory`, `GetAvailableSignals`, `GetStats` methods
- [ ] `SignalHandler.History()` queries Postgres first, MongoDB fallback
- [ ] `SignalHandler.AvailableSignals()` queries signal_history for distinct names (already has PG column fallback)
- [ ] `SignalHandler.Stats()` queries signal_history when MongoDB unavailable
- [ ] No endpoint returns 503 when MongoDB is not configured
- [ ] Signal Explorer shows chart data when clicking Explore
- [ ] `go build ./...` clean
- [ ] Response format matches frontend expectations
