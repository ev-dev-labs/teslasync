---
description: "Phase 41-rewrite F007 - add timeouts to cmd/* healthcheck http.Get calls"
---

# Prompt 0120 — F007: Healthcheck timeout

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F007 (MED, timeout-safety)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0120-F007-healthcheck-timeout.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `cmd/teslasync/main.go`, `cmd/automation-worker/main.go`, `cmd/notification-worker/main.go`, `cmd/export-worker/main.go`, the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F007)

All four cmd healthcheck blocks use `http.Get(url)` with no Client
timeout. If `/healthz` hangs, the healthcheck process hangs forever
(the kubelet then kills the pod via liveness probe timeout, but only
after the pod has accumulated leaked sockets). Cited:
- `cmd/teslasync/main.go:39-45`
- `cmd/automation-worker/main.go:33-36`
- `cmd/notification-worker/main.go:30-33`
- `cmd/export-worker/main.go:28-30`

## Invariant

Every external HTTP call (including healthchecks) MUST have an explicit
timeout per ADR-003 #2. Default for healthchecks is 5 seconds (matches
the Mosquitto reconnect default; well below typical kubelet probe
timeout of 30s).

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Pattern | Replace `http.Get(url)` with `(&http.Client{Timeout: 5*time.Second}).Get(url)`. Trivial; same fix in all 4 files. |
| 2 | Coupling with F008 | Both findings touch the same line ranges in the same 4 files. THIS PROMPT does the timeout fix; F008 (next prompt) adds the deferred Body.Close. They are sequenced because F008 depends on the resp variable from this prompt being non-nil after a successful Get. |
| 3 | Tests | Healthchecks are typically not unit-tested in this codebase. No new test required UNLESS sibling tests already exist; if so, extend them to assert the timeout. |
| 4 | Build/test gate | `go build ./cmd/...` + `go vet ./cmd/...`. Anchored grep: `grep -nE 'http\.Get\(' cmd/*/main.go` returns ZERO matches at the cited lines. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===` — dump each cited line range BEFORE.
3. `=== IMPLEMENTATION ===` — replace all 4 occurrences. Add `import "time"` if missing.
4. `=== GATE ===`:
   - `grep -n 'http.Get(' cmd/*/main.go` returns 0.
   - `go build ./cmd/...`.
   - `go vet ./cmd/...`.
5. `=== COMMIT ===` commit `fix(cmd): F007 — add 5s timeout to healthcheck http.Get`.
