---
description: "Phase 42a - tire pressure writer (tire_pressure_snapshots)"
---

# Prompt 0014 — `router/writers/tire_pressure_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0014-router-writers-tire-pressure.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/tire_pressure_writer.go`, `internal/tesla/router/writers/tire_pressure_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-12 per phase-42a baseline.
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`tire_pressure_snapshot` covers 8 routes: pressure (Pa, SI from raw psi
or kPa via `SettingTirePressureUnit`) per corner, plus optional
status/sensor-id columns. Table (mig 000183):

```
tire_pressure_snapshots(vehicle_id, ts,
  front_left_pa DOUBLE PRECISION, front_right_pa DOUBLE PRECISION,
  rear_left_pa DOUBLE PRECISION, rear_right_pa DOUBLE PRECISION,
  front_left_status TEXT, front_right_status TEXT, ...)
```

Per ADR-004 #9, the SI value arriving at this writer is ALREADY in
Pascals (the unit conversion happened in `normalize.toSI`). The writer
just persists; it does not re-convert.

## VIN RESOLUTION CONTRACT (inherited from 0010, commit a53135018)

`codec.Atomic.VehicleID` is the **Payload-level VIN string**, NOT the numeric `vehicles.id`. This writer composes `snapshotWriter` so it INHERITS the VIN-lookup INSERT pattern for free. No additional handling.

## Locked Implementation Decisions

Same composition pattern as 0012/0013:

| # | Decision | Choice |
|---|---|---|
| 1 | File | `tire_pressure_writer.go`, `NewTirePressureWriter(pool) router.Writer` |
| 2 | Composition | `snapshotWriter` with `table = "tire_pressure_snapshots"`, columnFor map |
| 3 | Map source | `routing.yaml` `dest: tire_pressure_snapshot` |
| 4 | Reflective coverage test | Walks routing.yaml, asserts all 8 routes mapped |
| 5 | Tests | Coverage + 1 positive (float64 Pa) + 1 positive (text status) + unknown-field |

## Action Steps

1-8: identical to 0012, swapping in `tire_pressure_snapshot`/`tire_pressure_snapshots`.

Commit message: `feat(tesla/router): add tire pressure writer (tire_pressure_snapshots, 8 fields)`.

## Escape hatch

If routed column missing from table: BLOCK.
