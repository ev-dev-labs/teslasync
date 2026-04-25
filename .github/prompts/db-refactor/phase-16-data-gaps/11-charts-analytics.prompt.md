---
description: "Phase-16 — Charts: analytics + comparison (8 files)"
---
# Prompt 11 — Charts: Analytics
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-11-charts-analytics.log` |
| Allowed files to change | See file list below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (chartDefaults.tsx must exist)

## Files to change (8)

Find and update these files under `web/src/`:

| File | Expected directory |
|---|---|
| `SpeedProfilePage.tsx` | `features/driving/pages/` |
| `TemperatureImpactPage.tsx` | `features/maps/pages/` |
| `EfficiencyPage.tsx` | `features/driving/pages/` |
| `RegenEfficiencyPage.tsx` | `features/driving/pages/` |
| `ComparisonPage.tsx` | `features/analytics/pages/` |
| `DriveScorePage.tsx` | `features/driving/pages/` |
| `DrivingCoachSection.tsx` | `features/driving/components/driving-dynamics/` |
| `CostForecastSection.tsx` | `features/charging/components/cost-analysis/` |

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
<Area {...AREA_DEFAULTS} dataKey="efficiency" stroke="#8b5cf6" fill="url(#efficiencyGradient)" />
```

Remove redundant props already covered by AREA_DEFAULTS. Keep props that intentionally
differ from defaults.

### 3. Add gradient defs for Area charts

Use unique gradient IDs per chart.

### 4. Special considerations

- **SpeedProfilePage.tsx** — may contain gauge/radial components alongside line charts.
  Only modify `<Area>` and `<Line>` components, leave gauges untouched.
- **TemperatureImpactPage.tsx** — may contain map components alongside charts.
  Only modify `<Area>` and `<Line>` components.
- **RegenEfficiencyPage.tsx** — may contain mixed chart types (area + bar).
  Only modify `<Area>` and `<Line>` components, leave `<Bar>` untouched.

### 5. DO NOT change:
- `<Bar>` components
- `<Pie>` components
- `<Gauge>` / `<RadialBar>` components
- Component logic, data fetching, or layout

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-Object -Last 5

# Zero dot={true} in these files:
$files = @(
  "src/features/driving/pages/SpeedProfilePage.tsx",
  "src/features/maps/pages/TemperatureImpactPage.tsx",
  "src/features/driving/pages/EfficiencyPage.tsx",
  "src/features/driving/pages/RegenEfficiencyPage.tsx",
  "src/features/analytics/pages/ComparisonPage.tsx",
  "src/features/driving/pages/DriveScorePage.tsx",
  "src/features/driving/components/driving-dynamics/DrivingCoachSection.tsx",
  "src/features/charging/components/cost-analysis/CostForecastSection.tsx"
)
$dotTrue = $files | ForEach-Object { Select-String -Path $_ -Pattern 'dot=\{true\}' -ErrorAction SilentlyContinue } | Measure-Object
"dot={true} count: $($dotTrue.Count)"
# Should be 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/11-charts-analytics: apply AREA_DEFAULTS + areaGradient to 8 analytics charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/11-charts-analytics` as the commit message prefix.
