---
description: "Phase-16 — Charts: charging detail (7 files)"
---
# Prompt 08 — Charts: Charging Detail
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08-charts-charging-detail.log` |
| Allowed files to change | See file list below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (chartDefaults.tsx must exist)

## Files to change (7)

Find and update these files under `web/src/`:

| File | Expected directory |
|---|---|
| `ChargingDetailPage.tsx` | `features/charging/pages/` |
| `SessionCurveChart.tsx` | `features/charging/components/charging-curve/` |
| `SessionComparisonChart.tsx` | `features/charging/components/charging-curve/` |
| `CostPerKwhChart.tsx` | `features/charging/components/cost-analysis/` |
| `MonthlyCostChart.tsx` | `features/charging/components/cost-analysis/` |
| `PowerOutputChart.tsx` | `features/driving/components/drivetrain-health/` |
| `ChargingDetailSection.tsx` | `features/analytics/components/analytics/` |

**Verify each file's actual path before editing.** If a file is in a different directory than
listed above, use the actual path.

## Task

For **every `<Area>` and `<Line>` component** in each file:

### 1. Add import
```tsx
import { AREA_DEFAULTS, areaGradient } from '@/components/charts';
```

### 2. Spread AREA_DEFAULTS on Area/Line components
```tsx
<Area {...AREA_DEFAULTS} dataKey="power" stroke="#3b82f6" fill="url(#powerGradient)" />
```

Remove redundant props already covered by AREA_DEFAULTS (`type="monotone"`, `dot={true}`,
`dot={false}`, `connectNulls={true}`, `strokeWidth={2}`). Keep props that intentionally
differ from defaults.

### 3. Add gradient defs for Area charts
```tsx
<AreaChart ...>
  {areaGradient('chargeCurveGradient', '#10b981')}
  <Area {...AREA_DEFAULTS} fill="url(#chargeCurveGradient)" ... />
</AreaChart>
```

Use unique gradient IDs per chart.

### 4. DO NOT change:
- `<Bar>` components (e.g., cost bar charts)
- `<Pie>` components (e.g., charger type breakdown)
- Component logic, data fetching, or layout

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-Object -Last 5

# Zero dot={true} in these files:
$files = @(
  "src/features/charging/pages/ChargingDetailPage.tsx",
  "src/features/charging/components/charging-curve/SessionCurveChart.tsx",
  "src/features/charging/components/charging-curve/SessionComparisonChart.tsx",
  "src/features/charging/components/cost-analysis/CostPerKwhChart.tsx",
  "src/features/charging/components/cost-analysis/MonthlyCostChart.tsx",
  "src/features/driving/components/drivetrain-health/PowerOutputChart.tsx",
  "src/features/analytics/components/analytics/ChargingDetailSection.tsx"
)
$dotTrue = $files | ForEach-Object { Select-String -Path $_ -Pattern 'dot=\{true\}' -ErrorAction SilentlyContinue } | Measure-Object
"dot={true} count: $($dotTrue.Count)"
# Should be 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/08-charts-charging-detail: apply AREA_DEFAULTS + areaGradient to 7 charging detail charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08-charts-charging-detail` as the commit message prefix.
