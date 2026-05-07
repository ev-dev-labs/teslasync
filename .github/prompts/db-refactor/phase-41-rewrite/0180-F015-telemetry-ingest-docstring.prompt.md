---
description: "Phase 41-rewrite F015 - telemetry_handler_ingest docstring (auto-CLOSED if legacy ingest deleted)"
---

# Prompt 0180 — F015: Telemetry ingest docstring lie

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F015 (MED, ingest-correctness)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0180-F015-telemetry-ingest-docstring.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/telemetry_handler_ingest.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F015)

`internal/api/telemetry_handler_ingest.go:88-91` and L694 — the function
docstring reads "Normalize fleet telemetry units to metric. Tesla wire
format is mph/kWh/Fahrenheit; we convert to mps/Wh/Celsius before
persisting." The function actually only parses enum strings to
canonical tokens; it does NO unit conversion. A future reader assumes
conversion is happening here when it is not.

## Auto-close clause (PREFLIGHT)

If `internal/api/telemetry_handler_ingest.go` no longer exists OR the
cited function/docstring at L88-91 / L694 has already been removed by
phase-42a/0090 (legacy-deletion), then this prompt SHORT-CIRCUITS:
- `=== PREFLIGHT ===` records the evidence.
- Status = `CLOSED-BY-PHASE-42A-0090`.
- Write `EXIT=0` + `STATUS=DONE`.

## Invariant (if NOT auto-closed)

Function docstrings MUST accurately describe what the function does.
Misleading docstrings cause silent assumption errors in code review
and future modifications.

## Locked Implementation Decisions (if NOT auto-closed)

| # | Decision | Choice |
|---|---|---|
| 1 | Approach | Rewrite the docstring to describe what the function ACTUALLY does ("parses enum string values to canonical tokens"). Do NOT add unit conversion to this function — that responsibility lives in `internal/tesla/normalize/Pipeline` per ADR-004. |
| 2 | Cross-reference | Add a comment line pointing to `internal/tesla/normalize/Pipeline` as the actual unit-conversion location, so future readers find the right code. |
| 3 | NO behaviour change | The function's runtime behaviour is unchanged. This is a docstring-only edit. |
| 4 | Gate | `go build ./internal/api/...` + `go vet ./internal/api/...`. Anchored grep: `grep -n 'Normalize fleet telemetry units to metric' internal/api/telemetry_handler_ingest.go` returns 0. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. AUTO-CLOSE check — if conditions met, log + commit + DONE.
3. Otherwise: `=== AUDIT_EVIDENCE ===` dump L88-91 + L694 BEFORE.
4. `=== IMPLEMENTATION ===` — rewrite docstring; add cross-reference comment.
5. `=== GATE ===` — build / vet / anchored grep.
6. `=== COMMIT ===` commit accordingly.
