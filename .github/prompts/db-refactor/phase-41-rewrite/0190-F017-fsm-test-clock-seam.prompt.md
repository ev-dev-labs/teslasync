---
description: "Phase 41-rewrite F017 - replace time.Sleep with clock seam in FSM tests"
---

# Prompt 0190 — F017: FSM test clock seam

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F017 (MED, test-realism)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0190-F017-fsm-test-clock-seam.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/fsm/telemetry/machine.go`, `internal/fsm/telemetry/machine_test.go`, optionally `internal/fsm/telemetry/clock.go` (NEW), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F017)

`internal/fsm/telemetry/machine_test.go:277-298` (`TestCustomThresholds_Respected`)
uses `time.Sleep(15ms)` then asserts `state == Streaming`. Real-time
Sleep in tests produces flaky CI runs and slow test suites. Future
sibling tests in the package will copy the pattern.

## Invariant

Tests MUST NOT depend on real wall-clock time for behaviour
assertions. Time-dependent code accepts a clock seam (a `Clock`
interface or `time.Now` function arg) so tests can advance time
deterministically.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Seam shape | Add a `Clock` interface to internal/fsm/telemetry: `type Clock interface { Now() time.Time }`. Production wiring uses `realClock{}` (`time.Now`); tests use a `fakeClock` with an explicit `Advance(d time.Duration)` method. |
| 2 | Constructor change | `NewMachine(...)` accepts an optional `Clock` (functional option or last arg with default). Existing call sites in cmd/ and internal/ unchanged when option is omitted. |
| 3 | Test rewrite | Replace `time.Sleep(15*time.Millisecond)` + `machine.CheckTimeouts()` with `clock.Advance(20*time.Millisecond)` + `machine.CheckTimeouts()`. Test runs instantly. |
| 4 | Coverage | Refactor any other timing-sensitive test in the package to use the same seam (audit grep). |
| 5 | Build/test gate | `go test -count=1 -race ./internal/fsm/telemetry/...` runs in <1s and passes deterministically. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Dump test L277-298 BEFORE.
   - Grep `time.Sleep` across `internal/fsm/telemetry/` for sibling violations.
3. `=== IMPLEMENTATION ===`:
   - Add Clock interface + realClock + fakeClock.
   - Refactor NewMachine to accept Clock (default realClock).
   - Rewrite the cited test + any sibling violations to use fakeClock.Advance.
4. `=== GATE ===`:
   - `grep -n 'time.Sleep' internal/fsm/telemetry/*_test.go` — must be ZERO matches in behavior assertions (timing-aware test setup is acceptable but should be commented).
   - `go build ./...`
   - `go test -count=1 -race ./internal/fsm/telemetry/...`
5. `=== COMMIT ===` commit `test(fsm): F017 — replace time.Sleep with deterministic clock seam`.
