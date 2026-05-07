---
description: "Phase 41-rewrite F012 - integration test for unit-drift-validator"
---

# Prompt 0170 — F012: unit-drift-validator integration test

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F012 (MED, test-realism)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0170-F012-unit-drift-integration-test.log` |
| Depends on | `phase-41-rewrite-0040-F014-unit-drift-validator-verify.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `cmd/unit-drift-validator/main_test.go` (NEW), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F012)

No verification exists that `unit-drift-validator` actually catches
the drift case it was built for. The CronJob runs in production but
its detection logic is unproven. Cited:
- `cmd/unit-drift-validator/main.go` (entire)
- `.github/prompts/db-refactor/phase-42/9999v2-final-gate.prompt.md`

## Invariant

The unit-drift-validator's detection logic MUST be exercised by an
automated test that constructs a deliberate drift case (in-memory
unit cache says X, DB row says Y), runs the validator, and asserts
non-zero exit + correct stderr. The test MUST be wired into
`go test ./...` so future regressions surface in CI.

## Coupling note

F012 and F014 are sibling tests — F014 lives in the worker package
(library-level integration), F012 lives in the cmd package
(binary-level integration). Both must exist for full coverage:
- F014 (in this slate at 0040) — proves the worker library detects drift.
- F012 (this prompt) — proves the binary's main() exits non-zero on drift.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | Single new test file `cmd/unit-drift-validator/main_test.go`. Use the standard pattern of constructing a fake DB pool (pgxmock or testcontainers) + invoking `run(ctx, deps)` (factor main into a testable run function if needed). |
| 2 | Drift case | Fixture: `vehicle_unit_history` row with `unit_distance='km'`. In-memory cache primed with `unit_distance='miles'`. Validator MUST exit non-zero. |
| 3 | Negative case | Fixture: matching units. Validator MUST exit zero. |
| 4 | Stderr assertion | Capture stderr via os.Pipe redirect; assert it contains the documented drift message. |
| 5 | Build/test gate | `go test -count=1 ./cmd/unit-drift-validator/...`. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Verify F014's prompt landed (predecessor check).
   - Inspect cmd/unit-drift-validator/main.go to confirm a testable seam exists; note in evidence whether a small refactor of main() is needed.
3. `=== IMPLEMENTATION ===`:
   - Author the test file with both drift and negative cases.
4. `=== GATE ===`:
   - `go build ./cmd/unit-drift-validator/...`.
   - `go test -count=1 ./cmd/unit-drift-validator/...`.
5. `=== COMMIT ===` commit `test(unit-drift-validator): F012 — add binary-level drift-detection integration test`.
