---
description: "Phase 41-rewrite final gate - assert all 15 findings closed; full repo go test ./... + go build ./..."
---

# Prompt 9999 — Phase-41-rewrite final gate

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-9999-final-gate.log` |
| Depends on | ALL phase-41-rewrite logs 0000, 0010-0050, 0100-0190 (EXIT=0/STATUS=DONE) |
| Allowed files to change | the output log only |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== PRIOR_LOG_SWEEP ===`, `=== FINDING_CLOSURE_PROOFS ===`, `=== TEST_SUITE ===`, `=== INVARIANT_PROOFS ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

After 0010-0190 land their fixes, the 15 OPEN findings (F002-F012,
F014-F015, F017-F018) MUST all be closed. This gate verifies each
closure is real (anchored grep / test pass) and not just claimed.

## Action Steps

1. `git status` clean (only the log file may be touched).
2. `=== PREFLIGHT ===` capture HEAD, branch, status.
3. `=== PRIOR_LOG_SWEEP ===` for each:
   ```
   phase-41-rewrite-0000-preflight-and-baseline.log
   phase-41-rewrite-0010-F002-schema-test-rewrite.log
   phase-41-rewrite-0020-F003-backup-table-allowlist.log
   phase-41-rewrite-0030-F004-error-leak-writeerror.log
   phase-41-rewrite-0040-F014-unit-drift-validator-verify.log
   phase-41-rewrite-0050-F018-end-to-end-integration-test.log
   phase-41-rewrite-0100-F005-rate-limit-mutations.log
   phase-41-rewrite-0110-F006-sse-context-leak.log
   phase-41-rewrite-0120-F007-healthcheck-timeout.log
   phase-41-rewrite-0130-F008-healthcheck-resp-close.log
   phase-41-rewrite-0140-F009-battery-handler-null-shape.log
   phase-41-rewrite-0150-F010-mqtt-malformed-payload.log
   phase-41-rewrite-0160-F011-expected-results-stale.log
   phase-41-rewrite-0170-F012-unit-drift-integration-test.log
   phase-41-rewrite-0180-F015-telemetry-ingest-docstring.log
   phase-41-rewrite-0190-F017-fsm-test-clock-seam.log
   ```
   For each: read with Get-Content, find LAST EXIT= and LAST STATUS= via Select-String + [-1]. Assert EXIT=0 + (STATUS=DONE OR STATUS=CLOSED-BY-PHASE-42A-* OR STATUS=CLOSED-BY-PHASE-43A-*). Any deviation BLOCKS.
4. `=== FINDING_CLOSURE_PROOFS ===` — for each finding, run the closure proof:
   - F002: `grep -nE 'distance_mi|energy_used_kwh|duration_min|avg_speed_mph' internal/database/schema_test.go` MUST return 0 in criticalChecks (allowed in mustNotExist).
   - F003: `grep -nE 'vampire_drain_events|daily_mileage|vehicle_states|visited_locations' internal/backup/processor.go` MUST return 0.
   - F004: `grep -nE 'writeError\([^)]*err\.Error\(\)\)' internal/api/` MUST return 0.
   - F005: anchored grep that every mutation route in router.go is wrapped in LimitByIP (or explicitly allowlisted with comment).
   - F006: `grep -n 'context.Background()' internal/api/router.go` MUST not appear at the cited L407-410 range.
   - F007: `grep -nE '\bhttp\.Get\(' cmd/*/main.go` MUST return 0.
   - F008: `grep -B1 -nE 'client\.Get\(' cmd/*/main.go | grep -c 'defer resp.Body.Close'` >= 4.
   - F009: target battery_handler fields are pointer-typed (grep for `*float64` and `omitempty`).
   - F010: AUTO-CLOSE-ACCEPTED (legacy subscriber gone) OR explicit error path present.
   - F011: `grep -nE 'vehicle_live_state|distance_mi' tests/fixtures/` MUST return 0.
   - F012: `grep -l 'TestUnitDriftValidator' cmd/unit-drift-validator/` MUST return at least 1 file.
   - F014: integration test exists in `internal/worker/unit_drift_validator_test.go`.
   - F015: AUTO-CLOSE-ACCEPTED OR docstring rewritten (anchored grep).
   - F017: `grep -n 'time.Sleep' internal/fsm/telemetry/*_test.go` is 0 in behavior assertions.
   - F018: integration test exists in either `cmd/teslasync/main_pipeline_e2e_test.go` or `internal/tesla/integration/pipeline_e2e_test.go`.
5. `=== TEST_SUITE ===`:
   - `go build ./...`
   - `go vet ./...`
   - `go test -race -count=1 ./...`
   - All MUST exit 0.
6. `=== INVARIANT_PROOFS ===`:
   - Reflective coverage: writers + handlers untouched outside the allowed-files of each prompt.
   - `git diff --stat <pre-phase-41-rewrite-HEAD>..HEAD` produces a clean per-prompt audit (exactly 16 commits, one per remediation prompt, plus this gate's commit).
7. `=== GATE ===` write `EXIT=0` + `STATUS=DONE` if everything green.
8. `=== COMMIT ===` `git add -f` the log + commit `chore(phase-41-rewrite/9999): final gate — all 15 findings closed`.
