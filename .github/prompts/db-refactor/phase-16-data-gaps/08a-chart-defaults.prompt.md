---
description: "Phase-16 — Create shared chart defaults config"
---
# Prompt 08a — Create Shared Chart Defaults Config
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08a-chart-defaults.log` |
| Allowed files to change | `web/src/components/charts/chartDefaults.ts` (CREATE), `web/src/components/charts/index.ts`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Task

Create `web/src/components/charts/chartDefaults.ts`:

```typescript
/** Shared defaults for all time-series Area/Line charts.
 *  Import and spread onto <Area> / <Line> components:
 *  <Area {...AREA_DEFAULTS} dataKey="speed" stroke="#3b82f6" fill="url(#grad-speed)" />
 */
export const AREA_DEFAULTS = {
  type: 'monotone' as const,
  dot: false,
  connectNulls: true,
  strokeWidth: 2,
  activeDot: { r: 3, strokeWidth: 0 },
} as const

export const LINE_DEFAULTS = {
  type: 'monotone' as const,
  dot: false,
  connectNulls: true,
  strokeWidth: 2,
  activeDot: { r: 3, strokeWidth: 0 },
} as const

/** Generates a vertical gradient <linearGradient> element for area fill.
 *  Place inside <defs> in the chart:
 *  <defs>{areaGradient('grad-speed', '#3b82f6')}</defs>
 *  <Area fill="url(#grad-speed)" ... />
 */
export function areaGradient(id: string, color: string, opacity = 0.3) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={opacity} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  )
}
```

Export from `index.ts`.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
```

## Commit

```powershell
git add -A
git commit -m "phase-16/08a-chart-defaults: create shared AREA_DEFAULTS + areaGradient

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08a-chart-defaults` as the commit message prefix.
