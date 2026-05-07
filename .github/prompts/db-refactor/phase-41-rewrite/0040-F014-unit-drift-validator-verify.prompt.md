---
description: "Phase 41-rewrite F014 - verify unit-drift-validator end-to-end against post-cutover production wiring"
---

# Prompt 0040 — F014: unit-drift-validator coupling verification

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F014 (HIGH, test-realism)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0040-F014-unit-drift-validator-verify.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/worker/unit_drift_validator.go`, `internal/worker/unit_drift_validator_test.go`, `cmd/unit-drift-validator/main.go`, helm/teslasync/templates/cronjob-unit-drift-validator.yaml, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F014)

The `unit-drift-validator` CronJob was added (closeout commit b1dd7ea4)
to detect drift between in-memory unit cache and `vehicle_unit_history`.
For the canary to be meaningful, `vehicle_unit_history` must actually
be populated in production. F013 (RESOLVED-DECISION-A) chose forward
cutover via phase-42a, so the table now has rows.

## Invariant

After phase-42a/0050 cutover landed, `vehicle_unit_history` is
populated by `internal/tesla/router/writers/unit_history_writer.go`
(prompt 0022). The CronJob's drift check must:
1. Run against the populated table.
2. Detect a deliberate drift case (in-memory cache says "miles", DB
   row says "km") and exit non-zero.
3. Be wired into `go test ./...` so future regressions are caught.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Verification approach | Add a deterministic integration test under `internal/worker/unit_drift_validator_test.go` (NOT under cmd/) that constructs a fixture `vehicle_unit_history` row, primes an in-memory unit cache with the wrong unit, runs the validator, and asserts non-zero exit + correct stderr message. |
| 2 | Helm template touch | Verify the CronJob template still references `cmd/unit-drift-validator/main.go` and that `helm template` produces a valid manifest. If the cmd was moved or renamed, fix the template. NO new helm value keys. |
| 3 | Production wiring evidence | In `=== AUDIT_EVIDENCE ===` show: (a) `internal/tesla/router/writers/unit_history_writer.go` exists and is wired in cmd/teslasync/main.go, (b) `vehicle_unit_history` table exists per migration, (c) routing.yaml has at least one `dest: unit_history` entry. If any is missing, BLOCK with explicit hand-off. |
| 4 | Build/test gate | `go test -count=1 ./internal/worker/... ./cmd/unit-drift-validator/...` + `helm lint helm/teslasync` + `helm template t helm/teslasync \| grep -q unit-drift-validator`. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===` — dump production wiring evidence per Decision #3.
3. `=== IMPLEMENTATION ===` — author the integration test; touch helm template only if drift exists.
4. `=== GATE ===` — run all gates per Decision #4.
5. `=== COMMIT ===` `test(worker): F014 — wire unit-drift-validator integration test against post-cutover wiring`.

## Coupling note

This finding was originally coupled to F013. F013 closed via Decision-A
(forward cutover) at phase-42a. F014's remediation here ASSUMES the
cutover is live (verified via Decision #3). If AUDIT_EVIDENCE shows
otherwise, BLOCK and surface the gap.
