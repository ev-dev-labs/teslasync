---
description: "Phase 41-rewrite F006 - SSE/eventHub goroutine context leak"
---

# Prompt 0110 — F006: SSE eventHub context leak

> **Severity:** Gate | **Atomic:** yes | **Delegation:** FORBIDDEN | **Finding:** F006 (MED, concurrency)

## Artifact Metadata

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-41-rewrite-0110-F006-sse-context-leak.log` |
| Depends on | `phase-41-rewrite-0000-preflight-and-baseline.log` (EXIT=0/STATUS=DONE) |
| Allowed files to change | `internal/api/router.go`, `internal/api/sse_handler.go`, `internal/api/sse_handler_test.go`, `cmd/teslasync/main.go` (signature wiring only — minimal), the output log |

## Honesty Covenant

<!-- BEGIN COVENANT --> 1-12 per phase-42a baseline. <!-- END COVENANT -->

## Logging Requirements

`=== PREFLIGHT ===`, `=== AUDIT_EVIDENCE ===`, `=== IMPLEMENTATION ===`, `=== GATE ===`, `=== COMMIT ===`.

## Problem (verbatim from `findings` table, F006)

`eventHub.SubscribeRedis` is invoked with `context.Background()` at
router construction time (`internal/api/router.go:407-410`). The
subscribe loop in `internal/api/sse_handler.go:141-165` therefore
never sees `ctx.Done()` from a SIGTERM and leaks past process
shutdown — the goroutine survives until the process is force-killed.

## Invariant

Long-lived goroutines started during router construction MUST consume
a server-lifetime context that cancels on SIGTERM. The subscribe loop
MUST `select` on `ctx.Done()` and unsubscribe + return on cancellation.

## Locked Implementation Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Plumbing | Pass a server-lifetime `ctx` (the one cmd/teslasync/main.go cancels on SIGTERM) into the router constructor signature. The minimal touch in cmd/teslasync/main.go is one new arg passed at the existing call site — no new top-level wiring. |
| 2 | sse_handler.go | The Redis subscribe loop adds a `select { case <-ctx.Done(): unsubscribe; return ... }` arm. Existing message-receive arm unchanged. |
| 3 | Test | Add a goroutine-leak test using `uber-go/goleak`. Construct the router with a cancelable ctx, cancel it, assert no goroutines survive after a small grace period. |
| 4 | go.mod | Add `go.uber.org/goleak` as a TEST dependency only (`require ... // indirect` is fine). If already vendored, no go.mod change. |
| 5 | Build/test gate | `go build ./...` + `go test -count=1 ./internal/api/...` + the goroutine-leak test passes. |

## Action Steps

1. `git status` clean. `=== PREFLIGHT ===`.
2. `=== AUDIT_EVIDENCE ===`:
   - Dump router.go L407-410 BEFORE — show `context.Background()` usage.
   - Dump sse_handler.go L141-165 BEFORE — show the loop without ctx.Done().
   - `grep -n 'go.uber.org/goleak' go.mod` — note presence.
3. `=== IMPLEMENTATION ===`:
   - Add ctx param to router constructor signature.
   - Update cmd/teslasync/main.go call site (single line edit).
   - Refactor sse_handler.go subscribe loop with select/ctx.Done.
   - Author goroutine-leak test.
4. `=== GATE ===`:
   - `go build ./...`
   - `go vet ./...`
   - `go test -count=1 ./internal/api/...`
   - Anchored grep: `grep -n 'context.Background()' internal/api/router.go` — must NOT appear at the cited line range.
5. `=== COMMIT ===` commit `fix(api): F006 — propagate server-lifetime ctx into eventHub.SubscribeRedis`.
