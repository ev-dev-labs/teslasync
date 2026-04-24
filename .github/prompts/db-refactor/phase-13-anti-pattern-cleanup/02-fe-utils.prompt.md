---
description: "Phase-13 — Deduplicate frontend utility functions"
---
# Prompt 02 — Deduplicate Utility Functions (toLocalDatetime, formatValue, batteryColor)
> **Severity:** HIGH | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-02-fe-utils.log` |
| Allowed files to change | `web/src/lib/dateFormat.ts`, `web/src/lib/colors.ts`, page files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Duplicates to eliminate

| Function | Canonical Location | Duplicate In | Action |
|----------|-------------------|-------------|--------|
| `toLocalDatetime()` / `toLocalDatetimeStr()` | `SignalQueryControls.tsx:37` (exported) | `SignalLogViewerPage.tsx:53` (local), `SignalExplorerPage.tsx:70` (local) | Move to `@/lib/dateFormat.ts`, delete locals, import |
| `formatValue()` | `SignalQueryControls.tsx:57` (exported) | `SignalLogViewerPage.tsx:58` (local) | Delete local, import from SignalQueryControls |
| `batteryColor()` | `vehicle-detail/helpers.ts` (exported) | `VehicleListPage.tsx:28-32` (local) | Delete local, import from helpers |
| `activityColor()` | `@/lib/colors.ts:92` (exported) | `PollingEngine.tsx:14-23` (local) | Delete local, import from colors.ts |
| `profileLabel()` | Not centralized | `PollingEngine.tsx:36-44` (local) | Move to `@/lib/enums.ts` or keep local (only 1 usage) |
| `formatDuration()` | `@/lib/dateFormat.ts` may exist | `PollingEngine.tsx:46-54` (local) | Check if `durationStr()` in helpers.ts covers it, merge or import |

## Task

### 1. Survey each duplicate

For each row above:
1. Confirm the canonical location exists and is exported
2. Confirm the duplicate is functionally identical (not a different variant)
3. If the canonical doesn't exist yet, move the best implementation to the shared location

### 2. Delete locals, add imports

For each file with a local duplicate:
- Delete the local `function` declaration
- Add the import from the canonical location
- Update any callers within that file

### Important constraints

- **Test behavior equivalence** — if a local function has slightly different behavior (e.g., different date format), keep the richer version and update the canonical
- `batteryColor` in `VehicleListPage` uses different thresholds (>60, >30) than helpers.ts (>60, >25) — use the helpers.ts version (>60, >25) everywhere
- Do NOT create new files unless absolutely necessary — prefer extending existing `@/lib/` files

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
# Verify no local duplicates remain
grep -rn "function toLocalDatetime\b\|function formatValue\b\|function batteryColor\b\|function activityColor\b" --include="*.tsx" src/features/ src/components/ | grep -v "export function"
# Should return 0 matches (all locals deleted)
```

Log result. STATUS=DONE only if tsc passes AND zero local duplicates in features/components.
