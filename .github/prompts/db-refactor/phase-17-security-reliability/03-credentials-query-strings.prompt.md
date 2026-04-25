---
description: "Phase-17 — Credentials in query strings: remove ?key= fallback, document SSE limitation"
---
# Prompt 03 — Credentials in Query Strings (HIGH)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-03-credentials-query-strings.log` |
| Allowed files to change | `internal/api/apikey_middleware.go`, `web/src/lib/sseManager.ts`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

**Files:**
- `internal/api/apikey_middleware.go:55` — API keys accepted via `?key=` query param
- `web/src/lib/sseManager.ts:56` — SSE tokens via `?token=`

API keys in query strings leak in server logs, browser history, and referrer headers.

## Task

### 1. apikey_middleware.go — Remove `?key=` fallback

Survey `internal/api/apikey_middleware.go` around line 55. Find the `r.URL.Query().Get("key")`
fallback. Remove it entirely. Keys must come via:
- `Authorization: Bearer <key>` header, OR
- `X-API-Key: <key>` header

**Do NOT** remove the `Authorization` or `X-API-Key` header extraction — only the query
string fallback.

### 2. sseManager.ts — Document the EventSource limitation

The SSE `?token=` query param **must stay** because the browser's `EventSource` API does
not support custom headers. This is a well-known limitation.

Add a block comment above the `?token=` usage in `web/src/lib/sseManager.ts`:

```typescript
// SECURITY NOTE: Token is passed via query string because the browser EventSource API
// does not support custom headers. This is a known limitation of SSE.
// Mitigations:
// - Tokens are short-lived (scoped to SSE session)
// - Server logs should be configured to redact query parameters
// - Consider migrating to WebSocket (which supports headers) if this becomes a concern
```

### 3. Check automationSSE.ts

Survey `web/src/lib/automationSSE.ts` for similar `?token=` usage. If present, add the
same documentation comment. Do NOT change the behavior.

## Gate

```powershell
cd D:\repos\teslasync
$env:CGO_ENABLED = "0"
go build ./...
go vet ./...

# Verify query param key extraction is gone:
$keyParam = Select-String -Path internal\api\apikey_middleware.go -Pattern 'Query\(\)\.Get\("key"\)'
if ($keyParam.Count -gt 0) { Write-Error "FAIL: ?key= query param fallback still exists"; exit 1 }

# Verify header extraction still works:
$headerAuth = Select-String -Path internal\api\apikey_middleware.go -Pattern 'Authorization|X-API-Key'
if ($headerAuth.Count -eq 0) { Write-Error "FAIL: header auth extraction missing"; exit 1 }

# Verify SSE security comment was added:
cd D:\repos\teslasync\web
npx tsc --noEmit
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/03-credentials-query-strings: remove ?key= query param fallback, document SSE token limitation

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/03-credentials-query-strings` as the commit message prefix.
