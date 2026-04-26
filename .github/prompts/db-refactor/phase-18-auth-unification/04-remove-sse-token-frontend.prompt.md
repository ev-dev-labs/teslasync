---
description: "Phase-18 — Remove SSE token exchange from frontend: fetchSSEToken, ?token="
---
# Prompt 04 — Remove SSE Token Exchange (Frontend)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-18-04-remove-sse-token-frontend.log` |
| Allowed files to change | `web/src/lib/sseManager.ts`, `web/src/lib/automationSSE.ts`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompts 00–03

## Problem

The frontend still calls `fetchSSEToken()` to get a JWT token and appends `?token=...`
to the SSE EventSource URL. With ForwardAuthMiddleware in place, the browser's auth
cookie (same domain, set by the ForwardAuth provider) is sent automatically. The token
exchange is dead code.

## Task

### 1. Survey

Read:
- `web/src/lib/sseManager.ts` lines 29-56 — find `fetchSSEToken()` and the EventSource URL construction with `?token=`
- `web/src/lib/automationSSE.ts` lines 57-83 — same pattern

### 2. Clean up sseManager.ts

In `web/src/lib/sseManager.ts`:
1. **Delete** the `fetchSSEToken()` function entirely (lines ~29-42)
2. **Simplify** the EventSource URL construction:
   - Remove any `token ? \`/api/v1/events?token=${token}\` : '/api/v1/events'` conditional
   - Replace with just: `'/api/v1/events'`
3. **Remove** any `token` variable declarations, `await fetchSSEToken()` calls, and related error handling
4. The browser sends the auth cookie automatically — no token parameter needed

### 3. Clean up automationSSE.ts

In `web/src/lib/automationSSE.ts`:
1. Same changes: delete `fetchSSEToken()`, simplify EventSource URL
2. Remove any `?token=` references
3. Replace with plain URL: `'/api/v1/automation/events'` (or whatever the automation SSE path is)

### 4. Search for any other references

Search `web/src/` broadly for:
- `fetchSSEToken` — should have 0 references
- `sse-token` — should have 0 references
- `token=` in SSE context — should have 0 references

Fix any other files that reference these patterns.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit

# Verify all SSE token exchange code is gone:
$tokenRefs = Select-String -Path src\lib\sseManager.ts,src\lib\automationSSE.ts -Pattern 'fetchSSEToken|sse-token|token='
if ($tokenRefs.Count -gt 0) {
  Write-Error "FAIL: SSE token references still exist:"
  $tokenRefs | ForEach-Object { Write-Error $_.ToString() }
  exit 1
}

# Broader search across all frontend:
$broadRefs = Get-ChildItem -Recurse src\*.ts,src\*.tsx | Select-String 'fetchSSEToken'
if ($broadRefs.Count -gt 0) {
  Write-Error "FAIL: fetchSSEToken still referenced in frontend:"
  $broadRefs | ForEach-Object { Write-Error $_.ToString() }
  exit 1
}
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-18/04-remove-sse-token-frontend: remove fetchSSEToken and ?token= from SSE connections

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-18/04-remove-sse-token-frontend` as the commit message prefix.
