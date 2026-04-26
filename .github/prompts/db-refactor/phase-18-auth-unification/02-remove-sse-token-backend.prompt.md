---
description: "Phase-18 — Remove SSE token exchange from backend: AuthentikSSEAuth, SSETokenHandler"
---
# Prompt 02 — Remove SSE Token Exchange (Backend)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-18-02-remove-sse-token-backend.log` |
| Allowed files to change | `internal/api/router.go`, `internal/api/authentik_middleware.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–01

## Problem

The SSE endpoints use Authentik-specific JWT token exchange (`AuthentikSSEAuth()`,
`SSETokenHandler()`). Now that ForwardAuthMiddleware protects all `/api/v1/*` routes,
the SSE-specific token exchange is redundant and vendor-locked.

## Task

### 1. Survey

Read these files:
- `internal/api/router.go` around lines 536 and 816-834 — the SSE route wiring with `AuthentikSSEAuth`
- `internal/api/authentik_middleware.go` around lines 221-310 — `AuthentikSSEAuth()` and `SSETokenHandler()`

### 2. Simplify SSE routes in router.go

In `router.go` around lines 816-834, replace the if/else Authentik check with:

```go
r.Get("/events", SSEHandler(eventHub))
r.Get("/sse-token", func(w http.ResponseWriter, r *http.Request) {
    writeJSON(w, http.StatusOK, map[string]string{"token": ""})
})
```

SSE is now protected by ForwardAuthMiddleware (from prompt 01).
Keep `/sse-token` returning an empty token for backward compat with the frontend
(the frontend still calls `fetchSSEToken()` until prompt 04 removes it).

Adapt `writeJSON` to match the actual helper function name in the codebase.

### 3. Simplify automation SSE route

In `router.go` around line 536, remove the `AuthentikSSEAuth` wrapper from the
automation SSE endpoint. The route is already protected by ForwardAuthMiddleware.

### 4. Remove AuthentikSSEAuth and SSETokenHandler

In `internal/api/authentik_middleware.go`:
- Delete the `AuthentikSSEAuth()` function (lines ~221-270)
- Delete the `SSETokenHandler()` function (lines ~271-310)
- Remove any imports that are now unused
- If other functions remain in the file, keep the file. If it's now empty (just package declaration + unused imports), leave it for prompt 03 to clean up.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify AuthentikSSEAuth is gone from router.go:
$sseAuth = Select-String -Path internal\api\router.go -Pattern 'AuthentikSSEAuth'
if ($sseAuth.Count -gt 0) { Write-Error "FAIL: AuthentikSSEAuth still in router.go"; exit 1 }

# Verify SSETokenHandler is gone from authentik_middleware.go (if file still exists):
if (Test-Path internal\api\authentik_middleware.go) {
  $tokenHandler = Select-String -Path internal\api\authentik_middleware.go -Pattern 'func SSETokenHandler|func AuthentikSSEAuth'
  if ($tokenHandler.Count -gt 0) { Write-Error "FAIL: AuthentikSSEAuth/SSETokenHandler still in authentik_middleware.go"; exit 1 }
}

# Verify /sse-token endpoint still exists (backward compat stub):
$sseTokenRoute = Select-String -Path internal\api\router.go -Pattern 'sse-token'
if ($sseTokenRoute.Count -eq 0) { Write-Error "FAIL: /sse-token backward compat route missing"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-18/02-remove-sse-token-backend: remove AuthentikSSEAuth and SSETokenHandler, simplify SSE routes

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-18/02-remove-sse-token-backend` as the commit message prefix.
