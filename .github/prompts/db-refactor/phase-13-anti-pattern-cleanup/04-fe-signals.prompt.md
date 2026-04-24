---
description: "Phase-13 — Centralize frontend signal field catalog"
---
# Prompt 04 — Centralize Signal Field Catalog (STATE_CHECK_FIELDS → shared registry)
> **Severity:** MEDIUM | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-04-fe-signals.log` |
| Allowed files to change | `web/src/lib/signals.ts` (CREATE), `web/src/features/automations/pages/ConditionBuilder.tsx`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

`ConditionBuilder.tsx` hardcodes `STATE_CHECK_FIELDS` (9 signal names) and `BOOL_FIELDS`
(4 signal names). When signal names change (as they did in the db-refactor), these are stale.
Other components may also need to know which signals are numeric vs boolean.

## Task

### 1. Create `web/src/lib/signals.ts`

A signal catalog that defines field names, types, and labels in one place:

```typescript
export type SignalFieldType = 'numeric' | 'boolean' | 'string'

export interface SignalField {
  key: string          // DB column / API field name
  label: string        // Human-readable label
  type: SignalFieldType
  unit?: string        // e.g. 'mph', '°C', '%'
}

/** All signals available for automation conditions and state checks */
export const SIGNAL_FIELDS: SignalField[] = [
  { key: 'battery_level', label: 'Battery Level', type: 'numeric', unit: '%' },
  { key: 'inside_temp', label: 'Inside Temperature', type: 'numeric', unit: '°C' },
  { key: 'outside_temp', label: 'Outside Temperature', type: 'numeric', unit: '°C' },
  { key: 'speed', label: 'Speed', type: 'numeric', unit: 'mph' },
  { key: 'is_locked', label: 'Is Locked', type: 'boolean' },
  { key: 'is_charging', label: 'Is Charging', type: 'boolean' },
  { key: 'is_climate_on', label: 'Climate On', type: 'boolean' },
  { key: 'sentry_mode', label: 'Sentry Mode', type: 'boolean' },
  { key: 'state', label: 'Vehicle State', type: 'string' },
  // extensible — add new signals here
]

/** Derived helpers */
export const NUMERIC_SIGNAL_FIELDS = SIGNAL_FIELDS.filter(f => f.type === 'numeric')
export const BOOLEAN_SIGNAL_FIELDS = SIGNAL_FIELDS.filter(f => f.type === 'boolean')
export const BOOL_FIELD_KEYS = new Set(BOOLEAN_SIGNAL_FIELDS.map(f => f.key))

/** For Select dropdowns */
export const SIGNAL_FIELD_OPTIONS = SIGNAL_FIELDS.map(f => ({ value: f.key, label: f.label }))
```

### 2. Update `ConditionBuilder.tsx`

- Delete `STATE_CHECK_FIELDS` array (lines 27-37)
- Delete `BOOL_FIELDS` Set (line 82 area)
- Import from `@/lib/signals.ts`:
  ```typescript
  import { SIGNAL_FIELD_OPTIONS, BOOL_FIELD_KEYS } from '@/lib/signals'
  ```
- Replace `STATE_CHECK_FIELDS` usage with `SIGNAL_FIELD_OPTIONS`
- Replace `BOOL_FIELDS.has(field)` with `BOOL_FIELD_KEYS.has(field)`

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
# Verify no hardcoded STATE_CHECK_FIELDS in .tsx
grep -rn "STATE_CHECK_FIELDS\|BOOL_FIELDS" --include="*.tsx" src/features/
# Should return 0 matches (moved to signals.ts)
```

Log result. STATUS=DONE only if tsc passes AND zero hardcoded field arrays in .tsx.
