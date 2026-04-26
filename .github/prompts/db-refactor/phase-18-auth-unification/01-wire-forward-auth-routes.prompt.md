---
description: "Phase-18 — Wire ForwardAuthMiddleware to all /api/v1/* routes"
---
# Prompt 01 — Wire ForwardAuthMiddleware to All /api/v1/* Routes
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-18-01-wire-forward-auth-routes.log` |
| Allowed files to change | `internal/api/router.go`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00

## Problem

The ForwardAuthMiddleware from prompt 00 exists but isn't wired to any routes yet.
All `/api/v1/*` routes need to be protected by it. Health/ready probes must remain
unprotected (they're already outside the `/api/v1` group).

## Task

### 1. Survey

Read `internal/api/router.go` to find:
- The `/api/v1` route group definition
- How the config is accessed (the variable name for the config struct)
- Where `ForwardAuthHeader` lives in the config hierarchy
- Health/ready probe routes (`/healthz`, `/readyz`) — confirm they're outside `/api/v1`
- The existing `APIKeyMiddleware` on watch routes

### 2. Add ForwardAuthMiddleware to /api/v1 route group

At the top of the `/api/v1` route group, add:

```go
r.Use(ForwardAuthMiddleware(cfg.Auth.ForwardAuthHeader))
```

Adapt the config path to match the actual struct layout (e.g., `cfg.ForwardAuthHeader`,
`cfg.Auth.ForwardAuthHeader`, etc.).

Key requirements:
- This protects ALL routes under `/api/v1/*` including SSE endpoints
- `/healthz`, `/readyz` stay unprotected (they should already be outside the group)
- `APIKeyMiddleware` on watch routes stays as-is — it's a separate auth zone
- Do NOT remove any existing middleware — just add ForwardAuthMiddleware

### 3. Verify no double-auth

Make sure the ForwardAuthMiddleware is only applied ONCE at the group level, not
also on individual routes.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify ForwardAuthMiddleware is wired in router:
$wired = Select-String -Path internal\api\router.go -Pattern 'ForwardAuthMiddleware'
if ($wired.Count -eq 0) { Write-Error "FAIL: ForwardAuthMiddleware not wired in router.go"; exit 1 }

# Verify health probes are NOT inside /api/v1 (no ForwardAuth on them):
$healthInApi = Select-String -Path internal\api\router.go -Pattern '/api/v1.*health|/api/v1.*ready'
if ($healthInApi.Count -gt 0) { Write-Error "FAIL: health probes appear to be inside /api/v1"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-18/01-wire-forward-auth-routes: apply ForwardAuthMiddleware to all /api/v1 routes

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-18/01-wire-forward-auth-routes` as the commit message prefix.
