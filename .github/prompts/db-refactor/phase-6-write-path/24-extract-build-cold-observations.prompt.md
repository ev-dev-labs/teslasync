---
description: "Phase 6 — Convert cold residue + transform-demoted atomics into []SignalObservation rows"
---

# 🔵 Write-Path 24 — Build Cold Observations

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 24 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/api/telemetry_handler.go` (edit) |
| Depends on | `23-extract-build-hot-rows` |
| Blocks | `25-extract-catalog-upsert` |
| ADR refs | ADR-002 |

## Single Goal

Convert `buckets.Cold` (now containing both originally-cold atomics AND transform-demoted ones) into a `[]models.SignalObservation` slice ready for `signalObsRepo.BulkInsert`. Pick the right `value_*` column per Go type.

## Recommendation

```go
func (h *TelemetryHandler) buildColdObservations(vehicleID int64, ts time.Time, cold []telemetry.Atomic) []models.SignalObservation {
    out := make([]models.SignalObservation, 0, len(cold))
    for _, a := range cold {
        obs := models.SignalObservation{
            VehicleID:  vehicleID,
            Ts:         ts,
            SignalName: a.Name,
            Source:     "fleet_telemetry",
        }
        switch v := a.Value.(type) {
        case nil:
            continue // skip nulls — not worth a row
        case bool:
            obs.ValueBool = &v
        case float64:
            obs.ValueNumeric = &v
        case float32:
            f := float64(v); obs.ValueNumeric = &f
        case int:
            f := float64(v); obs.ValueNumeric = &f
        case int64:
            f := float64(v); obs.ValueNumeric = &f
        case string:
            obs.ValueText = &v
        default:
            // Compound that escaped Flatten or unknown shape -> stringify defensively
            s := fmt.Sprintf("%v", v)
            obs.ValueText = &s
            log.Warn().
                Str("signal", a.Name).
                Str("type", fmt.Sprintf("%T", v)).
                Msg("cold signal had unexpected type; stringified")
        }
        out = append(out, obs)
    }
    return out
}
```

## Acceptance Criteria

- [ ] One `SignalObservation` per cold atomic (nulls skipped)
- [ ] Numeric/text/bool routed to correct `value_*` column (mutually exclusive)
- [ ] Unknown types stringified into `value_text` with a warn log
- [ ] `Source` set to `"fleet_telemetry"` (matches CHECK constraint from Phase 3 prompt 08)
- [ ] `go build ./internal/api/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/api/...
Select-String -Path internal\api\telemetry_handler.go -Pattern 'buildColdObservations'
```

## Out of Scope

- Don't insert here (prompt 26)
- Don't populate `signal_id` column — `signal_name` FK is the on-write key (Phase 3 prompt 08)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/api/telemetry_handler.go
git commit -m "telemetry(db-refactor): build cold SignalObservation rows

Per-type routing into value_numeric/value_text/value_bool. Nulls
skipped. Unknown types stringified with warn. Source pinned to
'fleet_telemetry' (matches CHECK from schema/08).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3 prompt 08 (signal_observations CHECK constraint)
