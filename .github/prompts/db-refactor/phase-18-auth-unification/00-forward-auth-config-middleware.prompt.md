---
description: "Phase-18 — Add FORWARD_AUTH_HEADER config + ForwardAuthMiddleware"
---
# Prompt 00 — Add FORWARD_AUTH_HEADER Config + ForwardAuthMiddleware
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-18-00-forward-auth-config-middleware.log` |
| Allowed files to change | `internal/config/config.go`, `internal/api/forward_auth_middleware.go` (CREATE), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

The app is vendor-locked to Authentik for auth. We need a provider-agnostic ForwardAuth
header check that works with any reverse proxy auth provider (Authentik, Authelia,
oauth2-proxy, Keycloak, etc.). This prompt adds the config and middleware foundation.

## Task

### 1. Survey

Read `internal/config/config.go` around lines 156-157 and 232-233 to find:
- The existing `AuthentikURL` and `AuthentikHMACKey` config fields
- The pattern used for env var loading (`envStr()` or similar)
- The config struct layout (Auth section or flat)

Read `internal/api/` directory listing to understand existing middleware files.

### 2. Add FORWARD_AUTH_HEADER to config

In `internal/config/config.go`:
- Add `ForwardAuthHeader string` to the appropriate config struct (same section as `AuthentikURL`)
- Load it with: `ForwardAuthHeader: envStr("FORWARD_AUTH_HEADER", "")` (or matching pattern)
- Keep old `AuthentikURL` and `AuthentikHMACKey` for now — they are removed in prompt 03

### 3. Create ForwardAuthMiddleware

Create `internal/api/forward_auth_middleware.go`:

```go
package api

import "net/http"

// ForwardAuthMiddleware checks for the presence of a header set by the
// reverse proxy's ForwardAuth provider (Authentik, Authelia, oauth2-proxy,
// Keycloak, etc.). If headerName is empty, returns a no-op passthrough
// (dev mode / no auth configured).
func ForwardAuthMiddleware(headerName string) func(http.Handler) http.Handler {
    if headerName == "" {
        return func(next http.Handler) http.Handler { return next }
    }
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if r.Header.Get(headerName) == "" {
                writeError(w, http.StatusUnauthorized, "unauthorized: missing auth header")
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

Adapt to match existing code style:
- Use the same `writeError` or JSON error helper used by other middleware in the package
- Match import style, package conventions, etc.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify ForwardAuthMiddleware exists:
$fam = Select-String -Path internal\api\forward_auth_middleware.go -Pattern 'func ForwardAuthMiddleware'
if ($fam.Count -eq 0) { Write-Error "FAIL: ForwardAuthMiddleware not found"; exit 1 }

# Verify config field exists:
$cfg = Select-String -Path internal\config\config.go -Pattern 'ForwardAuthHeader'
if ($cfg.Count -eq 0) { Write-Error "FAIL: ForwardAuthHeader not in config"; exit 1 }

# Verify env var loading:
$env = Select-String -Path internal\config\config.go -Pattern 'FORWARD_AUTH_HEADER'
if ($env.Count -eq 0) { Write-Error "FAIL: FORWARD_AUTH_HEADER env not loaded"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-18/00-forward-auth-config-middleware: add FORWARD_AUTH_HEADER config and ForwardAuthMiddleware

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-18/00-forward-auth-config-middleware` as the commit message prefix.
