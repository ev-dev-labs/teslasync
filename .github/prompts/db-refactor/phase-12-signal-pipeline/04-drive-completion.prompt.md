---
description: "Phase-12 — Drive completion uses signal_history for context"
---
# Prompt 04 — Drive Completion: Signal Context from signal_history
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-12-04-drive-completion.log` |
| Allowed files to change | `internal/api/telemetry_sessions.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 03 (SnapshotAt helper)

## Context

When a drive session ends, `telemetry_sessions.go` builds `enhancedFields` from
accumulated session data (speed, temp, battery values collected during the drive).
Problem: if a signal wasn't received during the session (Tesla delta encoding),
the field is missing/zero.

The `SnapshotAt()` method from prompt 03 can reconstruct full signal state at any
timestamp from `signal_history`.

## Problem area

In `telemetry_sessions.go`, find the drive completion function (around line ~1450-1550).
Look for where `enhancedFields` map is built. It currently reads from the active
session struct fields like:

```go
enhancedFields["outside_temp_avg_c"] = *outsideAvg
enhancedFields["inside_temp_avg_c"] = *insideAvg
```

These are nil when the temp signals weren't received during the drive.

## Task

### 1. After building `enhancedFields` from session data, enrich with signal_history

After the existing enhancedFields construction, add a fallback:

```go
// Enrich with signal_history for any fields not captured during session
if t.signalHistoryWriter != nil {
    startSnapshot, _ := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, driveStartTime)
    endSnapshot, _ := t.signalHistoryWriter.SnapshotAt(ctx, vehicleID, driveEndTime)

    // Fill missing start fields
    if _, ok := enhancedFields["start_odometer"]; !ok {
        if v, ok := startSnapshot["Odometer"]; ok {
            enhancedFields["odometer_start_mi"] = v
        }
    }
    // Fill missing end fields
    if _, ok := enhancedFields["odometer_end_mi"]; !ok {
        if v, ok := endSnapshot["Odometer"]; ok {
            enhancedFields["odometer_end_mi"] = v
        }
    }
    // Same pattern for: outside_temp_avg_c, inside_temp_avg_c, latitude, longitude
    // Use start/end snapshots as appropriate
}
```

### 2. Wire signalHistoryWriter into telemetry_sessions

If the `telemetry_sessions` struct doesn't already have access to `signalHistoryWriter`,
add it as a field and wire it in the constructor.

### Important constraints

- **Do NOT remove** the existing enhancedFields construction — it's the primary path
- signal_history is a **fallback** for missing fields only (check with `if _, ok` first)
- **Errors from SnapshotAt are non-fatal** — log warn and continue with whatever data we have
- Keep the existing transaction boundary intact — signal_history reads happen BEFORE the tx
- Map Tesla signal names to database column names (e.g., `"Odometer"` → `"odometer_start_mi"`)

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
```

Log result. STATUS=DONE only if build passes. Full integration test is in prompt 06.
