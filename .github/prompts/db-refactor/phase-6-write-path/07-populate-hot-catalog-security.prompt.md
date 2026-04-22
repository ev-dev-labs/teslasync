---
description: "Phase 6 — Populate HotCatalog entries for security_events typed columns (compound-aware)"
---

# 🔵 Write-Path 07 — Populate `security_events` Routes

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 7 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog_security.go` (new) |
| Depends on | `06-populate-hot-catalog-motor` |
| Blocks | `08-populate-hot-catalog-charging` |
| ADR refs | ADR-002 |

## Single Goal

Register Tesla signal routes for `security_events`. The complication: `DoorState` and `WindowState` are compound — they're registered with empty `Column` and `KindCompoundDoors`/`KindCompoundWindows`, then prompts 11 (Flatten) emit per-door / per-window atomic names which ALSO need entries here pointing at the typed bool/text columns.

## Recommendation

```go
package telemetry

func init() {
    add := func(r HotRoute) { HotCatalog[r.Name] = r }

    // Compound parents (Flatten() in prompts 11/13 expands these)
    add(HotRoute{Name: "DoorState",   Table: "security_events", Column: "", Kind: KindCompoundDoors})
    add(HotRoute{Name: "WindowState", Table: "security_events", Column: "", Kind: KindCompoundWindows})

    // Door atomic children (produced by flattenDoors)
    add(HotRoute{Name: "DoorState_DriverFront",     Table: "security_events", Column: "door_driver_front_open",     Kind: KindBool})
    add(HotRoute{Name: "DoorState_PassengerFront",  Table: "security_events", Column: "door_passenger_front_open",  Kind: KindBool})
    add(HotRoute{Name: "DoorState_DriverRear",      Table: "security_events", Column: "door_driver_rear_open",      Kind: KindBool})
    add(HotRoute{Name: "DoorState_PassengerRear",   Table: "security_events", Column: "door_passenger_rear_open",   Kind: KindBool})
    add(HotRoute{Name: "DoorState_FrontTrunk",      Table: "security_events", Column: "front_trunk_open",           Kind: KindBool})
    add(HotRoute{Name: "DoorState_RearTrunk",       Table: "security_events", Column: "rear_trunk_open",            Kind: KindBool})

    // Window atomic children (produced by flattenWindows; values from migration 000132)
    add(HotRoute{Name: "WindowState_DriverFront",    Table: "security_events", Column: "window_driver_front",    Kind: KindEnumNormalized, Transformer: NormalizeWindowState})
    add(HotRoute{Name: "WindowState_PassengerFront", Table: "security_events", Column: "window_passenger_front", Kind: KindEnumNormalized, Transformer: NormalizeWindowState})
    add(HotRoute{Name: "WindowState_DriverRear",     Table: "security_events", Column: "window_driver_rear",     Kind: KindEnumNormalized, Transformer: NormalizeWindowState})
    add(HotRoute{Name: "WindowState_PassengerRear",  Table: "security_events", Column: "window_passenger_rear",  Kind: KindEnumNormalized, Transformer: NormalizeWindowState})

    // Lock / sentry / valet / turn signal
    add(HotRoute{Name: "Locked",            Table: "security_events", Column: "locked",            Kind: KindBool})
    add(HotRoute{Name: "SentryMode",        Table: "security_events", Column: "sentry_mode",       Kind: KindEnumNormalized, Transformer: NormalizeSentryMode})
    add(HotRoute{Name: "ValetMode",         Table: "security_events", Column: "valet_mode",        Kind: KindBool})
    add(HotRoute{Name: "TonneauPosition",   Table: "security_events", Column: "tonneau_position",  Kind: KindEnumNormalized, Transformer: NormalizeTonneauPosition})
    add(HotRoute{Name: "TonneauTentMode",   Table: "security_events", Column: "tonneau_tent_mode", Kind: KindEnumNormalized, Transformer: NormalizeTonneauTentMode})
    add(HotRoute{Name: "TurnSignal",        Table: "security_events", Column: "turn_signal",       Kind: KindEnumNormalized, Transformer: NormalizeTurnSignal})
}
```

## Acceptance Criteria

- [ ] Compound parents `DoorState` + `WindowState` both registered with empty `Column`
- [ ] All 6 door atomic children registered as `KindBool`
- [ ] All 4 window atomic children registered with `NormalizeWindowState`
- [ ] Lock/sentry/valet/tonneau/turn-signal columns covered
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
Select-String -Path internal\telemetry\hot_catalog_security.go -Pattern '"DoorState_|"WindowState_' | Measure-Object | ForEach-Object { "compound atomic entries: $($_.Count)" }
# Expected: 10
```

## Out of Scope

- Don't implement `flattenDoors` / `flattenWindows` here (prompt 11)
- Don't widen the door inventory beyond Phase 3 columns

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog_security.go
git commit -m "telemetry(db-refactor): populate security_events hot routes

Compound parents (DoorState, WindowState) plus per-part atomic
children that route to typed bool/text columns. Lock/sentry/valet/
tonneau/turn-signal cols included with normalizers from migrations
000131-000133.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3 schema for `security_events`
- migrations 000131 (door widening), 000132 (window state), 000133 (turn signal)
