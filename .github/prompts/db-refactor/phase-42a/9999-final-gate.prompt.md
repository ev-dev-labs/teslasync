---
description: "Phase 42a - final gate (routing coverage 100% + cutover proofs + e2e green)"
---

# Prompt 9999 — Final gate

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-9999-final-gate.log` |
| Depends on | ALL prior phase-42a logs (0000, 0010-0022, 0030, 0040, 0050, 0060, 0080, 0090) EXIT=0/STATUS=DONE |
| Allowed files to change | the output log only |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== PRIOR_LOG_SWEEP ===`, `=== INVARIANT_PROOFS ===`, `=== ROUTING_COVERAGE ===`, `=== CUTOVER_PROOFS ===`, `=== TEST_SUITE ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Final gate for phase-42a. Asserts every prior prompt is DONE, every
architectural invariant holds, the cutover is complete, and the test
suite is green. No code changes — all assertions are read-only.

## Action Steps

1. `git status` clean (only the log file may be touched).
2. `=== PREFLIGHT ===` capture `git rev-parse HEAD`, `git status --short`, current branch.
3. `=== PRIOR_LOG_SWEEP ===` for each expected log filename:
   ```
   phase-42a-0000-methodology-and-cutover-decision.log
   phase-42a-0010-router-writers-snapshot-base.log
   phase-42a-0011-router-writers-positions.log
   phase-42a-0012-router-writers-climate.log
   phase-42a-0013-router-writers-motor.log
   phase-42a-0014-router-writers-tire-pressure.log
   phase-42a-0015-router-writers-media.log
   phase-42a-0016-router-writers-safety.log
   phase-42a-0017-router-writers-location.log
   phase-42a-0018-router-writers-security-event.log
   phase-42a-0019-router-writers-charging-telemetry.log
   phase-42a-0020-router-writers-drive-telemetry.log
   phase-42a-0021-router-writers-signal-log.log
   phase-42a-0022-router-writers-unit-history.log
   phase-42a-0030-normalize-observer.log
   phase-42a-0040-dlq-and-manual-ack.log
   phase-42a-0050-cutover-cmd-teslasync.log
   phase-42a-0060-http-webhook-unification.log
   phase-42a-0080-e2e-pipeline-test.log
   phase-42a-0090-legacy-deletion.log
   ```
   For each: assert `Test-Path`, then assert the LAST occurrence of `EXIT=` is `EXIT=0` and the LAST occurrence of `STATUS=` is `STATUS=DONE`. Use Get-Content + Select-String + [-1] indexing — NOT `Get-Content -Tail` (that flag is mutually exclusive with `-Raw` in PowerShell). If ANY log fails, mark the offender + STATUS=BLOCKED.
4. `=== INVARIANT_PROOFS ===` run these greps and assert results:
   - `grep -rn 'router\.Writer' internal/tesla/router/writers/ --include='*.go' | grep -v _test.go | wc -l` ≥ 12 (all writers exist).
   - `grep -rn 'router\.Writer' internal/ --include='*.go' | grep -v _test.go | grep -v internal/tesla/router/writers/` returns 0 lines (no rogue writers elsewhere).
   - `grep -n 'NewSubscriber\b' cmd/teslasync/main.go` returns 0 lines (legacy gone).
   - `grep -n 'NewPipelineSubscriber' cmd/teslasync/main.go` returns ≥ 1 line (new wired).
   - `grep -rn 'normalizeFleetUnits\|flattenCompoundMapValue' --include='*.go' .` returns 0 lines (legacy unit normalisation gone).
5. `=== ROUTING_COVERAGE ===` run:
   - Count of `field:` entries in `routing.yaml` MUST be 286.
   - Count of distinct destinations in `routing.yaml` MUST be 12.
   - Each of the 11 non-drop destinations MUST have a writer constructor in `internal/tesla/router/writers/` (grep `New<Dest>Writer`).
   - `router.New(...)` invocation in `cmd/teslasync/main.go` MUST register exactly the 11 non-drop destinations + unit_history (no missing, no extras).
6. `=== CUTOVER_PROOFS ===` run:
   - Reflective `TestSinglePipelineInvariant` MUST pass: `go test -race -run TestSinglePipelineInvariant ./internal/tesla/normalize/...`
   - The pipeline construction site in `cmd/teslasync/main.go` MUST register exactly one observer (`SideEffectsObserver`). Verify by inspecting the pipeline-wiring smoke test from 0080.
7. `=== TEST_SUITE ===` run:
   - `go build ./...` MUST succeed.
   - `go vet ./...` MUST succeed.
   - `go test -race ./...` MUST pass.
   - Capture pass count; assert ≥ pass count from phase-42-9999v2-final-gate.log (no test regressions).
8. `=== GATE ===` consolidate all checks. If ANY failed, STATUS=BLOCKED. Else STATUS=DONE.
9. `=== COMMIT ===` if STATUS=DONE: commit the log only with message `chore(phase-42a): final gate PASSED — all prompts DONE, all invariants hold`. If BLOCKED: commit the log only with message `chore(phase-42a): final gate BLOCKED — see log for failures`.
10. Append `EXIT=<0|1>` and `STATUS=<DONE|BLOCKED>` on their own lines.

## Escape hatch

NONE. The final gate has no escape hatch — its job is to surface every
problem honestly. If a prior prompt's log is BLOCKED, this gate MUST be
BLOCKED. If a grep returns the wrong count, this gate MUST be BLOCKED.
A passing final gate is a credible signal that phase-42a is genuinely
complete; a falsely-passing final gate would invalidate every downstream
phase. The Honesty Covenant rule 11 + 12 apply with maximum stringency
here.
