---
description: "Phase 6 — Rewrite telemetry_handler.ProcessBatch to route through Flatten + HotSignalCatalog + bulk repos; eliminate signals jsonb writes"
---

# 🔵 Write-Path 03 — Rewrite Telemetry Handler

> **Severity:** Architectural centerpiece | **Priority:** Critical | **Prompt #:** 3 of 4

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected file | `internal/api/telemetry_handler.go` (heavy rewrite) |
| Depends on | `01-build-hot-signal-catalog`, `02-implement-flatten-compound`, all Phase 5 prompts |
| Blocks | `04-build-and-integration-test` |
| ADR refs | ADR-002 |
| Estimated effort | medium-large (~1-2 days) |

## Single Goal

Rewrite the inner loop of `telemetry_handler.go ProcessBatch` (or whatever the equivalent batch entry point is) so a Fleet Telemetry batch flows: normalize → flatten compounds → for each atomic, lookup hot route → group by target table → bulk write per table → bulk write residue to `signal_observations` → bulk upsert names to `signal_catalog`.

## What's Being Established

This replaces the dual-write pattern (typed col + signals jsonb) with single-route-per-signal. After this prompt: zero `signals` columns left in any INSERT, throughput tested, signal_catalog grows organically, FSM hooks still fire.

## Recommendation

### Pseudocode for the new path

```go
func (h *TelemetryHandler) ProcessBatch(ctx context.Context, batch FleetTelemetryBatch) error {
    // 1. Resolve vehicle (existing logic, unchanged)
    veh, err := h.resolveVehicle(ctx, batch.VIN)
    if err != nil { return err }

    // 2. Normalize units (legacy normalizeFleetUnits — KEEP, but it now returns []NamedValue NOT a map)
    normalized := telemetry.NormalizeFleetUnits(batch.Signals)

    // 3. Flatten compounds. Result is the full atomic signal stream for this batch.
    atomic := make([]telemetry.Atomic, 0, len(normalized)*2)
    for _, nv := range normalized {
        flat, err := telemetry.Flatten(nv.Name, nv.Value)
        if err != nil {
            log.Warn().Err(err).Str("signal", nv.Name).Msg("flatten failed; skipping")
            continue
        }
        atomic = append(atomic, flat...)
    }

    // 4. Bucket by target table (hot) or send to cold path
    type tableBatch map[string][]any  // column -> values; built by row in next step
    rowsByTable := map[string][]map[string]any{}
    var coldObs []models.SignalObservation
    var allNames []string

    for _, a := range atomic {
        allNames = append(allNames, a.Name)
        hot := telemetry.LookupHot(a.Name)
        if hot == nil {
            coldObs = append(coldObs, makeColdObservation(veh.ID, batch.Ts, a))
            continue
        }
        // Apply transformer if present
        v := a.Value
        if hot.Transformer != nil {
            tv, err := hot.Transformer(v)
            if err != nil {
                log.Warn().Err(err).Str("signal", a.Name).Msg("transform failed; routing to cold")
                coldObs = append(coldObs, makeColdObservation(veh.ID, batch.Ts, a))
                continue
            }
            v = tv
        }
        // Append to per-table row
        row := getOrCreateRow(rowsByTable, hot.Table, batch.Ts, veh.ID)
        row[hot.Column] = v
    }

    // 5. Bulk upsert signal_catalog (single round-trip), get name -> id map
    nameToID, err := h.signalCatalogRepo.BulkUpsertObserved(ctx, dedupe(allNames))
    if err != nil { return fmt.Errorf("catalog upsert: %w", err) }

    // 6. Set signal_id on cold observations
    for i := range coldObs {
        coldObs[i].SignalID = nameToID[coldObs[i].SignalName]
    }

    // 7. Bulk insert cold observations
    if len(coldObs) > 0 {
        if err := h.signalObsRepo.BulkInsert(ctx, coldObs); err != nil {
            return fmt.Errorf("cold insert: %w", err)
        }
    }

    // 8. Bulk insert / upsert each hot table
    for table, rows := range rowsByTable {
        switch table {
        case "vehicle_live_state":
            // Merge all rows into one (per-batch latest wins) and Upsert
            if err := h.liveStateRepo.Upsert(ctx, mergeLiveState(rows)); err != nil {
                return fmt.Errorf("live_state upsert: %w", err)
            }
        case "positions":
            if err := h.positionsRepo.BulkInsert(ctx, toPositions(rows)); err != nil {
                return fmt.Errorf("positions insert: %w", err)
            }
        case "charging_telemetry":
            if err := h.chargingTeleRepo.BulkInsert(ctx, toChargingTele(rows)); err != nil { /* ... */ }
        case "climate_snapshots":     // ... etc ...
        case "motor_snapshots":       // ...
        case "security_events":       // ...
        case "vehicle_meta_snapshots": // ...
        default:
            return fmt.Errorf("unknown hot table: %s", table)
        }
    }

    // 9. Existing FSM hook (unchanged) — still fires off the typed signal stream
    if h.connFSMs[veh.ID] == nil {
        h.connFSMs[veh.ID] = telemetryfsm.NewConnectionFSM(/* ... */)
    }
    h.connFSMs[veh.ID].ProcessSignals(atomic)

    return nil
}
```

