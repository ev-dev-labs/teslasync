---
description: "Phase 6 — Populate HotCatalog entries for motor_snapshots typed columns"
---

# 🔵 Write-Path 06 — Populate `motor_snapshots` Routes

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 6 of 32

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `internal/telemetry/hot_catalog_motor.go` (new) |
| Depends on | `05-populate-hot-catalog-climate` |
| Blocks | `07-populate-hot-catalog-security` |
| ADR refs | ADR-002 |

## Single Goal

Register Tesla signal routes for the motor/powertrain hypertable: inverter temp, motor RPM (front/rear), regen brake torque, battery pack temp.

## Recommendation

```go
package telemetry

func init() {
    add := func(r HotRoute) { HotCatalog[r.Name] = r }

    add(HotRoute{Name: "DriveInverterTemp",   Table: "motor_snapshots", Column: "drive_inverter_temp_c", Kind: KindNumeric})
    add(HotRoute{Name: "RearMotorRpm",        Table: "motor_snapshots", Column: "rear_motor_rpm",        Kind: KindNumeric})
    add(HotRoute{Name: "FrontMotorRpm",       Table: "motor_snapshots", Column: "front_motor_rpm",       Kind: KindNumeric})
    add(HotRoute{Name: "DriveMotorRpm",       Table: "motor_snapshots", Column: "rear_motor_rpm",        Kind: KindNumeric}) // single-motor alias
    add(HotRoute{Name: "RegenBrakeTorque",    Table: "motor_snapshots", Column: "regen_brake_torque_nm", Kind: KindNumeric})
    add(HotRoute{Name: "BatteryTemp",         Table: "motor_snapshots", Column: "battery_temp_c",        Kind: KindNumeric})
    add(HotRoute{Name: "PowertrainTorqueNm",  Table: "motor_snapshots", Column: "powertrain_torque_nm",  Kind: KindNumeric})
}
```

## Acceptance Criteria

- [ ] Every typed column on `motor_snapshots` covered
- [ ] `go build ./internal/telemetry/...` exits 0
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync
go build ./internal/telemetry/...
Select-String -Path internal\telemetry\hot_catalog_motor.go -Pattern 'Table:\s*"motor_snapshots"' | Measure-Object | ForEach-Object { "motor entries: $($_.Count)" }
```

## Out of Scope

- Don't add cold-only motor diagnostics — those land in `signal_observations`

## Commit When Done

```powershell
cd D:\repos\teslasync
git add internal/telemetry/hot_catalog_motor.go
git commit -m "telemetry(db-refactor): populate motor_snapshots hot routes

Inverter temp, motor RPM (single + dual), regen torque, battery temp,
powertrain torque.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- Phase 3 schema for `motor_snapshots`
