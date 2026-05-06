---
description: "Phase 42a - drive telemetry writer (drives_si time-series rows)"
---

# Prompt 0020 — `router/writers/drive_telemetry_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0020-router-writers-drive-telemetry.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/drive_telemetry_writer.go`, `internal/tesla/router/writers/drive_telemetry_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`drive_telemetry` parallels `charging_telemetry` for drives: per-tick
speed, gear, brake, accelerator, regen, odometer. 11 routes. Table
schema mirrors mig 000185. The session-aggregate table `drives` is
populated by the session tracker (drive-tracking side effect), not this
writer.

## Locked Implementation Decisions

Identical pattern to 0019:

| # | Decision | Choice |
|---|---|---|
| 1 | File | `drive_telemetry_writer.go`, `NewDriveTelemetryWriter(pool) router.Writer` |
| 2 | Composition | `snapshotWriter` with `table = "drive_telemetry"` (or whatever table mig 000185 created for per-tick drive data — verify in AUDIT_EVIDENCE) |
| 3 | drive_id / session_id | Writer NEVER touches FK to drives — backfilled by session tracker |
| 4 | Map source | `routing.yaml` `dest: drive_telemetry` |
| 5 | Reflective coverage test | Walks routing.yaml |
| 6 | Tests | Coverage + per-kind + unknown-field + assert session FK NULL on insert |

## Action Steps

1. `git status` clean.
2. Predecessor 0010 DONE.
3. `=== AUDIT_EVIDENCE ===` dump 11 routes + the actual table name + columns from mig 000185 for drive-telemetry per-tick rows.
4. Implement per Decisions.
5. Tests.
6. Gate.
7. Commit `feat(tesla/router): add drive telemetry writer (drive_telemetry, 11 fields)`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If mig 000185 does NOT actually create a per-tick drive telemetry table
(only the session-aggregate `drives` table), BLOCK and surface — this
writer's existence presumes a per-tick storage target. A schema gap is a
separate prompt.
