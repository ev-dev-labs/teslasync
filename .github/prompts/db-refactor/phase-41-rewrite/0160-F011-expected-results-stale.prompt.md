---
description: "Phase 41-rewrite F011 - refresh tests/fixtures/EXPECTED_RESULTS.md against post-phase-42 schema"
---

# Prompt 0160 — F011: EXPECTED_RESULTS.md stale references

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F011 (MED, schema-consistency)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0160-F011-expected-results-stale.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `tests/fixtures/EXPECTED_RESULTS.md`, `tests/fixtures/seed_test_vehicle.sql`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F011)

`tests/fixtures/EXPECTED_RESULTS.md:37-97` and
`tests/fixtures/seed_test_vehicle.sql:37-39` still validate against
the pre-phase-42 schema (`vehicle_live_state`, `charging_telemetry`
with old column names, `tire_pressure_*` snapshots in old shape).
Migrations 000180-000188 replaced these. The fixtures still pass
manual inspection but lie about what the schema actually contains.

## Invariant

Test fixtures and EXPECTED_RESULTS docs MUST reference real,
current-schema column and table names. A fixture that targets a
deleted table is documentation rot.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Documentation-only | EXPECTED_RESULTS.md is markdown documentation — no code execution. The fix is editorial: rewrite stale table/column references to the post-phase-42 SI canon. Reference migrations 000180-000188 as the source of truth. |
| 2 | seed_test_vehicle.sql | Update or delete the stale comment at L37-39. Prior fixup commit b1dd7ea4 fixed only the `vehicle_units` reference; `vehicle_live_state` mention is still stale. |
| 3 | NO production code change | This prompt does NOT touch any .go file or migration. Documentation only. |
| 4 | Gate | `grep -nE 'vehicle_live_state\|distance_mi\|energy_used_kwh\|duration_min' tests/fixtures/` returns 0 matches. Markdown lint not required (project does not run mdlint). |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Dump EXPECTED_RESULTS.md L37-97 BEFORE.
   - Dump seed_test_vehicle.sql L37-39 BEFORE.
   - Run the legacy-name grep across `tests/fixtures/` to enumerate every stale reference.
3. `=== IMPLEMENTATION ===`:
   - Rewrite stale references to SI-canonical names.
   - Where a table no longer exists at all (e.g., `vehicle_live_state`), explain in the doc what replaced it (e.g., "see signal_log + signal.Store layered architecture per ADR-002").
4. `=== GATE ===`:
   - Re-run the legacy-name grep — must be 0.
5. `=== COMMIT ===` commit `docs(fixtures): F011 — refresh EXPECTED_RESULTS against post-phase-42 schema`.
