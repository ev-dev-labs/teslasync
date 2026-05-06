---
description: "Phase 42a - legacy code deletion (legacy mqtt.Subscriber, ProcessSignals legacy entry, dead helpers)"
---

# Prompt 0090 — Legacy code deletion

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-42a-0090-legacy-deletion.log` |
| Depends on | `phase-42a-0080-e2e-pipeline-test.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/mqtt/subscriber.go` (or wherever legacy NewSubscriber lives), `internal/mqtt/subscriber_test.go`, `internal/api/telemetry_handler_ingest.go`, `internal/api/telemetry_handler_test.go`, `internal/api/telemetry_handler_integration_test.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE_BEFORE ===`, `=== DELETION_PLAN ===`, `=== DELETION_EXECUTED ===`, `=== AUDIT_EVIDENCE_AFTER ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem

After 0050 cutover and 0060 HTTP unification, several legacy code paths
are now DEAD but still compiled into the binary:

1. `mqtt.NewSubscriber` (legacy, non-Pipeline) — deleted in 0050 from
   `cmd/teslasync` but the constructor + struct still exist in
   `internal/mqtt/subscriber.go`. ZERO callers remaining.
2. `(*TelemetryHandler).ProcessSignals` (renamed in 0060 to
   `processSignalsLegacyDeprecated`) — verify no remaining callers.
   If true, DELETE.
3. `flattenCompoundMapValue` already deleted in 0060.
4. `normalizeFleetUnits` already deleted in 0060.
5. Any remaining `internal/telemetry/*` shims — phase-42 prompt 0080
   tombstoned the package; verify the directory is empty or contains
   only doc.go.

Per covenant rule 11 ("no dead code retention"), this prompt deletes
all four. Per 0000 Decision #6 (locked).

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Per-deletion proof of dead** | Each deletion is preceded by a grep that proves zero callers in non-test code. The grep output goes into `=== AUDIT_EVIDENCE_BEFORE ===`. If any caller is found that wasn't expected, BLOCK and surface — do NOT delete. |
| 2 | **Test deletion pairing** | When deleting a function/struct, ALSO delete its test file (or just the test functions targeting the deleted symbol if the test file covers other living symbols too). |
| 3 | **No tombstone files** | Old phase-42 used tombstone files (`tombstone_internal_telemetry.go` with a build-fail comment). Phase-42a does NOT — the prompt-runner gate already catches accidental resurrection via the prior-log sweep. Tombstones are clutter. |
| 4 | **Single deletion commit** | All deletions in ONE commit. Atomic deletion is easier to revert than scattered. |

## Action Steps

1. `git status` clean.
2. Predecessor 0080 DONE.
3. `=== AUDIT_EVIDENCE_BEFORE ===` capture:
   - `grep -rn 'mqtt\.NewSubscriber\b' --include='*.go' .` MUST return 0 lines outside of `internal/mqtt/subscriber.go` itself and any `_test.go` testing the soon-to-be-deleted constructor.
   - `grep -rn 'processSignalsLegacyDeprecated\|ProcessSignals\b' --include='*.go' internal/api/ cmd/` — list all callers. Acceptable callers are zero. If a session_recovery or backfill path still calls it, surface the dependency and BLOCK.
   - `Get-ChildItem internal/telemetry -Recurse` — list all files. Acceptable: empty directory or just doc.go.
   - `grep -rn 'normalizeFleetUnits\|flattenCompoundMapValue' --include='*.go' .` MUST return 0 lines (verifying 0060 actually deleted them).
4. `=== DELETION_PLAN ===` enumerate each deletion target with file path + line range + reason.
5. Execute deletions. For each:
   - Delete the function/struct.
   - Delete the constructor.
   - Delete the test file or test functions.
   - If a whole file becomes empty, delete the file.
6. `=== AUDIT_EVIDENCE_AFTER ===` re-run the same greps. ALL must return 0 lines for the deleted symbols.
7. Gate:
   - `go build ./...` MUST succeed.
   - `go vet ./...` MUST succeed.
   - `go test -race ./...` MUST pass.
   - `git status --short` allowed only.
8. Commit `chore(phase-42a): delete dead legacy ingest code (NewSubscriber, ProcessSignals legacy)`.
9. `EXIT=0` `STATUS=DONE`.

## Escape hatch

If `ProcessSignals` (or `processSignalsLegacyDeprecated`) STILL has
callers in `session_recovery`, `backfill`, or any other production path
after 0060, BLOCK. Do NOT delete a function with live callers — that's
how phase-42 itself ended up with skeletons. Surface the caller list and
defer the deletion to a follow-up prompt that first migrates each
caller.

If `internal/telemetry/*` still contains code (not just tombstones from
phase-42 prompt 0080), the phase-42 deletion was incomplete. Surface and
defer — phase-42a is not the right scope to clean up phase-42's debt.
