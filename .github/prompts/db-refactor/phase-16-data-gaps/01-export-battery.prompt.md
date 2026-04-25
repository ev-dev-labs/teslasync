---
description: "Phase-16 — Battery trend in export analytics"
---
# Prompt 01 — Export Analytics: Battery Trend from signal_log
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-01-export-battery.log` |
| Allowed files to change | `internal/export/analytics.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (same query pattern)

## Problem

`export/analytics.go` has two TODO stubs:
- Line 103: `// TODO: implement via SignalLogReader.SignalTracePivot for BatteryLevel, PackVoltage`
- Line 217: `// Battery trend from signal_log — TODO: implement via SignalTracePivot`

## Task

### 1. Wire SignalLogReader into the Processor

The export `Processor` struct needs access to `SignalLogReader`. Check if it's
already wired (Phase 14 may have added it). If not:

```go
type Processor struct {
    db              *database.DB
    vehicleRepo     *database.VehicleRepo
    driveRepo       *database.DriveRepo
    chargingRepo    *database.ChargingRepo
    signalLogReader *database.SignalLogReader  // add if missing
}
```

### 2. Replace line 103 TODO

Query latest battery health per vehicle:
```go
if p.signalLogReader != nil {
    snap, _ := p.signalLogReader.SnapshotAt(ctx, v.ID, time.Now())
    if bl, ok := snap["BatteryLevel"]; ok {
        // derive health from current BatteryLevel
    }
}
```

### 3. Replace line 217 TODO

Query monthly battery trend (same pattern as prompt 00):
```go
if p.signalLogReader != nil {
    rows, _ := p.db.Pool.Query(ctx, `
        SELECT TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS month,
               AVG(value_num) AS avg_soc
        FROM signal_log
        WHERE vehicle_id = $1 AND signal = 'BatteryLevel' AND value_num IS NOT NULL
        GROUP BY month ORDER BY month DESC LIMIT 24`, v.ID)
    // build batteryTrend from rows
}
```

### Constraints

- If signalLogReader is nil or query returns no data, leave `batteryTrend` empty (graceful)
- Don't change the `batteryPoint` struct — keep same JSON shape
- Wire signalLogReader through the Processor constructor

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
grep -n "TODO.*signal_log\|TODO.*SignalTrace\|TODO.*implement\|TODO.*derive" internal/export/analytics.go
# Should return 0 matches
```

## Commit

```powershell
git add -A
git commit -m "phase-16/01-export-battery: implement battery trend in export from signal_log

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/01-export-battery` as the commit message prefix.
