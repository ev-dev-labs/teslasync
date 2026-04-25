---
description: "Phase-14 — SignalTracePivot: vertical→horizontal chart data"
---
# Prompt 23 — SignalTracePivot Helper (vertical signal_log → chart-friendly JSON)
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-23-pivot.log` |
| Allowed files to change | `internal/database/signal_log_reader.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (SignalTrace exists in signal_log_reader.go)

## Problem

signal_log stores data vertically:
```
ts         | signal       | value_num
14:00:01   | VehicleSpeed | 65
14:00:01   | BatteryLevel | 90
14:00:01   | Elevation    | 150
14:00:02   | VehicleSpeed | 67
```

But every chart endpoint (drive telemetry, charge curve, climate history, etc.)
needs horizontal/pivoted data:
```json
[
  {"ts": "14:00:01", "speed": 65, "battery": 90, "elevation": 150},
  {"ts": "14:00:02", "speed": 67, "battery": null, "elevation": null}
]
```

Every telemetry endpoint needs this same pivot logic. Build it ONCE.

## Task

### 1. Add `SignalTracePivot` to `signal_log_reader.go`

```go
// SignalMapping maps Tesla signal names to output field names.
type SignalMapping struct {
    Signal   string // Tesla signal name in signal_log (e.g. "VehicleSpeed")
    Field    string // Output JSON field name (e.g. "speed_mph")
}

// PivotRow is one time-bucketed row with named fields.
type PivotRow struct {
    Timestamp time.Time              `json:"ts"`
    Fields    map[string]interface{} `json:"fields,omitempty"`
}

// SignalTracePivot queries signal_log for specified signals within a time window,
// then pivots vertical rows into horizontal PivotRows grouped by timestamp.
//
// Signals arriving within the same second are merged into one row.
// Missing signals in a row are nil (not included in the map).
//
// Usage:
//   mappings := []SignalMapping{
//       {Signal: "VehicleSpeed", Field: "speed_mph"},
//       {Signal: "BatteryLevel", Field: "battery_pct"},
//       {Signal: "Elevation", Field: "elevation_m"},
//   }
//   rows, err := reader.SignalTracePivot(ctx, vehicleID, mappings, driveStart, driveEnd)
func (r *SignalLogReader) SignalTracePivot(
    ctx context.Context,
    vehicleID int64,
    mappings []SignalMapping,
    from, to time.Time,
) ([]PivotRow, error)
```

### Implementation

1. Extract signal names from mappings: `["VehicleSpeed", "BatteryLevel", "Elevation"]`
2. Query signal_log:
   ```sql
   SELECT date_trunc('second', created_at) AS ts, signal, value_num, value_str, value_bool
   FROM signal_log
   WHERE vehicle_id = $1 AND signal = ANY($2) AND created_at BETWEEN $3 AND $4
   ORDER BY ts ASC, signal ASC
   ```
3. Group by truncated timestamp
4. For each group, build a PivotRow with `Fields[mapping.Field] = value`
5. Return sorted by timestamp ASC

### 2. Also add a flat variant for simpler endpoints

```go
// SignalTracePivotFlat returns []map[string]interface{} with "ts" + field names as keys.
// Easier for JSON serialization — no nested "fields" object.
// Each map: {"ts": "2026-04-24T14:00:01Z", "speed_mph": 65, "battery_pct": 90}
func (r *SignalLogReader) SignalTracePivotFlat(
    ctx context.Context,
    vehicleID int64,
    mappings []SignalMapping,
    from, to time.Time,
) ([]map[string]interface{}, error)
```

### Constraints

- Use `date_trunc('second', created_at)` for grouping — sub-second precision not needed for charts
- Query timeout: 10 seconds
- Return empty slice (not nil) when no data
- If the same signal appears multiple times in the same second, take the LAST value

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
```

Log result. STATUS=DONE only if build+vet pass.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/23-pivot: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/23-pivot` as the commit message prefix.

