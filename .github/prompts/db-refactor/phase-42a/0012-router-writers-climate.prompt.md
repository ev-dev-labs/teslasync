---
description: "Phase 42a - climate writer (climate_snapshots)"
---

# Prompt 0012 — `router/writers/climate_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0012-router-writers-climate.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/climate_writer.go`, `internal/tesla/router/writers/climate_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection.
5. No stubs. 6. No delegation. 7. No predecessor bypass. 8. No commit on red.
9. No silent drift. 10. Log MUST contain `EXIT=<int>` and `STATUS=<DONE|BLOCKED>`.
11. No dead code retention. 12. No production blind spot.
<!-- END COVENANT -->

## Logging Requirements

Write `=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===` to the output log.

## Problem

`climate_snapshot` is the largest snapshot destination at 31 routes,
covering HVAC state, cabin temps, seat heaters, defrost, AC. The table
schema (mig 000183):

```
climate_snapshots(vehicle_id BIGINT, ts TIMESTAMPTZ,
  inside_temp_c, outside_temp_c, hvac_left_request_c,
  hvac_right_request_c, hvac_ac_enabled BOOLEAN,
  hvac_auto_mode BOOLEAN, ...)
```

This writer composes `snapshotWriter` from prompt 0010 with a
field→column map covering all 31 routes.

## VIN RESOLUTION CONTRACT (inherited from 0010, commit a53135018)

`codec.Atomic.VehicleID` is the **Payload-level VIN string**, NOT the numeric `vehicles.id`. This writer composes `snapshotWriter` so it INHERITS the VIN-lookup INSERT pattern for free. No additional handling.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **File location** | `internal/tesla/router/writers/climate_writer.go`. Constructor: `NewClimateWriter(pool *pgxpool.Pool) router.Writer`. |
| 2 | **Composition** | Returns a `snapshotWriter` instance with `table = "climate_snapshots"` and a `columnFor` callback that maps each routed field. |
| 3 | **Field map source of truth** | Build the map by reading `routing.yaml` entries with `dest: climate_snapshot` and using the `column:` field declared there. Do NOT hand-curate the map — derive it from routing.yaml at file-edit time so future routing changes only need a routing.yaml update + this file's map regen. The map is a static `var` in this file (compile-time constant). |
| 4 | **Verification gate** | A reflective test in `_test.go` walks `routing.yaml`, filters to `dest: climate_snapshot`, and asserts every routed field has an entry in this writer's `columnFor` map. Catches drift between routing.yaml and the writer. |
| 5 | **Tests** | (a) reflective coverage test from #4. (b) one positive test per kind (float64, bool, text). (c) one negative test for unknown field. |

## Action Steps

1. Verify `git status` clean.
2. Verify predecessor 0010 DONE.
3. In `=== AUDIT_EVIDENCE ===`, dump:
   - All 31 `dest: climate_snapshot` routes from routing.yaml with their `column:` value.
   - The full column list from `migrations/000183_snapshots_si.up.sql` for `climate_snapshots`.
   - Confirm every routed `column:` value matches an actual table column.
4. Implement writer per Decisions #1-#4.
5. Implement tests per Decision #5.
6. Gate `=== GATE ===`:
   - `go build ./internal/tesla/router/writers/...`
   - `go vet`
   - `go test -race ./internal/tesla/router/writers/...`
   - `git status --short` allowed only
7. Commit `feat(tesla/router): add climate writer (climate_snapshots, 31 fields)`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If a routed `column:` does not match a table column, BLOCK with full
discrepancy in the log. Do not add columns or rename routes.
