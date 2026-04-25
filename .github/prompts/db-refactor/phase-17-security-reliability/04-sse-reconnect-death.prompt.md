---
description: "Phase-17 — SSE stops reconnecting after 5 failures: capped backoff, remove terminal state"
---
# Prompt 04 — SSE Stops Reconnecting After 5 Failures (HIGH)
> **Severity:** High | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-17-04-sse-reconnect-death.log` |
| Allowed files to change | `web/src/lib/sseManager.ts`, `web/src/lib/automationSSE.ts`, `web/src/hooks/useRealtimeEvents.ts`, `web/src/hooks/useAutomationEvents.ts`, `web/src/components/layout/Layout.tsx`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

**File:** `web/src/lib/sseManager.ts:90-93`

After 5 connection failures, the SSE manager sets `state = 'unavailable'` and stops
reconnecting. A transient network outage permanently kills live updates until the user
manually refreshes the page.

## Task

### 1. Survey

Read `web/src/lib/sseManager.ts` around lines 85-100. Find:
- The `failCount >= 5` check
- The `state = 'unavailable'` assignment
- Any backoff logic

Also read `web/src/lib/automationSSE.ts` for similar patterns.

### 2. sseManager.ts — Replace terminal state with capped backoff

Remove the `unavailable` terminal state entirely. Replace with:

```typescript
// Capped exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s → 60s (max)
const BASE_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60000

// On connection failure:
failCount++
const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, failCount - 1), MAX_BACKOFF_MS)
state = 'reconnecting'
setTimeout(() => reconnect(), backoff)

// On successful connection:
failCount = 0
state = 'connected'
```

Key requirements:
- **Remove** any `state = 'unavailable'` assignments
- **Remove** the `if (failCount >= 5) { ... return }` early exit
- **Remove** the `'unavailable'` value from any state type definitions
- **Keep trying forever** with capped backoff (max 60s between retries)
- **Reset** `failCount` to 0 on successful connection
- State goes: `connected` → `reconnecting` (on failure) → `connected` (on success)

### 3. automationSSE.ts — Apply same fix

If `web/src/lib/automationSSE.ts` has the same `unavailable` terminal state pattern,
apply the identical fix.

### 4. Update consumers of 'unavailable' state

The following files likely reference the `'unavailable'` state value and will break if
it's removed from the type definition. Update them:

- `web/src/hooks/useRealtimeEvents.ts` — replace `=== 'unavailable'` checks with
  `'reconnecting'` or remove the branch entirely (keep fallback-to-polling behavior
  if it exists — just remove the "give up" terminal behavior)
- `web/src/hooks/useAutomationEvents.ts` — same pattern
- `web/src/components/layout/Layout.tsx` — may show a "disconnected" banner on
  `unavailable` state. Change to show a "reconnecting..." indicator on `'reconnecting'`
  state instead

Search `web/src/` broadly for any other `'unavailable'` references and fix them too.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit

# Verify 'unavailable' state is gone from ALL frontend files:
$unavailable = Get-ChildItem -Recurse src\*.ts,src\*.tsx | Select-String 'unavailable'
if ($unavailable.Count -gt 0) {
  Write-Error "FAIL: 'unavailable' still referenced in frontend:"
  $unavailable | ForEach-Object { Write-Error $_.ToString() }
  exit 1
}

# Verify backoff logic exists:
$backoff = Select-String -Path src\lib\sseManager.ts -Pattern 'MAX_BACKOFF|Math\.min.*Math\.pow|backoff'
if ($backoff.Count -eq 0) { Write-Error "FAIL: backoff logic not found"; exit 1 }
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-17/04-sse-reconnect-death: replace terminal unavailable state with capped exponential backoff

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-17/04-sse-reconnect-death` as the commit message prefix.
