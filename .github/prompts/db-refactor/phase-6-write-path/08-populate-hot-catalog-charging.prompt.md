---
description: "Phase 6 — Populate HotCatalog entries for charging_telemetry typed columns"
---

# 🔵 Write-Path 08 — Populate `charging_telemetry` Routes

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 8 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog_charging.go` (new) |
| Depends on | `07-populate-hot-catalog-security` |
| Blocks | `09-test-hot-catalog-coverage` |
| ADR refs | ADR-002 |

## Single Goal

Register Tesla signal routes for `charging_telemetry`: amps, voltage, phases, charge limit SoC, energy added, scheduled time (compound).

## Recommendation

```go
package telemetry

func init() {
    add := func(r HotRoute) { HotCatalog[r.Name] = r }

    add(HotRoute{Name: "ChargerPower",         Table: "charging_telemetry", Column: "charger_power_kw",        Kind: KindNumeric})
    add(HotRoute{Name: "ChargerVoltage",       Table: "charging_telemetry", Column: "charger_voltage",         Kind: KindNumeric})
    add(HotRoute{Name: "ChargerActualCurrent", Table: "charging_telemetry", Column: "charger_actual_current",  Kind: KindNumeric})
    add(HotRoute{Name: "ChargeAmps",           Table: "charging_telemetry", Column: "charge_amps",             Kind: KindNumeric})
    add(HotRoute{Name: "ChargerPhases",        Table: "charging_telemetry", Column: "charger_phases",          Kind: KindNumeric})
    add(HotRoute{Name: "ChargeLimitSoc",       Table: "charging_telemetry", Column: "charge_limit_soc",        Kind: KindNumeric})
    add(HotRoute{Name: "ChargeEnergyAdded",    Table: "charging_telemetry", Column: "charge_energy_added_kwh", Kind: KindNumeric})
    add(HotRoute{Name: "FastChargerType",      Table: "charging_telemetry", Column: "fast_charger_type",       Kind: KindEnumNormalized, Transformer: NormalizeFastChargerType})
    add(HotRoute{Name: "FastChargerPresent",   Table: "charging_telemetry", Column: "fast_charger_present",    Kind: KindBool})

    // Compound time — Flatten in prompt 12 collapses {Hour,Minute,Second} -> "HH:MM:SS"
    add(HotRoute{Name: "ScheduledChargingStartTime", Table: "charging_telemetry", Column: "scheduled_charging_at", Kind: KindCompoundTime})
    add(HotRoute{Name: "ScheduledDepartureTime",     Table: "charging_telemetry", Column: "scheduled_departure_at", Kind: KindCompoundTime})
}
```

## Acceptance Criteria

- [ ] Every typed column on `charging_telemetry` covered
- [ ] Both compound time signals registered as `KindCompoundTime`
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
Select-String -Path internal\telemetry\hot_catalog_charging.go -Pattern 'Table:\s*"charging_telemetry"' | Measure-Object | ForEach-Object { "charging entries: $($_.Count)" }
```

## Out of Scope

- Don't implement `flattenTime` here (prompt 12)
- Don't add session lifecycle logic — that's repo-layer concern

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog_charging.go
git commit -m "telemetry(db-refactor): populate charging_telemetry hot routes

Power, voltage, current, amps, phases, charge limit, energy added,
fast-charger type/present, scheduled-time compounds.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3 schema for `charging_telemetry`
