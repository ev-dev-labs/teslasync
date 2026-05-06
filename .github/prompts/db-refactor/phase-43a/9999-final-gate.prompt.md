---
description: "Phase 43a - final gate (re-run hook coverage audit; assert 0 MISSING_ROUTE, 0 unallowlisted ORPHAN)"
---

# Prompt 9999 — Phase-43a final gate

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-43a-9999-final-gate.log` |
| Depends on | ALL phase-43a logs 0001-0008 (EXIT=0/STATUS=DONE) |
| Allowed files to change | the output log only |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-43a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== PRIOR_LOG_SWEEP ===`, `=== HOOK_COVERAGE_RERUN ===`, `=== INVARIANT_PROOFS ===`, `=== TEST_SUITE ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

After 0001-0008 add the 9 missing routes, the phase-43 hook-coverage
audit (which BLOCKED at the close of phase-43) MUST now report 0
MISSING_ROUTE and 0 not-allowlisted ORPHAN. This gate verifies that.

It also re-runs phase-43's own 9999 final-gate to confirm phase-43 now
PASSES (was BLOCKED solely on the hook coverage gap).

## Action Steps

1. `git status` clean (only the log file may be touched).
2. `=== PREFLIGHT ===` capture HEAD, branch, status.
3. `=== PRIOR_LOG_SWEEP ===` for each:
   ```
   phase-43a-0001-orphans.log
   phase-43a-0002-coverage-mount.log
   phase-43a-0003-state-timeline.log
   phase-43a-0004-mileage.log
   phase-43a-0005-vampire-drain.log
   phase-43a-0006-guard.log
   phase-43a-0007-signal-catalog.log
   phase-43a-0008-trip-detail.log
   ```
   Assert each exists and final EXIT=0/STATUS=DONE. Use Get-Content + Select-String + [-1] indexing.
4. `=== HOOK_COVERAGE_RERUN ===` re-execute the phase-43 hook coverage audit script:
   - `node web/scripts/audit-hook-coverage.mjs` (or whichever script phase-43 prompt 0080 produced; verify path in DESIGN of phase-43 0080).
   - Capture full output.
   - Assert: `MISSING_ROUTE count: 0`, `ORPHAN count` ≤ length of `INTENTIONAL_ORPHANS` allowlist, `OK count` ≥ 53.
5. `=== INVARIANT_PROOFS ===`:
   - Each of the 9 new routes responds with non-404 to a smoke fetch (use `curl` against a test server OR a `httptest` Go invocation — capture per-route HTTP status).
   - All 4 guard routes accessible (auth check is acceptable; just NOT 404).
6. `=== TEST_SUITE ===`:
   - `go build ./...` MUST succeed.
   - `go vet ./...` MUST succeed.
   - `go test -race ./...` MUST pass.
   - `cd web && npx tsc --noEmit` MUST pass.
   - `cd web && npm run lint` MUST pass.
   - Test count MUST be ≥ phase-42a 9999's count (no regressions).
7. **PHASE-43 9999 RE-GATE**: rerun phase-43 final gate (`bash .github/prompts/db-refactor/scripts/run-prompt.sh phase-43/9999-final-gate.prompt.md`) — capture EXIT/STATUS. ASSERT EXIT=0/STATUS=DONE. (This is the original phase-43 gate, which was BLOCKED solely on hook coverage; with phase-43a's new routes in place, it MUST now pass.)
8. `=== GATE ===` consolidate. STATUS=BLOCKED if anything failed.
9. `=== COMMIT ===` commit log only with appropriate message.
10. Append `EXIT=<0|1>` and `STATUS=<DONE|BLOCKED>` lines.

## Escape hatch

NONE. The hook-coverage audit MUST report 0 MISSING_ROUTE; if it
doesn't, surface which hook still has unmatched URLs and BLOCK. Re-run
of phase-43 9999 is the canonical proof that phase-43a closed phase-43's
gap; if phase-43 9999 still BLOCKS for a NEW reason (not hook
coverage), surface and BLOCK — phase-43a does not silently absorb
unrelated phase-43 regressions.
