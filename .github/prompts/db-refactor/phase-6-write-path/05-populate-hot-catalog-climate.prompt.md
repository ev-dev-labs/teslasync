---
description: "Phase 6 — Populate HotCatalog entries for climate_snapshots typed columns"
---

# 🔵 Write-Path 05 — Populate `climate_snapshots` Routes

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 5 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog_climate.go` (new) |
| Depends on | `04-populate-hot-catalog-positions` |
| Blocks | `06-populate-hot-catalog-motor` |
| ADR refs | ADR-002 |

## Single Goal

Register Tesla signal routes for climate: inside/outside temps, HVAC auto mode, defrost mode, driver/passenger temp setting, plus seat heater states if present in Phase 3.

## Recommendation

```go
package telemetry

func init() {
    add := func(r HotRoute) { HotCatalog[r.Name] = r }

    add(HotRoute{Name: "InsideTemp",           Table: "climate_snapshots", Column: "inside_temp_c",            Kind: KindNumeric})
    add(HotRoute{Name: "OutsideTemp",          Table: "climate_snapshots", Column: "outside_temp_c",           Kind: KindNumeric})
    add(HotRoute{Name: "HvacAutoMode",         Table: "climate_snapshots", Column: "hvac_auto_mode",           Kind: KindEnumNormalized, Transformer: NormalizeHvacAutoMode})
    add(HotRoute{Name: "DefrostMode",          Table: "climate_snapshots", Column: "defrost_mode",             Kind: KindEnumNormalized, Transformer: NormalizeDefrostMode})
    add(HotRoute{Name: "DriverTempSetting",    Table: "climate_snapshots", Column: "driver_temp_setting_c",    Kind: KindNumeric})
    add(HotRoute{Name: "PassengerTempSetting", Table: "climate_snapshots", Column: "passenger_temp_setting_c", Kind: KindNumeric})

    // Seat heaters (per Phase 3 enum normalization in migration 000139)
    add(HotRoute{Name: "SeatHeaterLeft",       Table: "climate_snapshots", Column: "seat_heater_left",  Kind: KindEnumNormalized, Transformer: NormalizeSeatHeater})
    add(HotRoute{Name: "SeatHeaterRight",      Table: "climate_snapshots", Column: "seat_heater_right", Kind: KindEnumNormalized, Transformer: NormalizeSeatHeater})
}
```

## Acceptance Criteria

- [ ] Every typed column on `climate_snapshots` covered
- [ ] Enum-typed columns use `KindEnumNormalized` with the matching transformer
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
Select-String -Path internal\telemetry\hot_catalog_climate.go -Pattern 'Table:\s*"climate_snapshots"' | Measure-Object | ForEach-Object { "climate entries: $($_.Count)" }
```

## Out of Scope

- Don't populate motor/security/charging here

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog_climate.go
git commit -m "telemetry(db-refactor): populate climate_snapshots hot routes

Inside/outside temps, HVAC, defrost, driver/passenger setpoints, seat
heaters. Enum cols pinned to migration 000139's normalized values.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3 schema for `climate_snapshots`
- migration 000139 (HVAC normalization)
