---
description: "Phase 41-rewrite F018 - end-to-end production-wiring integration test (regression net)"
---

# Prompt 0050 — F018: End-to-end pipeline integration test

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F018 (HIGH, test-realism)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0050-F018-end-to-end-integration-test.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `cmd/teslasync/main_pipeline_e2e_test.go` (NEW) OR `internal/tesla/integration/pipeline_e2e_test.go` (NEW) — pick the one consistent with existing test layout, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F018)

There is NO test that constructs the production wiring
(`mqtt.NewPipelineSubscriber → codec.Decoder → normalize.Pipeline →
router → writers → DB`) end-to-end. The closest existing tests cover
the OLD wiring (`internal/tesla/normalize/normalize_test.go` tests
the deprecated pipeline; `internal/mqtt/mqtt_test.go:213-700` tested
the legacy subscriber). Phase-42a/0050 cutover landed the new wiring
in production, but the regression net for "tests pass but production
is wrong" is missing.

## Invariant

Test surface MUST cover the production path, not just artifacts. An
integration test that wires the actual production ingest path
end-to-end and asserts SI values land correctly is the only safety
net for this kind of bug class.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | ONE new test file (NOT a new package). The test file constructs the same wiring graph cmd/teslasync/main.go does, but with a fake mqtt.Client + fake DB pool (or pgxmock). |
| 2 | Inputs | A small set (~3) of golden Tesla protobuf payloads covering: drive telemetry (drives row asserted), charging telemetry (charging_telemetry row asserted), and a malformed payload (asserts redelivery / DLQ semantics per ADR-004 #6). |
| 3 | Outputs | Assert SI-canonical values land in the right tables. Concrete examples: a payload of `VehicleSpeed=27.78 m/s` lands in `drive_telemetry.speed_mps=27.78` (NOT 100.0 km/h, NOT 62.14 mph). |
| 4 | Unit conversion path | The test MUST exercise the actual normalize.Pipeline path, not a stub. If a production conversion bug exists, the test catches it. |
| 5 | Build/test gate | `go test -count=1 -run TestPipelineE2E ./...` runs in <30s and passes. |
| 6 | NOT in scope | Performance benchmarks, fuzz seeds, real DB integration. Save those for a follow-up phase. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Confirm cmd/teslasync/main.go has the production wiring at HEAD.
   - List the 3 golden payloads you will use (extract from existing fixtures if possible).
   - Identify pgxmock or testcontainers presence in go.mod.
3. `=== IMPLEMENTATION ===`:
   - Author the test file in the chosen location.
   - Use existing helpers if any (e.g., test pool setup in `internal/database/testdb/`).
4. `=== GATE ===`:
   - `go build ./...`
   - `go vet ./...`
   - `go test -count=1 -run TestPipelineE2E ./...`
   - All MUST pass.
5. `=== COMMIT ===` commit `test(pipeline): F018 — add end-to-end production-wiring regression test`.

## Rationale

This is the regression net for any future phase-41 rewrite or phase-42
re-cutover. Without it, any pipeline change can pass unit tests yet
silently corrupt production data — the exact bug class phase-42 was
written to address.
