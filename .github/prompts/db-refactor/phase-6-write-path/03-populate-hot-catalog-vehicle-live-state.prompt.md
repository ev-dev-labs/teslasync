---
description: "Phase 6 — Populate HotCatalog entries for vehicle_live_state typed columns"
---

# 🔵 Write-Path 03 — Populate `vehicle_live_state` Routes

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 3 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog_vehicle_live_state.go` (new) |
| Depends on | `02-implement-lookup-hot-fn` |
| Blocks | `04-populate-hot-catalog-positions` |
| ADR refs | ADR-002 |

## Single Goal

Add a dedicated file that registers, in `init()`, every Tesla signal name routing to a typed column on `vehicle_live_state`. One file per destination table keeps catalog growth reviewable.

## Source of Truth

Read `migrations/_baseline_source/02-vehicle-live-state.sql` (or the equivalent Phase 3 file). Every typed column must have at least one Tesla-name entry.

## Recommendation

```go
package telemetry

func init() {
    add := func(r HotRoute) { HotCatalog[r.Name] = r }

    // Battery / SoC
    add(HotRoute{Name: "BatteryLevel",     Table: "vehicle_live_state", Column: "battery_level",     Kind: KindNumeric})
    add(HotRoute{Name: "Soc",              Table: "vehicle_live_state", Column: "battery_level",     Kind: KindNumeric}) // alias
    add(HotRoute{Name: "BatteryRange",     Table: "vehicle_live_state", Column: "battery_range_km",  Kind: KindNumeric, Transformer: ConvertMilesToKm})
    add(HotRoute{Name: "EstBatteryRange",  Table: "vehicle_live_state", Column: "est_battery_range_km", Kind: KindNumeric, Transformer: ConvertMilesToKm})

    // Charge state
    add(HotRoute{Name: "ChargeState",      Table: "vehicle_live_state", Column: "charge_state",      Kind: KindEnumNormalized, Transformer: NormalizeChargeState})
    add(HotRoute{Name: "ChargingState",    Table: "vehicle_live_state", Column: "charge_state",      Kind: KindEnumNormalized, Transformer: NormalizeChargeState}) // alias

    // Drive
    add(HotRoute{Name: "Gear",             Table: "vehicle_live_state", Column: "gear",              Kind: KindEnumNormalized, Transformer: NormalizeGear})
    add(HotRoute{Name: "Speed",            Table: "vehicle_live_state", Column: "speed_kph",         Kind: KindNumeric, Transformer: ConvertMphToKph})

    // Climate state (current values; full snapshot in prompt 05)
    add(HotRoute{Name: "ClimateState",     Table: "vehicle_live_state", Column: "climate_on",        Kind: KindBool})
    add(HotRoute{Name: "IsClimateOn",      Table: "vehicle_live_state", Column: "climate_on",        Kind: KindBool}) // alias

    // Lock / sentry summary
    add(HotRoute{Name: "Locked",           Table: "vehicle_live_state", Column: "locked",            Kind: KindBool})
    add(HotRoute{Name: "SentryMode",       Table: "vehicle_live_state", Column: "sentry_mode",       Kind: KindEnumNormalized, Transformer: NormalizeSentryMode})

    // Odometer / online
    add(HotRoute{Name: "Odometer",         Table: "vehicle_live_state", Column: "odometer_km",       Kind: KindNumeric, Transformer: ConvertMilesToKm})
    add(HotRoute{Name: "VehicleState",     Table: "vehicle_live_state", Column: "vehicle_state",     Kind: KindEnumNormalized, Transformer: NormalizeVehicleState})

    // ... add any remaining typed columns from the migration file ...
}
```

## Suggested Fix

1. Open the Phase 3 SQL file for `vehicle_live_state` and list every typed column
2. For each, add at least one `add(HotRoute{...})` call (alias names from Tesla docs are fine and encouraged)
3. Reference transformer functions even if not implemented yet — they live in `internal/telemetry/transformers.go` and Phase 5 already provided the canonical list (or add stubs returning `(raw, nil)` to be replaced)
4. Build + commit

## Acceptance Criteria

- [ ] Every typed column on `vehicle_live_state` covered by ≥1 catalog entry
- [ ] Tesla name aliases (e.g., `Soc`/`BatteryLevel`) both present where Tesla emits both
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] `LookupHot("BatteryLevel").Table == "vehicle_live_state"` (smoke test)
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
$cols = (Select-String -Path migrations\_baseline_source\02-vehicle-live-state.sql -Pattern '^\s+\w+\s+(text|bigint|double|boolean|timestamptz|smallint|integer)' -ErrorAction SilentlyContinue).Count
$entries = (Select-String -Path internal\telemetry\hot_catalog_vehicle_live_state.go -Pattern 'Table:\s*"vehicle_live_state"').Count
Write-Host "live_state typed cols: $cols ; catalog entries: $entries"
```

## Out of Scope

- Don't populate other tables here (prompts 04–08)
- Don't implement transformers (declared by name only)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog_vehicle_live_state.go
git commit -m "telemetry(db-refactor): populate vehicle_live_state hot routes

ADR-002: register every Tesla signal whose destination is a typed
column on vehicle_live_state. One file per destination table.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3 schema for `vehicle_live_state`
- ADR-002
