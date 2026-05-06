---
description: "Phase 42a - HTTP webhook unification (ProcessBatch → pipeline.Process; delete normalizeFleetUnits)"
---

# Prompt 0060 — HTTP webhook unification

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0060-http-webhook-unification.log` |
| Depends on | `phase-42a-0050-cutover-cmd-teslasync.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/telemetry_handler.go`, `internal/api/telemetry_handler_ingest.go`, `internal/api/telemetry_handler_test.go`, `internal/api/telemetry_handler_integration_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

After 0050 cuts MQTT over to `normalize.Pipeline`, the HTTP webhook
ingest path remains a SECOND ingest entry that bypasses the pipeline.
At `internal/api/telemetry_handler_ingest.go:489`,
`(*TelemetryHandler).ProcessBatch` still calls `normalizeFleetUnits`
(L512) — the legacy unit-normalization function ADR-004 #2 explicitly
deprecates ("single pipeline, every value visited exactly once").

This violates ADR-004 #2 because there are now two pipelines:

1. MQTT → `normalize.Pipeline.Process` (post-0050)
2. HTTP webhook → `ProcessBatch` → `normalizeFleetUnits` → snapshot/snapshot writes

Both must terminate at `pipeline.Process` for ADR-004 #2 to hold.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **TelemetryHandler.Pipeline field** | Add `pipeline *normalize.Pipeline` field to `TelemetryHandler`. Set via existing `SetPipeline(p)` setter or constructor argument. Verify in 0050 cutover that the wired pipeline is also passed to `telemetryHandler.SetPipeline(pipeline)`. |
| 2 | **ProcessBatch rewrite** | The HTTP webhook receives raw decoded `[]codec.Atomic` (from the existing decode path in `TelemetryIngest`). Rewrite ProcessBatch to call `h.pipeline.ProcessAtomics(ctx, atomics, vehicleID)` — note this requires exposing `ProcessAtomics` as a public method on Pipeline (currently unexported). Single-public-entry invariant test must be updated to allow this second method. **OR** ALTERNATIVE: re-encode atomics back to bytes and call `Pipeline.Process(payload)`. Reject this — wasteful + loses the "atomics already decoded" optimization. **CHOSEN: expose ProcessAtomics as public method**. |
| 3 | **Single-public-entry invariant update** | `TestSinglePipelineInvariant` is updated to allow `Process` AND `ProcessAtomics` as the two public ingest methods. Document that `ProcessAtomics` is THE only entry that accepts pre-decoded atomics, used by the HTTP webhook adapter only. The reflective assertion changes from "exactly 1 public ingest" to "exactly the set {Process, ProcessAtomics}". |
| 4 | **normalizeFleetUnits deletion** | DELETE the function `normalizeFleetUnits` AND its 3 call sites in `telemetry_handler_ingest.go`. The new pipeline already does unit normalization via `normalize.toSI`; the legacy function would silently double-normalize OR fight the pipeline's per-vehicle unit lookup. |
| 5 | **flattenCompoundMapValue** | DELETE — codec.Decode already flattens compounds per ADR-004 #3. |
| 6 | **ProcessSignals (legacy entry)** | RENAME ProcessSignals to processSignalsLegacyDeprecated AND mark with `// Deprecated: phase-42a unified ingest; will be deleted in prompt 0090. Do not call from new code.`. Cannot delete here because session_recovery and a few other backfill paths still call it; deletion happens in 0090. |
| 7 | **Tests** | Update `telemetry_handler_test.go` to construct TelemetryHandler with a fake pipeline. Update `telemetry_handler_integration_test.go` to call ProcessBatch and assert it dispatches to the pipeline. Add a regression test asserting `normalizeFleetUnits` is no longer in the file (grep). |

## Action Steps

1. `git status` clean.
2. Predecessor 0050 DONE.
3. `=== AUDIT_EVIDENCE ===` capture:
   - Lines 489-545 of `telemetry_handler_ingest.go` (the ProcessBatch + normalizeFleetUnits region).
   - All call sites of `normalizeFleetUnits` (`grep -n 'normalizeFleetUnits' internal/api/`).
   - The current `TestSinglePipelineInvariant` reflection assertion.
4. Add `ProcessAtomics` public method to `internal/tesla/normalize/pipeline.go`. Update reflective test per Decision #3.
   ⚠️ **NOTE:** This step touches `internal/tesla/normalize/pipeline.go` which is NOT in the allowed-files list. EITHER: (a) extend the allowed files in this prompt's metadata to include normalize/pipeline.go and pipeline_test.go, OR (b) author a tiny prerequisite prompt 0055 that adds ProcessAtomics. **CHOOSE (a)** — extend allowed files: also add `internal/tesla/normalize/pipeline.go`, `internal/tesla/normalize/pipeline_test.go`.
5. Modify `TelemetryHandler` to take + store `*normalize.Pipeline` (Decision #1). Update `cmd/teslasync` wiring to call `telemetryHandler.SetPipeline(pipeline)` — ⚠️ ALSO outside allowed files. Extend allowed files: also add `cmd/teslasync/main.go`.
6. Rewrite `ProcessBatch` per Decision #2.
7. Delete `normalizeFleetUnits` + `flattenCompoundMapValue` per Decisions #4-#5.
8. Rename + deprecate-mark `ProcessSignals` per Decision #6.
9. Update tests per Decision #7.
10. Gate:
    - `go build ./...`
    - `go vet ./...`
    - `go test -race ./internal/api/... ./internal/tesla/normalize/... ./cmd/teslasync/...`
    - `grep -n 'normalizeFleetUnits' internal/api/` MUST return 0 lines.
    - `grep -n 'flattenCompoundMapValue' internal/api/` MUST return 0 lines.
    - `git status --short` allowed only.
11. Commit `refactor(api): unify HTTP webhook ingest through normalize.Pipeline; delete normalizeFleetUnits`.
12. `EXIT=0` `STATUS=DONE`.

## Allowed files (FINAL, after Action Step 4-5 expansion)

- `internal/api/telemetry_handler.go`
- `internal/api/telemetry_handler_ingest.go`
- `internal/api/telemetry_handler_test.go`
- `internal/api/telemetry_handler_integration_test.go`
- `internal/tesla/normalize/pipeline.go`
- `internal/tesla/normalize/pipeline_test.go`
- `cmd/teslasync/main.go`
- the output log

## Escape hatch

If exposing `ProcessAtomics` causes >5 call sites in tests to fail
because they relied on the unexported `processAtomics`, BLOCK and
re-author Decision #2 to use the re-encode-to-bytes alternative
explicitly. Do not silently coerce by adding a `processAtomicsForTest`
shim — that creates exactly the kind of two-entry surface the invariant
prevents.
