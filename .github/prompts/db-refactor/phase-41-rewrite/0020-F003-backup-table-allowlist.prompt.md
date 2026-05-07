---
description: "Phase 41-rewrite F003 - prune backup table allowlist to surviving post-phase-42 tables"
---

# Prompt 0020 — F003: Backup table allowlist

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F003 (HIGH, schema-consistency)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0020-F003-backup-table-allowlist.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/backup/processor.go`, `internal/backup/processor_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F003)

`internal/backup/processor.go:24-31` (and the use site at L89-100)
references `vampire_drain_events`, `daily_mileage`, `vehicle_states`,
`visited_locations` in the `backupTables` allowlist. Migration
`000180_drop_legacy_telemetry.up.sql:27-41` dropped those tables.
Result: silent partial backup — the operator gets a "success" message
but the tables they expected are not in the artifact.

## Invariant

The backup table allowlist must reference only tables surviving
migration 000180 (i.e., present in `information_schema.tables` after
all migrations apply). A configured table that does not exist must
FAIL the backup hard, not silently skip.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | `internal/backup/processor.go` (allowlist + verify behaviour) + new sibling test file. |
| 2 | Allowlist pruning | Remove `vampire_drain_events`, `daily_mileage`, `vehicle_states`, `visited_locations`. Audit ALL remaining entries against the post-phase-42 schema; remove any others that are gone. |
| 3 | Behaviour change | When an allowlisted table is missing at backup time, return `fmt.Errorf("backup: required table %q is not present in schema", name)` — HARD FAIL. NOT silent partial. |
| 4 | Test | Add a unit test that constructs an in-memory list of `information_schema.tables` (or a stub Registry) and asserts every entry in `backupTables` exists. The test must FAIL if a future migration drops a table without updating the allowlist. |
| 5 | Build/test gate | `go test -count=1 ./internal/backup/...` |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Dump `backupTables` at L24-31 BEFORE.
   - Dump migration 000180 lines 27-41 (the legacy DROP statements).
   - Cross-reference: list the legacy tables the allowlist still cites.
   - Verify against the full migration set (000142..000188): list any other allowlisted table that is NOT created by any migration.
3. `=== IMPLEMENTATION ===`:
   - Edit processor.go to prune the allowlist + flip the behaviour from silent partial to hard fail.
   - Add `processor_test.go` with the table-existence assertion.
4. `=== GATE ===`:
   - `go build ./internal/backup/...`
   - `go vet ./internal/backup/...`
   - `go test -count=1 ./internal/backup/...`
5. `=== COMMIT ===` commit `fix(backup): F003 — prune backup allowlist to surviving SI tables; hard-fail on missing`.
