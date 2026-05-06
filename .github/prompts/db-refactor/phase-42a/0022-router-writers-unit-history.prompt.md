---
description: "Phase 42a - unit_history no-op writer (Setting*Unit fields short-circuit in pipeline)"
---

# Prompt 0022 — `router/writers/unit_history_writer.go`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0022-router-writers-unit-history.log` |
| Depends on | `phase-42a-0010-router-writers-snapshot-base.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/router/writers/unit_history_writer.go`, `internal/tesla/router/writers/unit_history_writer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

The 4 `Setting*Unit` fields (SettingChargeUnit, SettingDistanceUnit,
SettingTemperatureUnit, SettingTirePressureUnit) are routed in
`routing.yaml` with `dest: unit_history`. However, per
`internal/tesla/normalize/pipeline.go:191-212`, `processOne` checks
`meta.IsSettingUnit` FIRST and short-circuits these atomics through
`observeSettingUnit` (which writes to `vehicle_unit_history` directly via
`unithistory.Repo.Record`) — they NEVER reach `router.Route`.

So in steady state, `router.New(writers)` requires a Writer registered
under `DestUnitHistory` only because the constructor's coverage check
asserts every routing.yaml destination has a writer. The writer itself
will never be invoked by Pipeline.Process. This prompt creates that
no-op writer so router.New succeeds.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | File | `unit_history_writer.go`, `NewUnitHistoryWriter() router.Writer` (no pool dep — writer is genuinely no-op) |
| 2 | Implementation | Returns a private struct with `Write(ctx, atomic, dst) error` that LOGS at WARN with a "this writer should never be called" message and returns `nil`. Returning an error would propagate to the writer-failures metric, which would mislead operators into thinking unit_history is broken when in fact it's just the contract violation that's broken. |
| 3 | Why WARN log | If this writer IS ever invoked, that means `Pipeline.processOne`'s `IsSettingUnit` short-circuit failed — which is a code regression worth surfacing immediately. WARN is loud enough to catch in dashboards but not noisy enough to page if someone misconfigures routing.yaml briefly. |
| 4 | Tests | (a) Constructor returns non-nil. (b) Write call returns nil. (c) Write call logs WARN with the field name in the message. |

## Action Steps

1. `git status` clean.
2. Predecessor 0010 DONE.
3. `=== AUDIT_EVIDENCE ===` dump:
   - The 4 `dest: unit_history` routes from routing.yaml.
   - Lines 191-212 of `internal/tesla/normalize/pipeline.go` showing the short-circuit.
   - Confirmation that no production code path calls this writer's Write method (grep for `unit_history` Writer invocations).
4. Implement per Decisions.
5. Tests.
6. Gate (build/vet/test/git status).
7. Commit `feat(tesla/router): add unit_history no-op writer (Setting*Unit short-circuit)`.
8. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `routing.yaml` has fields with `dest: unit_history` that are NOT
`Setting*Unit` (i.e., `meta.IsSettingUnit == false`), BLOCK — those
fields WOULD reach this writer in production and the no-op contract is
wrong for them.