### Critical preservations

- **FSM hook stays**: `connFSMs[veh.ID].ProcessSignals(...)` must still fire — automation engine depends on it
- **Map init**: from prior bug (commit `e516fef`), `connFSMs` map MUST be initialized in `NewTelemetryHandler` (verify still done — don't regress)
- **panic recovery in MQTT batch flush stays** (with the new metric counter from FSM PR)
- **API call logging unchanged**: every Tesla request still goes through `internal/tesla/client.go`'s logger

### Removal checklist

- Delete `signals` field from every INSERT statement string
- Delete `signalsJSON, _ := json.Marshal(...)` lines that built the now-unused payload
- Delete the dead branch where unknown signals were dropped (now they go cold via `signal_observations`)

## Suggested Fix

1. Read current `telemetry_handler.go` end-to-end
2. Identify the batch entry point and the per-snapshot-type write functions
3. Replace per-snapshot direct writes with the bucketing logic above
4. Verify FSM hook still fires
5. Add structured log lines for hot-write count + cold-write count + new-name count per batch
6. Build + test + commit

## Acceptance Criteria

- [ ] `internal/api/telemetry_handler.go` has zero references to a `signals` column or `signalsJSON`
- [ ] ProcessBatch routes via Flatten + LookupHot
- [ ] All hot writes use the per-table `BulkInsert` (or `Upsert` for vehicle_live_state) added in Phase 5 prompt 05
- [ ] All cold writes go to `SignalObservationsRepo.BulkInsert`
- [ ] Catalog upsert is single round-trip (`BulkUpsertObserved`)
- [ ] FSM hook still fires (regression test passes)
- [ ] connFSMs map initialized in constructor
- [ ] Per-batch structured log: `hot_writes`, `cold_writes`, `new_names`, `duration_ms`
- [ ] Existing handler unit tests pass (or are updated to match new shape)
- [ ] `go build ./...` + `go test -race ./internal/api/...` exit 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync

# No 'signals' column references in handler
Select-String -Path internal\api\telemetry_handler.go -Pattern '"signals"|signalsJSON|json\.Marshal.*signals'
# Expected: 0 hits

# FSM hook still present
Select-String -Path internal\api\telemetry_handler.go -Pattern 'connFSMs.*ProcessSignals'
# Expected: ≥ 1 hit

# Map init in constructor
Select-String -Path internal\api\telemetry_handler.go -Pattern 'connFSMs:\s*make\(map\['
# Expected: 1 hit

go test -race -count=1 ./internal/api/...
```

## Out of Scope

- Don't add backpressure / queue — current MQTT subscriber owns flow control
- Don't change Fleet Telemetry config — server side untouched
- Don't add a hot-signal hot-reload mechanism — restart picks up code changes
- Don't rewrite the Tesla command sender — out of telemetry scope

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go internal/api/telemetry_handler_test.go
git commit -m "api(db-refactor): rewrite telemetry batch path for hot/cold split

ADR-002: ProcessBatch flow is now normalize -> flatten compounds ->
LookupHot -> bucket by table -> bulk write hot tables + bulk write
cold to signal_observations + bulk upsert signal_catalog. Zero
signals jsonb writes. FSM hook preserved. connFSMs map init guarded
(regression fix from e516fef).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-002
- `phase-6-write-path/01-build-hot-signal-catalog.prompt.md`
- `phase-6-write-path/02-implement-flatten-compound.prompt.md`
- Plan checkpoint 004-diagnosing-nil-map-fsm-panic (regression to NOT reintroduce)
