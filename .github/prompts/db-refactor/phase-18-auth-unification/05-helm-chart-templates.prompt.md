---
description: "Phase-18 — Update Helm chart templates: forwardAuthHeader, deprecate Authentik config"
---
# Prompt 05 — Update Helm Chart Templates
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-18-05-helm-chart-templates.log` |
| Allowed files to change | `helm/teslasync/values.yaml`, `helm/teslasync/templates/configmap.yaml`, `helm/teslasync/templates/*.yaml` (IngressRoute templates), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–04

## Problem

The Helm chart still has `authentikURL` and `authentikHMACKey` config values and
templates. These need to be replaced with the new `forwardAuthHeader` config, with
documentation of common provider header values.

## Task

### 1. Survey

Read:
- `helm/teslasync/values.yaml` — find the `authentikURL`, `authentikHMACKey` entries and surrounding config section
- `helm/teslasync/templates/configmap.yaml` — find any `AUTHENTIK_URL`, `AUTHENTIK_HMAC_KEY`, `FORWARD_AUTH_HEADER` entries
- List `helm/teslasync/templates/` to check for IngressRoute or middleware templates

### 2. Add forwardAuthHeader to values.yaml

In `helm/teslasync/values.yaml`, in the config section, add:

```yaml
# Header set by your ForwardAuth provider. Examples:
#   Authentik:     X-Authentik-Username
#   Authelia:      Remote-User
#   oauth2-proxy:  X-Auth-Request-User
#   Keycloak:      X-Forwarded-User
#   Empty:         disables auth (dev mode)
forwardAuthHeader: ""
```

### 3. Deprecate old Authentik config in values.yaml

Mark the old entries as deprecated:

```yaml
# DEPRECATED: Removed in Phase 18 auth unification. Use forwardAuthHeader instead.
# authentikURL: ""
# authentikHMACKey: ""
```

If prompt 03 already did this, verify it's correct and move on.

### 4. Wire into configmap template

In `helm/teslasync/templates/configmap.yaml`, add:

```yaml
FORWARD_AUTH_HEADER: {{ .Values.config.forwardAuthHeader | quote }}
```

Adapt the path (`.Values.config.forwardAuthHeader` or `.Values.forwardAuthHeader`)
to match the actual values.yaml structure.

Remove any remaining `AUTHENTIK_URL` or `AUTHENTIK_HMAC_KEY` entries from the configmap
if prompt 03 didn't already.

### 5. Check IngressRoute templates

If there are Traefik IngressRoute templates that reference Authentik-specific middleware,
note them in the log but do NOT change them — the Traefik-level ForwardAuth middleware
is infrastructure config, not app config.

## Gate

```powershell
cd D:\repos\teslasync

# Helm template should render without errors:
helm template test helm\teslasync\ 2>&1
if ($LASTEXITCODE -ne 0) { Write-Error "FAIL: helm template failed"; exit 1 }

# Verify forwardAuthHeader in values.yaml:
$fah = Select-String -Path helm\teslasync\values.yaml -Pattern 'forwardAuthHeader'
if ($fah.Count -eq 0) { Write-Error "FAIL: forwardAuthHeader not in values.yaml"; exit 1 }

# Verify FORWARD_AUTH_HEADER in configmap:
$cm = Select-String -Path helm\teslasync\templates\configmap.yaml -Pattern 'FORWARD_AUTH_HEADER'
if ($cm.Count -eq 0) { Write-Error "FAIL: FORWARD_AUTH_HEADER not in configmap template"; exit 1 }

# Verify old Authentik env vars removed from configmap:
$oldCm = Select-String -Path helm\teslasync\templates\configmap.yaml -Pattern 'AUTHENTIK_URL:|AUTHENTIK_HMAC_KEY:'
if ($oldCm.Count -gt 0) {
  Write-Error "FAIL: old Authentik env vars still in configmap template:"
  $oldCm | ForEach-Object { Write-Error $_.ToString() }
  exit 1
}
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-18/05-helm-chart-templates: add forwardAuthHeader config, deprecate Authentik values

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-18/05-helm-chart-templates` as the commit message prefix.
