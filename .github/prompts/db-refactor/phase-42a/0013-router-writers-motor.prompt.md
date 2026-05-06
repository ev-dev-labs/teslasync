---
description: "Phase 42a - motor writer (motor_snapshots)"
---

# Prompt 0013 — `router/writers/motor_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0013-router-writers-motor.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/motor_writer.go`, `internal/tesla/router/writers/motor_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1-12 per phase-42a baseline.
<!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`motor_snapshot` covers 36 powertrain fields: torque per-motor (front,
rear, left, right, center), RPM, current, voltage, regen, brake state.
Table schema (mig 000183):

```
motor_snapshots(vehicle_id, ts, power_w, front_torque_nm,
  rear_torque_nm, rear_left_torque_nm, rear_right_torque_nm,
  torque_motor_nm, ...)
```

## Locked Implementation Decisions

Same pattern as 0012 (climate_writer):

| # | Decision | Choice |
|---|---|---|
| 1 | File | `internal/tesla/router/writers/motor_writer.go`, `NewMotorWriter(pool) router.Writer` |
| 2 | Composition | `snapshotWriter` with `table = "motor_snapshots"`, columnFor map for all 36 routes |
| 3 | Map source of truth | Derived from `routing.yaml` `dest: motor_snapshot` entries |
| 4 | Reflective coverage test | Walks routing.yaml, asserts every routed field is mapped |
| 5 | Tests | Coverage test + per-kind positives + unknown-field negative |

## Action Steps

Identical structure to 0012, substituting `motor_snapshot` / `motor_snapshots`.

1. `git status` clean.
2. Predecessor 0010 DONE.
3. `=== AUDIT_EVIDENCE ===` dump 36 routes + full column list from mig 000183.
4. Implement.
5. Test.
6. Gate (build + vet + test + git status).
7. Commit `feat(tesla/router): add motor writer (motor_snapshots, 36 fields)`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If routed column missing from table: BLOCK. Do not patch the schema here.
