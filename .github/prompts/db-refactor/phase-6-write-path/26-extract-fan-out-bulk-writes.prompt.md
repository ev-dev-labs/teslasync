---
description: "Phase 6 — Fan out bulk writes to per-table snapshot repos + signal_observations repo"
---

# 🔵 Write-Path 26 — Fan-Out Bulk Writes

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 26 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler.go` (edit) |
| Depends on | `25-extract-catalog-upsert` |
| Blocks | `27-integrate-fsm-hooks` |
| ADR refs | ADR-002 |

## Single Goal

For each populated entry in `hotRows`, call the matching per-repo `BulkInsert`/`Upsert`. Plus call `signalObsRepo.BulkInsert(ctx, coldObs)` for the cold residue. Errors aggregate (don't short-circuit) so a slow snapshot table doesn't lose other tables' writes.

## Recommendation

```go
type writeErr struct {
    table string
    err   error
}
var writeErrs []writeErr

dispatch := func(table string, fn func() error) {
    if err := fn(); err != nil {
        writeErrs = append(writeErrs, writeErr{table, err})
    }
}

for table, row := range hotRows {
    if len(row) == 0 {
        continue
    }
    switch table {
    case "vehicle_live_state":
        dispatch(table, func() error {
            return h.liveStateRepo.UpsertFromMap(ctx, veh.ID, ts, row)
        })
    case "positions":
        dispatch(table, func() error {
            return h.positionsRepo.InsertFromMap(ctx, veh.ID, ts, row)
        })
    case "charging_telemetry":
        dispatch(table, func() error {
            return h.chargingTeleRepo.InsertFromMap(ctx, veh.ID, ts, row)
        })
    case "climate_snapshots":
        dispatch(table, func() error {
            return h.climateSnapRepo.InsertFromMap(ctx, veh.ID, ts, row)
        })
    case "motor_snapshots":
        dispatch(table, func() error {
            return h.motorSnapRepo.InsertFromMap(ctx, veh.ID, ts, row)
        })
    case "security_events":
        dispatch(table, func() error {
            return h.securityRepo.InsertFromMap(ctx, veh.ID, ts, row)
        })
    case "vehicle_meta_snapshots":
        dispatch(table, func() error {
            return h.vehMetaRepo.InsertFromMap(ctx, veh.ID, ts, row)
        })
    default:
        writeErrs = append(writeErrs, writeErr{table, fmt.Errorf("unknown hot table")})
    }
}

if len(coldObs) > 0 {
    dispatch("signal_observations", func() error {
        return h.signalObsRepo.BulkInsert(ctx, coldObs)
    })
}
```

The `*FromMap` helper (added in Phase 5) takes a `map[string]any` and a base set of identity columns (`vehicle_id`, `ts`) and produces a parameterized INSERT.

## Acceptance Criteria

- [ ] One dispatch per populated hot table + one for cold
- [ ] Errors collected into `writeErrs`, NOT returned immediately (aggregation in prompt 28)
- [ ] Empty rows skipped (don't issue zero-column INSERTs)
- [ ] Every Phase 5 snapshot repo invoked through its single bulk entry point
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...
# Confirm every hot table from prompts 03-08 has a switch arm
('vehicle_live_state','positions','charging_telemetry','climate_snapshots','motor_snapshots','security_events','vehicle_meta_snapshots') | ForEach-Object {
    if (-not (Select-String -Path internal\api\telemetry_handler.go -Pattern "case `"$_`":")) { Write-Host "MISSING: $_" }
}
```

## Out of Scope

- Don't parallelize with goroutines — single-batch latency tolerates serial; concurrency adds FSM order risk
- Don't add per-write retry — repo layer owns transient handling

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): fan-out bulk writes per hot table + cold

Switch on target table -> per-repo BulkInsert/UpsertFromMap. Errors
aggregate into writeErrs (no short-circuit) so one slow table can't
lose writes from other tables. Cold goes to signalObsRepo.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 5 repo prompts (per-table BulkInsert)
- Phase 3 schema prompts 02–08
