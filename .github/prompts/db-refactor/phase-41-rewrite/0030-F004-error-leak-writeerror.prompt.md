---
description: "Phase 41-rewrite F004 - stop leaking err.Error() into HTTP response bodies"
---

# Prompt 0030 — F004: Error-leak via writeError

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F004 (HIGH, auth-security)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0030-F004-error-leak-writeerror.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/signal_handler.go`, `internal/api/devtools_handler.go`, `internal/api/devtools_handler_database.go`, sibling tests, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F004)

Multiple handlers pass raw `err.Error()` text into the response body
via `writeError(w, status, err.Error())`. This leaks query text,
schema details, and middleware internals to clients. Cited locations:
- `internal/api/signal_handler.go:145-148`
- `internal/api/devtools_handler_database.go:27-31, 44-52, 57-59`
- `internal/api/devtools_handler.go:100-103`

## Invariant

HTTP error responses must NOT contain raw `err.Error()` text from
internal layers. Generic public message + structured server-side
log via `log.Error().Err(err).Str("op",...).Msg("...")`.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Pattern | Replace `writeError(w, 5xx, err.Error())` with `writeError(w, 5xx, "internal error")` (or a domain-specific phrase like "signal lookup failed"). Log the full error server-side via zerolog. |
| 2 | 4xx handling | 400/404 errors MAY include a sanitized client message (e.g., "vehicle not found") but MUST NOT include `err.Error()` from the underlying repo/driver. |
| 3 | Audit scope | Walk EVERY `writeError` call in `internal/api/*.go`. The cited 3 files are the known offenders; if grep finds more, fix them in the same commit (additive — not retroactive scope expansion, this is "audit ALL writeError" per the original finding). |
| 4 | Tests | Add table-driven test cases that assert: response body contains the generic message AND does NOT contain the raw error string. |
| 5 | Build/test gate | `go build ./internal/api/...` + `go test -count=1 ./internal/api/...` + `grep -nE 'writeError\([^)]*err\.Error\(\)\)' internal/api/` returns ZERO matches. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Dump each cited line range BEFORE.
   - Run `grep -rn 'writeError([^)]*err\.Error()' internal/api/` and capture the full violation list. Cite count.
3. `=== IMPLEMENTATION ===`:
   - For each violation: replace with generic message + structured log.
   - Update or add tests asserting no leak.
4. `=== GATE ===`:
   - Re-run the grep — must be ZERO.
   - `go build ./internal/api/...`
   - `go vet ./internal/api/...`
   - `go test -count=1 ./internal/api/...`
5. `=== COMMIT ===` commit `fix(api): F004 — stop leaking err.Error() into HTTP response bodies`.
