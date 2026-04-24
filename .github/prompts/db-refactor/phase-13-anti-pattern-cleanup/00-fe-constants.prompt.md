---
description: "Phase-13 — Centralize frontend domain constants"
---
# Prompt 00 — Centralize Domain Constants (DAYS, MONTHS, TIMEZONES, OPERATORS, PRESETS)
> **Severity:** HIGH | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-00-fe-constants.log` |
| Allowed files to change | `web/src/lib/constants.ts` (CREATE or EXTEND), files listed in Duplicates table below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Duplicates to eliminate

| Constant | Currently In | Also In | Target |
|----------|-------------|---------|--------|
| `DAYS` / `DAY_LABELS` | `ConditionBuilder.tsx:68` | `ChargingHeatmapPage.tsx:19` | `@/lib/constants.ts` |
| `MONTHS` | `ConditionBuilder.tsx:53-66` | — | `@/lib/constants.ts` |
| `COMMON_TIMEZONES` | `ConditionBuilder.tsx:70-80` | — | `@/lib/constants.ts` |
| `NUMERIC_OPERATORS` | `ConditionBuilder.tsx:38-45` | — | `@/lib/constants.ts` |
| `BOOL_OPERATORS` | `ConditionBuilder.tsx:47-50` | — | `@/lib/constants.ts` |
| `PRESETS` (time ranges) | `SignalLogViewerPage.tsx:74-80` | `SignalExplorerPage.tsx:75-80` | `@/lib/constants.ts` (or import from `SignalQueryControls.tsx` which already exports `TIME_PRESETS`) |
| `DAYS_OPTIONS` | `SleepEfficiencyPage.tsx:34-39` | — | `@/lib/constants.ts` |
| `CONDITION_TYPES` | `ConditionBuilder.tsx:15-23` | — | `@/lib/constants.ts` |

## Task

### 1. Create/extend `web/src/lib/constants.ts`

Add all domain constants listed above. Use `as const` for type safety:

```typescript
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
export const MONTHS = [
  { value: '1', label: 'January' },
  // ...
] as const
export const COMMON_TIMEZONES = [ ... ] as const
export const NUMERIC_OPERATORS = [ ... ] as const
export const BOOL_OPERATORS = [ ... ] as const
export const TIME_RANGE_PRESETS = [ ... ] as const
export const DAYS_OPTIONS = [ ... ] as const
export const CONDITION_TYPES = [ ... ] as const
```

### 2. Update all source files to import from `@/lib/constants.ts`

Remove the local definitions and replace with imports. For each file:
- Delete the local `const` declaration
- Add `import { DAYS, ... } from '@/lib/constants'`
- Verify no other local references to the old name

### Important constraints

- If `@/lib/constants.ts` already exists, EXTEND it — do not overwrite existing exports
- Keep `CONDITION_TYPES` exported (it's used by other automation components)
- `SignalQueryControls.tsx` already exports `TIME_PRESETS` — reuse that OR move to constants.ts. Do NOT have both.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
# Verify no local DAYS/MONTHS/TIMEZONES remain in .tsx files
grep -rn "const DAYS\b\|const MONTHS\b\|const COMMON_TIMEZONES\|const DAY_LABELS\|const NUMERIC_OPERATORS\|const BOOL_OPERATORS" --include="*.tsx" src/
# Should return 0 matches (all moved to .ts)
```

Log result. STATUS=DONE only if tsc passes AND grep returns zero matches in .tsx files.
