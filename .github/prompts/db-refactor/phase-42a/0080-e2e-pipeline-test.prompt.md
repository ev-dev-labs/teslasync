---
description: "Phase 42a - end-to-end pipeline test (real proto bytes → all 12 dests + all 5 side effects)"
---

# Prompt 0080 — End-to-end pipeline test

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0080-e2e-pipeline-test.log` |
| Depends on | `phase-42a-0060-http-webhook-unification.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla_pipeline/e2e_test.go`, `internal/tesla_pipeline/e2e_helpers_test.go`, `internal/tesla_pipeline/testdata/sample_payload.bin` (new test fixture), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== TEST_DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

Per 0000 Decision #8 ("a reflective test in the e2e prompt walks the
production binary's pipeline construction site and asserts a non-empty
observer list") and the broader cutover safety contract: there is no
test today that proves a real Tesla proto payload, fed through the new
pipeline, reaches ALL 12 destinations AND triggers ALL 5 side effects.

Without this test, regressions in any individual writer or observer go
undetected until production.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Test fixture** | A real Tesla `Payload` proto with sentinel values for at least one routed field per destination (12 fields minimum). Construct in code via the vendored proto types (`api/proto/tesla/...`). Marshal once at TestMain time and reuse. Filename `testdata/sample_payload.bin`. |
| 2 | **DB layer** | Use `pgxmock` or testcontainers postgres (whichever is already used in the project for DB-touching integration tests — check `go.mod`). All 12 writers receive the test pool; assertions read from the test DB after Process completes. |
| 3 | **Side-effect mocks** | The 5 observer callbacks are recording fakes (lightweight structs counting calls + capturing the per-call signals map). Test asserts: (a) liveStore.UpdateAll called once with all 12 routed fields. (b) signalHistoryWriter.Append called once. (c) FSMHandler.ProcessSignals called once. (d) sessionTracker.ProcessSignals called once. (e) alertEvaluator.Evaluate called once. (f) broadcastSSE called once. |
| 4 | **Per-destination assertions** | After Process returns, for each of the 12 destinations: SELECT 1 row with the expected sentinel value. Document the mapping in `=== TEST_DESIGN ===` as a table: Field → Destination → Table → Column → Sentinel. |
| 5 | **Failure isolation test** | A second test feeds a malformed payload (truncated proto bytes) and asserts: (a) Process returns `ErrPayloadDrop`. (b) NO writers are called. (c) NO observers are called (per 0030 Decision #1: observer NOT called when codec.Decode fails). |
| 6 | **Production wiring smoke test** | A third test imports `cmd/teslasync` via a tiny test-only `buildPipeline` helper extracted in 0050, calls it, and asserts: (a) all 12 writers are registered. (b) the observer list contains exactly one observer (`SideEffectsObserver`). (c) `router.New` succeeded (no missing destinations). |
| 7 | **Test pace** | Each e2e test gets `t.Parallel()` to keep the suite under 10s. Use `defer cleanup()` aggressively for DB rows so parallel tests don't see each other's data. |

## Action Steps

1. `git status` clean.
2. Predecessor 0060 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - Confirm all 12 writer constructors exist (grep `New<X>Writer` in `internal/tesla/router/writers/`).
   - Confirm `SideEffectsObserver` constructor exists.
   - Confirm `cmd/teslasync` exposes a buildable pipeline (the 0050 wiring is a single function or a callable test helper).
4. `=== TEST_DESIGN ===` document the 12-row Field→Destination→Table→Column→Sentinel mapping.
5. Implement `e2e_helpers_test.go` with the recording fakes + DB harness.
6. Implement `e2e_test.go` with the 3 tests per Decisions #4-#6.
7. Construct `testdata/sample_payload.bin` (or generate it in TestMain on first run).
8. Gate:
   - `go test -race -v ./internal/tesla_pipeline/...` MUST pass all 3 tests.
   - Test runtime MUST be under 30 seconds total.
   - `git status --short` allowed only.
9. Commit `test(tesla_pipeline): end-to-end test for pipeline + observer + 12 writers`.
10. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If testcontainers-postgres is not available in CI but pgxmock is, use
pgxmock and document. If neither is available, fall back to in-memory
recording fakes for writers and ASSERT the writer was called with the
expected (vehicle_id, ts, field, value) tuple — this drops the actual
DB INSERT verification but keeps the routing + observer chain
exercised. Document this trade-off in `=== TEST_DESIGN ===`.

If a sentinel value cannot be expressed for a destination because the
destination has 0 routes today (e.g., location_snapshot), document the
exemption in `=== TEST_DESIGN ===` and reduce the per-destination
assertion count to N-1. The test should still cover the OTHER 11
destinations.
