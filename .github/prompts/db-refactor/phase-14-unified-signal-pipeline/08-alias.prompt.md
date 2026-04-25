---
description: "Phase-14 — Signal alias registry for Tesla name changes"
---
# Prompt 08 — Signal Alias Registry
> **Severity:** Resilience | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-08-alias.log` |
| Allowed files to change | `internal/telemetry/signal_alias.go` (CREATE), `internal/api/telemetry_handler.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

If Tesla renames a signal (e.g. `BatteryLevel` → `BatteryStateOfCharge`), all
downstream code (SnapshotAt callers, continuous aggregates, FSM triggers) silently
breaks. We need an alias layer at ingestion time.

## Task

### 1. Create `internal/telemetry/signal_alias.go`

```go
package telemetry

// SignalAliases maps deprecated/renamed Tesla signal names to canonical names.
// When Tesla renames a signal, add a mapping here — all downstream code uses
// the canonical name and never needs to change.
//
// Update this map when Tesla publishes Fleet Telemetry API changes.
var SignalAliases = map[string]string{
    // Example (not active yet):
    // "BatteryStateOfCharge": "BatteryLevel",
    // "VehicleSpeedKph":     "VehicleSpeed",
}

// Canonicalize returns the canonical signal name, applying aliases if needed.
func Canonicalize(signal string) string {
    if canonical, ok := SignalAliases[signal]; ok {
        return canonical
    }
    return signal
}
```

### 2. Apply at ingestion in `telemetry_handler.go`

In the signal processing loop (around line ~460), before dispatching to store/writer:

```go
// Canonicalize signal names (handle Tesla renames)
canonicalized := make(map[string]interface{}, len(signals))
for name, value := range signals {
    canonicalized[telemetry.Canonicalize(name)] = value
}
signals = canonicalized
```

Place this BEFORE `signalStore.Update()`, `redisSignalCache.Update()`, and
`signalHistoryWriter.Append()` — all consumers see canonical names.

### Constraints

- The alias map is empty by default — no behavior change until a Tesla rename happens
- `Canonicalize()` is a simple map lookup — zero overhead for non-aliased signals
- Log a metric when an alias is applied (so you know it's happening):
  `log.Debug().Str("old", signal).Str("new", canonical).Msg("signal alias applied")`

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
```

Log result. STATUS=DONE only if build+vet pass.
