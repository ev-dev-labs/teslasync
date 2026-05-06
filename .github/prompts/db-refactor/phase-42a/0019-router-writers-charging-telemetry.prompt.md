---
description: "Phase 42a - charging telemetry writer (charging_telemetry, time-series)"
---

# Prompt 0019 — `router/writers/charging_telemetry_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0019-router-writers-charging-telemetry.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/charging_telemetry_writer.go`, `internal/tesla/router/writers/charging_telemetry_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`charging_telemetry` is the per-tick time-series table (NOT the
session-aggregate table — that is `charging_sessions`, populated by the
session tracker side-effect). 12 routes covering AC/DC charging power,
voltage, current, energy in/out, charger phase. Table (mig 000184):

```
charging_telemetry(vehicle_id BIGINT, ts TIMESTAMPTZ, session_id BIGINT,
  ac_charging_power_w, dc_charging_power_w, ac_charging_energy_in_wh,
  dc_charging_energy_in_wh, charger_voltage_v, ...)
```

`session_id` is populated later by the session tracker FK update — the
writer leaves it NULL on insert.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | File | `charging_telemetry_writer.go`, `NewChargingTelemetryWriter(pool) router.Writer` |
| 2 | Composition | `snapshotWriter` with `table = "charging_telemetry"`. The (vehicle_id, ts) PK upsert pattern works for time-series too — two atomics for the same tick land in the same row with both columns set, exactly as desired. |
| 3 | session_id handling | Writer NEVER touches `session_id`. The session tracker (a side-effect observer in 0030) backfills it via a separate UPDATE after session boundaries are detected. Writer's INSERT statement omits `session_id` from the column list. |
| 4 | Map source | `routing.yaml` `dest: charging_telemetry` |
| 5 | Reflective coverage test | Walks routing.yaml |
| 6 | Tests | Coverage + per-kind positive + unknown-field + assert session_id NULL on insert |

## Action Steps

1. `git status` clean.
2. Predecessor 0010 DONE.
3. `=== AUDIT_EVIDENCE ===` dump 12 routes + charging_telemetry columns.
4. Implement per Decisions #1-#3.
5. Tests per Decision #6.
6. Gate.
7. Commit `feat(tesla/router): add charging telemetry writer (charging_telemetry, 12 fields)`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If a routed `column:` references `session_id`: BLOCK — that column is
managed by the session tracker, not the writer.
