---
description: "Phase-12 — Charge completion uses signal_history for context"
---
# Prompt 05 — Charge Completion: Signal Context from signal_history
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-12-05-charge-completion.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 03 (SnapshotAt helper)

## Context

Same problem as drive completion (prompt 04), but for charging sessions.
When a charge session ends, `telemetry_sessions.go` builds `enhancedFields` from
accumulated session data. Missing signals → missing fields.

## Problem area

In `telemetry_sessions.go`, find the charge completion function (around line ~1560-1625).
It builds enhancedFields:

```go
enhancedFields["inside_temp_avg"] = *insideAvg
enhancedFields["outside_temp_avg"] = *outsideAvg
enhancedFields["charge_energy_used"] = *chargeEnergyUsed
```

These are nil when temp/energy signals weren't received during the charge.

## Task

### 1. Enrich charge enhancedFields with signal_history fallback

After the existing enhancedFields construction, add:

```go
// Enrich with signal_history for missing context
if t.signalHistoryWriter != nil {
    startSnapshot, _ := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, chargeStartTime)
    endSnapshot, _ := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, time.Now().UTC())

    // Fill missing location (for geocoding)
    if active.Latitude == nil {
        if v, ok := endSnapshot["Latitude"]; ok {
            if f, fOk := v.(float64); fOk { active.Latitude = &f }
        }
    }
    if active.Longitude == nil {
        if v, ok := endSnapshot["Longitude"]; ok {
            if f, fOk := v.(float64); fOk { active.Longitude = &f }
        }
    }
    // Fill missing temps
    if _, ok := enhancedFields["inside_temp_avg"]; !ok {
        if v, ok := endSnapshot["InsideTemp"]; ok {
            enhancedFields["inside_temp_avg_c"] = v
        }
    }
    if _, ok := enhancedFields["outside_temp_avg"]; !ok {
        if v, ok := endSnapshot["OutsideTemp"]; ok {
            enhancedFields["outside_temp_avg_c"] = v
        }
    }
}
```

### Important constraints

- **Do NOT remove** existing enhancedFields logic — signal_history is fallback only
- **Errors are non-fatal** — log warn, continue
- Note: `charging_sessions` table doesn't have temp columns currently, so
  enhancedFields with temp data will be silently ignored by `PartialUpdateWithTx`.
  This is expected — the data is captured for future schema additions.
- Use the same `signalHistoryWriter` reference wired in prompt 04

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
```

Log result. STATUS=DONE only if build passes. Full integration test is in prompt 06.
