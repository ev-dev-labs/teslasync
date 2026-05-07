---
description: "Phase 41-rewrite F002 - rewrite schema_test.go criticalChecks against post-phase-42 SI columns"
---

# Prompt 0010 — F002: Schema-verification test rewrite

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F002 (HIGH, schema-consistency)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0010-F002-schema-test-rewrite.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/database/schema_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F002)

`TestRepoColumnsMatchSchema` in `internal/database/schema_test.go:70-128`
asserts columns that no longer exist on 4 phase-42-rewritten tables.
Migrations 000182 (positions), 000183 (snapshots), 000184 (charging),
000185 (drives), 000187 (fsm_live) replaced legacy mph/kwh/min names
with SI-canonical names + unit suffixes per ADR-004 #4. The test will
either pass against a stale schema (if the test process bootstraps an
old DB) or fail in CI loudly. Either way it stops protecting the schema.

## Invariant

Schema verification tests must reflect the post-phase-42 SI-canonical
column shape. The test must FAIL if any production migration drifts
back toward legacy unit names, and PASS against the SI-canonical
shape from migrations 000180-000188.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | `internal/database/schema_test.go` only — the criticalChecks slice + mustNotExist forbidden-name list. No production-code changes. |
| 2 | Drives table renames | start_ts→started_at, end_ts→ended_at, duration_min→duration_s, distance_mi→distance_m, avg_speed_mph→avg_speed_mps, max_speed_mph→max_speed_mps, start_battery_pct→start_soc_pct, end_battery_pct→end_soc_pct, energy_used_kwh→energy_used_wh, regen_kwh→regen_energy_wh, avg_power_kw→avg_power_w, outside_temp_avg_c→ambient_temp_c_avg. Drop inside_temp_avg_c + score (do not exist post-rewrite). |
| 3 | Charging_sessions / positions / security_events | Apply analogous SI rewrites — read each migration file (000182-000185, 000187) to derive the canonical column list, do not invent names. |
| 4 | mustNotExist list | Add legacy names (distance_mi, energy_used_kwh, duration_min, avg_speed_mph, etc.) so a future migration regression FAILS the test. |
| 5 | Build/test gate | `go test -run TestRepoColumnsMatchSchema -count=1 ./internal/database/...` against a real test DB OR a schema fixture. If the package's existing test infrastructure does not boot a DB, document why and fall back to a static-list cross-check against the migration files (parse CREATE TABLE statements). |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Dump `internal/database/schema_test.go:70-128` BEFORE.
   - Dump CREATE TABLE blocks from migrations 000182, 000183, 000184, 000185, 000187 — column lists.
   - Build the rewrite map column-by-column.
3. `=== IMPLEMENTATION ===`:
   - Edit schema_test.go: rewrite criticalChecks, extend mustNotExist.
   - Re-read the file post-edit and assert no legacy mph/kwh/min name remains in criticalChecks.
4. `=== GATE ===`:
   - `go build ./internal/database/...`
   - `go vet ./internal/database/...`
   - `go test -count=1 ./internal/database/...`
   - All MUST pass. Write `EXIT=<code>`.
5. `=== COMMIT ===` `git add internal/database/schema_test.go .github/prompts/db-refactor/logs/phase-41-rewrite-0010-F002-schema-test-rewrite.log` (the log gets `git add -f`); commit `test(database): F002 — rewrite schema verification against SI-canonical columns`.

## Done condition

`go test ./internal/database/... -count=1` passes AND the test contains explicit assertions for every SI-canonical column AND mustNotExist forbids the legacy names.
