---
description: "Phase 42a - positions writer (positions_si table)"
---

# Prompt 0011 — `router/writers/positions_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0011-router-writers-positions.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/positions_writer.go`, `internal/tesla/router/writers/positions_writer_test.go`, the output log |

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

`positions` is the SI-canonical table created by migration 000182. It
holds 4 routed fields per `routing.yaml`: `Location` (compound, flattened
to lat/lng — see Decision #3), `VehicleSpeed` (→ `speed_mps`), `Gps` (→
`gps_state`), and one altitude/heading-shaped atomic. The table schema:

```
positions(vehicle_id BIGINT, ts TIMESTAMPTZ, lat DOUBLE PRECISION,
          lng DOUBLE PRECISION, altitude_m DOUBLE PRECISION,
          speed_mps DOUBLE PRECISION, heading_deg DOUBLE PRECISION,
          gps_state TEXT, ...)
```

Positions cannot use the shared `snapshotWriter` helper because the
`Location` atomic carries lat AND lng in a single Atomic (pre-flattened
by `codec.Decode` per ADR-004 #3) — the writer must bind two columns
from one Atomic, not one column per Atomic. Speed/heading/altitude/gps
each map to a single column.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **File location** | `internal/tesla/router/writers/positions_writer.go`. Constructor: `NewPositionsWriter(pool *pgxpool.Pool) router.Writer`. |
| 2 | **Compound Location handling** | When `atomic.Field == "Location"`, expect `atomic.SIValue.(codec.LocationValue)` (or whichever concrete type `codec` exports for flattened lat/lng pairs — check `internal/tesla/codec/atomic.go`). Bind both `lat` and `lng` columns in one INSERT. |
| 3 | **Per-field column mapping** | `Location → lat,lng`, `VehicleSpeed → speed_mps`, `Gps → gps_state`, `Altitude → altitude_m` (if present in routing.yaml, else omit), `Heading → heading_deg` (same). Verify the routed fields by `Select-String -Path internal\tesla\router\routing.yaml -Pattern 'dest:\s*positions' -Context 1,1`. Author the writer to handle EXACTLY the routed fields, not speculative ones. |
| 4 | **Upsert semantics** | `INSERT INTO positions (vehicle_id, ts, <col1>, <col2>...) VALUES ($1, $2, $3, $4...) ON CONFLICT (vehicle_id, ts) DO UPDATE SET <col1>=EXCLUDED.<col1>, ...`. Same idempotency contract as the snapshot writers. |
| 5 | **Unknown-field guard** | Switch on `atomic.Field` with explicit cases for the routed fields and `default` returning `fmt.Errorf("positionsWriter: unrouted field %q", atomic.Field)`. The router would never call us with an unrouted field (routing.yaml is the gate), but defence in depth catches a routing.yaml regression. |
| 6 | **Tests** | One test per routed field. One test for the compound Location atomic asserting both lat and lng land in the recorded SQL args. One test for unknown-field error. |

## Action Steps

1. Verify `git status` clean.
2. Verify predecessor `phase-42a-0010-router-writers-snapshot-base.log` is EXIT=0/STATUS=DONE.
3. In `=== AUDIT_EVIDENCE ===`, capture the actual `dest: positions` routes from `routing.yaml` and the actual columns from `migrations/000182_positions_si.up.sql`. Author the writer to match exactly.
4. Implement per Decisions #1-#5.
5. Implement tests per Decision #6.
6. Gate in `=== GATE ===`:
   - `go build ./internal/tesla/router/writers/...`
   - `go vet ./internal/tesla/router/writers/...`
   - `go test -race ./internal/tesla/router/writers/...`
   - `git status --short` shows only allowed files
7. Commit `feat(tesla/router): add positions writer (positions_si)` with Co-authored-by.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `routing.yaml` lists a `dest: positions` field that does NOT have a
matching column in `positions` table, BLOCK and surface the discrepancy.
Do NOT add the column or remove the routing entry — that is a separate
prompt's job.
