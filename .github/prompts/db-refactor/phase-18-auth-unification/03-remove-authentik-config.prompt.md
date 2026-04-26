---
description: "Phase-18 — Remove Authentik-specific config: AuthentikURL, AuthentikHMACKey"
---
# Prompt 03 — Remove Authentik-Specific Config
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-18-03-remove-authentik-config.log` |
| Allowed files to change | `internal/config/config.go`, `internal/api/authentik_middleware.go`, `helm/teslasync/values.yaml`, `helm/teslasync/templates/configmap.yaml`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–02

## Problem

After prompts 00–02, `AuthentikURL` and `AuthentikHMACKey` are dead config — nothing
references them. The `authentik_middleware.go` file may be empty or nearly empty.
Clean it all up.

## Task

### 1. Survey

Read:
- `internal/config/config.go` — find `AuthentikURL` and `AuthentikHMACKey` fields + env loading
- `internal/api/authentik_middleware.go` — check what functions/code remain after prompt 02
- `helm/teslasync/values.yaml` around lines 545-561 — `authentikURL`, `authentikHMACKey`
- `helm/teslasync/templates/configmap.yaml` — any refs to `AUTHENTIK_URL`, `AUTHENTIK_HMAC_KEY`

### 2. Remove from Go config

In `internal/config/config.go`:
- Remove `AuthentikURL string` field from the config struct
- Remove `AuthentikHMACKey string` field from the config struct
- Remove the corresponding `envStr("AUTHENTIK_URL", ...)` loading line
- Remove the corresponding `envStr("AUTHENTIK_HMAC_KEY", ...)` loading line

### 3. Clean up authentik_middleware.go

If `internal/api/authentik_middleware.go` is now empty (only package declaration,
imports, or dead code after prompt 02 removed `AuthentikSSEAuth` + `SSETokenHandler`):
- **Delete the file entirely**

If it still has live functions (e.g., other middleware not related to SSE token exchange):
- Keep the file, but remove any dead code that referenced `AuthentikURL` or `AuthentikHMACKey`
- Consider moving remaining functions to `forward_auth_middleware.go` if they're auth-related

### 4. Grep for any remaining references

Search `internal/` for any remaining references to `AuthentikURL`, `AuthentikHMACKey`,
`AUTHENTIK_URL`, `AUTHENTIK_HMAC_KEY` and remove/update them.

### 5. Update Helm values (preliminary)

In `helm/teslasync/values.yaml`:
- Mark `authentikURL` and `authentikHMACKey` as deprecated with a comment:
  ```yaml
  # DEPRECATED: Removed in Phase 18 auth unification. Use forwardAuthHeader instead.
  # authentikURL: ""
  # authentikHMACKey: ""
  ```

In `helm/teslasync/templates/configmap.yaml`:
- Remove any `AUTHENTIK_URL` or `AUTHENTIK_HMAC_KEY` entries

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify AuthentikURL/AuthentikHMACKey gone from config:
$authentikCfg = Select-String -Path internal\config\config.go -Pattern 'AuthentikURL|AuthentikHMACKey'
if ($authentikCfg.Count -gt 0) { Write-Error "FAIL: Authentik config still in config.go"; exit 1 }

# Verify no remaining Go references:
$authentikRefs = Get-ChildItem -Recurse internal\*.go | Select-String 'AuthentikURL|AuthentikHMACKey|AUTHENTIK_URL|AUTHENTIK_HMAC_KEY'
if ($authentikRefs.Count -gt 0) {
  Write-Error "FAIL: Authentik references still exist in internal/:"
  $authentikRefs | ForEach-Object { Write-Error $_.ToString() }
  exit 1
}

# Verify authentik_middleware.go is either deleted or has no dead Authentik code:
if (Test-Path internal\api\authentik_middleware.go) {
  $deadCode = Select-String -Path internal\api\authentik_middleware.go -Pattern 'AuthentikURL|AuthentikHMACKey|AuthentikSSEAuth|SSETokenHandler'
  if ($deadCode.Count -gt 0) { Write-Error "FAIL: dead Authentik code remains in authentik_middleware.go"; exit 1 }
}
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-18/03-remove-authentik-config: remove AuthentikURL/AuthentikHMACKey config and clean up middleware

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-18/03-remove-authentik-config` as the commit message prefix.
