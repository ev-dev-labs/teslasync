---
description: "Phase 42a - AtomicsObserver pattern + SideEffectsObserver bridging atomics→legacy 5 callbacks"
---

# Prompt 0030 — `normalize.AtomicsObserver` + `SideEffectsObserver`

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0030-normalize-observer.log` |
| Depends on | `phase-42a-0022-router-writers-unit-history.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/tesla/normalize/observer.go`, `internal/tesla/normalize/observer_test.go`, `internal/tesla/normalize/pipeline.go`, `internal/tesla/normalize/pipeline_test.go`, `internal/tesla_pipeline/side_effects_observer.go`, `internal/tesla_pipeline/side_effects_observer_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== DESIGN ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

`normalize.Pipeline.Process` does codec → unit_history → router.Route per
ADR-004 #2. The legacy `(*TelemetryHandler).ProcessSignals` path
performs FIVE cross-cutting effects per payload that the new pipeline
does NOT cover:

1. `liveSignalStore.UpdateAll(vehicleID, signals)` — L1 in-process state
2. `signalHistoryWriter.Append(vehicleID, signals)` — durable history append
3. `broadcastSSE(payload)` — SSE fanout
4. `fsmHandler.ProcessSignals(ctx, vehicleID, signals)` — drive/charge/sleep FSM
5. `sessionTracker.ProcessSignals(ctx, vehicleID, vin, signals, accum)` AND `alertEvaluator.Evaluate(ctx, vehicleID, vin, signals, accum)` — sessions + alerts

Cutting over to the new pipeline without these effects will break the
SPA (live state stops updating, SSE goes silent, drives never close,
alerts never fire). They cannot live INSIDE the pipeline (violates
single-responsibility) and cannot live INSIDE writers (couples writers
to FSM/SSE/alerts).

The solution is the **AtomicsObserver** pattern locked in 0000 Decision #1.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Observer interface (in `normalize` package)** | `type AtomicsObserver interface { OnPayloadProcessed(ctx context.Context, vehicleID int64, atomics []codec.Atomic) }`. Single method. Called once per payload AFTER the route loop completes successfully (i.e., after `processAtomics` returns nil). NOT called when codec.Decode fails (no atomics to observe). |
| 2 | **Pipeline integration** | `normalize.New` becomes `New(histRepo, router, log, observers ...AtomicsObserver) *Pipeline`. Variadic observers slice stored in the Pipeline struct. `Process` invokes `obs.OnPayloadProcessed(ctx, vehicleID, atomics)` for each registered observer in registration order, AFTER the route loop. Errors from observers are swallowed + logged at WARN — they MUST NOT fail the payload. |
| 3 | **Single-public-entry invariant** | `TestSinglePipelineInvariant` is updated to allow `Process` as the only public ingest method (already true). Observer registration via constructor doesn't add an ingest method. Verify the reflective test still passes after the New signature change. |
| 4 | **Atomics slice immutability** | The doc comment on `OnPayloadProcessed` states observers MUST NOT mutate the slice. Pipeline does NOT defensively copy (perf) — observers that need to filter make their own copy. |
| 5 | **Observer ordering** | Observers run sequentially in registration order. Production wiring registers exactly one observer (`SideEffectsObserver`). Test wiring may register more. |
| 6 | **`SideEffectsObserver` location** | New package `internal/tesla_pipeline` (not under `internal/tesla/normalize` because it depends on `internal/api` types — FSM, sessions, alerts — which would create an import cycle if placed in normalize). |
| 7 | **`SideEffectsObserver` dependencies** | Constructor takes 5 callable interfaces (matching the legacy callback signatures): `LiveSignalStore.UpdateAll(vehicleID, map[string]any)`, `SignalHistoryWriter.Append(vehicleID, map[string]any)`, `func broadcastSSE(map[string]any)`, `FSMHandler.ProcessSignals(ctx, vehicleID, map[string]any)`, `SessionTracker.ProcessSignals(ctx, vehicleID, vin, map[string]any, accumMap)` + `AlertEvaluator.Evaluate(ctx, vehicleID, vin, map[string]any, accumMap)`. Each is an interface so tests can mock. |
| 8 | **atomics → map conversion** | `SideEffectsObserver.OnPayloadProcessed` builds `signals := make(map[string]any, len(atomics))` and `for _, a := range atomics { signals[a.Field] = a.SIValue }`. The `accumulatedSignals` legacy parameter is replaced with the SAME map (sessions + alerts share the per-payload view). The `vin` is looked up from a `VINResolver` interface passed at observer construction (since atomics carry vehicleID, not VIN). |
| 9 | **Tests (normalize package)** | (a) Pipeline.Process invokes observer with the full atomics slice. (b) Observer is NOT called when codec.Decode fails. (c) Observer error is logged but does not fail Process. (d) Multiple observers run in registration order. (e) TestSinglePipelineInvariant still passes. |
| 10 | **Tests (tesla_pipeline package)** | (a) atomics map conversion: 3 atomics → 3-key map with SIValues. (b) All 5 callbacks invoked once per payload. (c) VIN lookup invoked once per payload. (d) FSM/sessions/alerts get the same map. (e) Live store called BEFORE FSM (FSM may read live state). (f) SSE called LAST (broadcasts the post-update view). |

## Action Steps

1. `git status` clean.
2. Predecessor 0022 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - Current `normalize.New` signature (verify it matches what 0000 documented).
   - All 5 legacy callback signatures from `internal/api/telemetry_handler_ingest.go`.
   - The `TestSinglePipelineInvariant` reflection assertion.
4. `=== DESIGN ===` document the call ordering (live store → history → FSM → sessions+alerts → SSE).
5. Implement `normalize/observer.go` with the interface + a no-op `nilObserver` for tests.
6. Modify `normalize/pipeline.go`: extend `New` signature (variadic observers), add `[]AtomicsObserver` field to Pipeline, invoke observers at the bottom of `processAtomics` (after the loop, before return). Update existing call sites in tests.
7. Implement `tesla_pipeline/side_effects_observer.go` with the bridging logic.
8. Update `pipeline_test.go` per Decision #9.
9. Implement `tesla_pipeline/side_effects_observer_test.go` per Decision #10.
10. Gate `=== GATE ===`:
    - `go build ./internal/tesla/normalize/... ./internal/tesla_pipeline/...`
    - `go vet ./internal/tesla/normalize/... ./internal/tesla_pipeline/...`
    - `go test -race ./internal/tesla/normalize/... ./internal/tesla_pipeline/...`
    - `git status --short` allowed only.
11. Commit `feat(tesla): add AtomicsObserver + SideEffectsObserver for pipeline side-effects`.
12. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If extending `normalize.New` signature breaks more than 5 call sites in
existing tests (i.e., the variadic observer is not source-compatible),
STOP and add a `NewWithObservers` constructor instead, leaving `New` as
a thin wrapper that calls it with no observers. This avoids a sprawling
test-file diff that hides the real change. Document the choice in
`=== DESIGN ===`.
