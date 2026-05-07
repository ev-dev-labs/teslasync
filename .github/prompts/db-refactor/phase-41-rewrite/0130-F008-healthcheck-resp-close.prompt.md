---
description: "Phase 41-rewrite F008 - defer Body.Close on cmd/* healthcheck responses"
---

# Prompt 0130 — F008: Healthcheck response Body.Close

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F008 (MED, resource-leak)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0130-F008-healthcheck-resp-close.log` |
| Depends on | `phase-41-rewrite-0120-F007-healthcheck-timeout.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `cmd/teslasync/main.go`, `cmd/automation-worker/main.go`, `cmd/notification-worker/main.go`, `cmd/export-worker/main.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F008)

The four healthcheck blocks call `http.Get` and do NOT defer
`resp.Body.Close()`. Each invocation leaks a socket. Over thousands of
healthchecks per pod-lifetime this is a real connection-pool leak.
Cited:
- `cmd/teslasync/main.go:44-48`
- `cmd/automation-worker/main.go:35-39`
- `cmd/notification-worker/main.go:31-35`
- `cmd/export-worker/main.go:29-33`

## Invariant

`resp.Body.Close()` MUST be deferred IMMEDIATELY after the nil/error
check on every successful `(*http.Client).Get` / `Do` call per
ADR-003 #4.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Pattern | After `resp, err := client.Get(...)` and the `if err != nil { ... }` check, add `defer resp.Body.Close()` BEFORE any read of resp.StatusCode or resp.Body. |
| 2 | Sequence | This prompt MUST run AFTER F007 (timeout fix). F007 changes the call shape from `http.Get(url)` to `(&http.Client{...}).Get(url)`. The defer is added to the post-error-check shape. |
| 3 | Build/test gate | `go build ./cmd/...` + `go vet ./cmd/...`. Anchored grep: `grep -A2 -nE 'client\.Get\(' cmd/*/main.go \| grep -c 'defer resp\.Body\.Close()'` >= 4 (one per file). |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===` — dump each cited line range AFTER F007 (so the lines reflect the timeout-fixed shape).
3. `=== IMPLEMENTATION ===` — add `defer resp.Body.Close()` immediately after the err check in each of the 4 files.
4. `=== GATE ===`:
   - `grep -c 'defer resp.Body.Close' cmd/*/main.go` returns >= 4.
   - `go build ./cmd/...`.
   - `go vet ./cmd/...`.
5. `=== COMMIT ===` commit `fix(cmd): F008 — defer resp.Body.Close on healthcheck calls`.
