---
description: "Phase 42a - HARD CUTOVER (cmd/teslasync: legacy NewSubscriber → NewPipelineSubscriber)"
---

# Prompt 0050 — HARD CUTOVER

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0050-cutover-cmd-teslasync.log` |
| Depends on | `phase-42a-0040-dlq-and-manual-ack.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `cmd/teslasync/main.go`, `cmd/teslasync/main_pipeline_wiring_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE_BEFORE ===`, `=== IMPLEMENTATION ===`, `=== AUDIT_EVIDENCE_AFTER ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

This is the moment-of-truth prompt. `cmd/teslasync/main.go:476` currently
constructs `ftSubscriber := mqtt.NewSubscriber(...)` (legacy). All the
prerequisites are now in place:

- Phase-42a 0010-0022: All 12 production `router.Writer` implementations
- Phase-42a 0030: `AtomicsObserver` + `SideEffectsObserver`
- Phase-42a 0040: Production paho client + DLQ helper

This prompt rewrites the MQTT subscriber wiring block in
`cmd/teslasync/main.go` to:

1. Construct all 12 writers (positions, climate, motor, tire_pressure,
   media, safety, location, security_event, charging_telemetry,
   drive_telemetry, signal_log, unit_history)
2. Construct `unithistory.Cache` + `unithistory.Repo` from existing
   Redis + DB pool
3. Construct `router.New(map[Destination]Writer{...})` with all 12
4. Construct `normalize.New(histRepo, router, log, sideEffectsObserver)`
5. Construct `SideEffectsObserver` with the existing 5 callbacks
6. Construct `paho.Client + MQTTDLQPublisher` via the 0040 helper
7. Construct `mqtt.NewPipelineSubscriber(pahoClient, pipeline, dlq, vinResolver, cfg, log)`
8. **Delete** the `mqtt.NewSubscriber(...)` block AND the variable

Per 0000 Decision #4: hard cutover. No feature flag. The deletion + the
new wiring are in the SAME diff. There is NO commit between them where
both subscribers exist.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Wiring location** | The new wiring replaces the existing `if cfg.FleetTelemetry.Enabled` block in `main.go` (around L308 currently). The block stays gated by `cfg.FleetTelemetry.Enabled` — disabling Fleet Telemetry must still be a clean no-op. |
| 2 | **Writer construction order** | Writers first (no dependencies between writers). Then `router.New(writers)`. Then `unithistory.Cache + Repo`. Then `SideEffectsObserver`. Then `normalize.New`. Then paho + DLQ. Then `PipelineSubscriber`. |
| 3 | **VINResolver** | The existing `vehicleRepo.GetByVIN` (or whatever the existing implementation is — verify in AUDIT_EVIDENCE) wrapped in a small adapter. |
| 4 | **Subscriber start** | Same `Start()` pattern as legacy — no goroutine wrapper change. The pipeline subscriber's `Start()` returns when the context is cancelled. |
| 5 | **Old TelemetryHandler reuse** | The existing `telemetryHandler` (constructed at L305-309) STAYS — its 5 side-effect callbacks (live store, signal history, FSM, sessions, alerts, SSE) are passed INTO `SideEffectsObserver`. Only the MQTT subscriber wiring changes; the HTTP handler surface is untouched (HTTP webhook unification is a separate prompt 0060). |
| 6 | **Compile-time assertion** | Add a small `main_pipeline_wiring_test.go` that imports `cmd/teslasync` (via a test-only main_test that calls a `buildPipeline` helper extracted from main) and asserts: (a) all 12 writers are non-nil, (b) the observer list is non-empty, (c) `mqtt.NewSubscriber` is NOT in the import path used (covenant rule 12). |
| 7 | **Failure rollback note** | A comment block at the top of the new wiring documents the rollback procedure: revert this commit, redeploy. No data loss because the legacy subscriber writes to the SAME tables — wait that's NOT true. Update the comment to: "Rollback: revert this commit. SI tables stop receiving data immediately. Legacy snapshot/aggregate tables are GONE (mig 000180); rollback requires the phase-42-pre-drop backup. Effectively, this cutover is one-way." |

## Action Steps

1. `git status` clean.
2. Predecessor 0040 DONE.
3. `=== AUDIT_EVIDENCE_BEFORE ===` capture:
   - `grep -n 'NewSubscriber\|NewPipelineSubscriber' cmd/teslasync/main.go` — must show legacy present, new absent.
   - `grep -rn 'router\.Writer' internal/tesla/router/writers/ --include='*.go' | grep -v _test.go` — must show 12 writer constructors.
   - The current `if cfg.FleetTelemetry.Enabled` block (L300-L500 or wherever it lives — full quote).
4. Implement the new wiring block per Decisions #1-#7. **Delete** the old `ftSubscriber := mqtt.NewSubscriber(...)` lines.
5. Implement `main_pipeline_wiring_test.go` per Decision #6.
6. `=== AUDIT_EVIDENCE_AFTER ===` capture:
   - `grep -n 'NewSubscriber' cmd/teslasync/main.go` — MUST return 0 lines (covenant 11: no dead code retention; covenant 12: no production blind spot).
   - `grep -n 'NewPipelineSubscriber' cmd/teslasync/main.go` — MUST return >= 1 line.
   - `grep -n 'normalize.New\|router.New' cmd/teslasync/main.go` — MUST return >= 2 lines.
7. Gate:
   - `go build ./cmd/teslasync` MUST succeed.
   - `go vet ./cmd/teslasync ./internal/...` MUST succeed.
   - `go test -race ./cmd/teslasync/...` MUST pass.
   - `go test -race ./internal/...` MUST pass (smoke check that nothing else broke).
   - `git status --short` allowed only.
8. Commit `feat(cmd/teslasync): cut over MQTT subscriber to PipelineSubscriber (HARD)`. Include in body: "Phase-42a/0050 cutover. Legacy mqtt.NewSubscriber removed. All 12 writers wired. SideEffectsObserver bridges legacy callbacks. Manual-ack + DLQ active. ROLLBACK: revert this commit; SI tables stop receiving data immediately."
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If ANY of the AUDIT_EVIDENCE_AFTER greps returns the wrong result
(legacy still present, new still absent), STOP, mark BLOCKED, do NOT
commit. The cutover is incomplete and committing would put the system in
a half-cut state.

If `go test ./internal/...` fails, the failure is the surfacing of an
incompatibility between phase-42a's writers and a downstream consumer.
DO NOT silence the failure. Either: (a) fix the test to reflect the new
data shape (acceptable), or (b) BLOCK and surface the architectural gap.
