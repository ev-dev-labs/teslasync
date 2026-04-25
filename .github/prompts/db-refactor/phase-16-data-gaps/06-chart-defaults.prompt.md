---
description: "Phase-16 — Create shared chartDefaults.tsx (AREA_DEFAULTS + areaGradient)"
---
# Prompt 06 — Create Shared Chart Defaults
> **Severity:** Infra | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-06-chart-defaults.log` |
| Allowed files to change | `web/src/components/charts/chartDefaults.tsx` (new file), `web/src/components/charts/index.ts` (barrel export), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

Every Area/Line chart in the app duplicates the same Recharts props: `dot`, `connectNulls`,
`strokeWidth`, `type`, gradient definitions, etc. This makes visual consistency hard to
maintain and creates unnecessary diff noise.

## Task

### 1. Create `web/src/components/charts/chartDefaults.tsx`

**IMPORTANT**: This file must be `.tsx` (not `.ts`) because `areaGradient()` returns JSX.

```tsx
import React from 'react';

/**
 * Shared Recharts props for smoothed Area/Line charts.
 * Spread onto <Area> or <Line> components: {...AREA_DEFAULTS}
 */
export const AREA_DEFAULTS = {
  type: 'monotone' as const,
  dot: false,
  connectNulls: true,
  strokeWidth: 2,
  animationDuration: 300,
} as const;

/**
 * Returns a <defs> + <linearGradient> element pair for Recharts area fills.
 * Place inside <AreaChart> before <Area> components.
 *
 * @param id    Unique gradient ID (use per-chart to avoid SVG ID collisions)
 * @param color Hex color string (e.g., '#3b82f6')
 * @param opacity Top opacity for the gradient (default 0.3)
 */
export function areaGradient(id: string, color: string, opacity = 0.3) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={opacity} />
        <stop offset="95%" stopColor={color} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}
```

### 2. Update barrel export

Add to `web/src/components/charts/index.ts` (or create it if it doesn't exist):

```ts
export { AREA_DEFAULTS, areaGradient } from './chartDefaults';
```

If an `index.ts` barrel already exists, append the export line. Don't remove existing exports.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-Object -Last 5
# Should compile without errors

# Verify file exists and exports correctly:
Select-String -Path src\components\charts\chartDefaults.tsx -Pattern "AREA_DEFAULTS|areaGradient"
# Should return matches for both exports
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/06-chart-defaults: create shared chartDefaults.tsx with AREA_DEFAULTS + areaGradient

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/06-chart-defaults` as the commit message prefix.
