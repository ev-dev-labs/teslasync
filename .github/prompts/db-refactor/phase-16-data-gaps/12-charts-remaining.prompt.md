---
description: "Phase-16 — Charts: remaining (17 files)"
---
# Prompt 12 — Charts: Remaining
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-12-charts-remaining.log` |
| Allowed files to change | See file list below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 06 (chartDefaults.tsx must exist)

## Files to change (17)

Find and update these files under `web/src/`:

| File | Expected directory |
|---|---|
| `DrivesListPage.tsx` | `features/driving/pages/` |
| `DriveEfficiencyChartWidget.tsx` | `features/dashboard/widgets/` |
| `DriveOverviewChart.tsx` | `features/driving/components/drive-detail/` |
| `BatteryTab.tsx` | `features/analytics/components/analytics/` |
| `DrivingTab.tsx` | `features/analytics/components/analytics/` |
| `ChargingTab.tsx` | `features/analytics/components/analytics/` |
| `OverviewTab.tsx` | `features/analytics/components/analytics/` |
| `ChartsRow.tsx` | `features/charging/components/charging-list/` |
| `ProjectedRangePage.tsx` | `features/battery/pages/` |
| `PowerFlowDashboardPage.tsx` | `features/battery/pages/` |
| `MileagePage.tsx` | `features/analytics/pages/` |
| `YearlyTrendChart.tsx` | `features/charging/components/charging-curve/` |
| `SharedDrivePage.tsx` | `features/sharing/pages/` |
| `TripReplayPage.tsx` | `features/driving/pages/` |
| `NavigationRoutePage.tsx` | `features/maps/pages/` |
| `SOCRouteChart.tsx` | `features/driving/components/` |
| `VehicleCharts.tsx` | `features/vehicles/components/` |

**Also check for these if they contain Area/Line charts:**

| File | Expected directory |
|---|---|
| `MediaPlayerPage.tsx` | `features/vehicle-systems/pages/` |
| `SignalDiffPage.tsx` | `features/telemetry/pages/` |
| `FSMTimelineChart.tsx` | `features/system/components/` |

**Verify each file's actual path before editing.** If a file is in a different directory than
listed above, use the actual path. Some files may not contain Area/Line charts — skip those
(note in log).

## Task

For **every `<Area>` and `<Line>` component** in each file:

### 1. Add import
```tsx
import { AREA_DEFAULTS, areaGradient } from '@/components/charts';
```

### 2. Spread AREA_DEFAULTS on Area/Line components
```tsx
<Area {...AREA_DEFAULTS} dataKey="value" stroke="#3b82f6" fill="url(#gradient)" />
```

Remove redundant props already covered by AREA_DEFAULTS. Keep props that intentionally
differ from defaults.

### 3. Add gradient defs for Area charts

Use unique gradient IDs per chart.

### 4. Special considerations

- **Analytics tabs** (`BatteryTab`, `DrivingTab`, `ChargingTab`, `OverviewTab`) — may mix
  Area/Line with Bar charts. Only modify Area/Line components.
- **NavigationRoutePage.tsx** — may be primarily a map view. Only add chart defaults if it
  contains Recharts `<Area>` or `<Line>` components.
- **FSMTimelineChart.tsx** — may use a custom timeline visualization. Only modify if it uses
  standard Recharts `<Area>` or `<Line>` components.
- **SignalDiffPage.tsx** — may use Line charts for signal comparison. Apply defaults if
  `<Line>` components are present.
- **MediaPlayerPage.tsx** — may use Area charts for audio visualization. Apply defaults if
  `<Area>` components are present.

### 5. DO NOT change:
- `<Bar>` components
- `<Pie>` components
- `<Gauge>` / `<RadialBar>` components
- Component logic, data fetching, or layout

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-Object -Last 5

# Broad check: zero dot={true} across all feature tsx files
$dotTrue = Get-ChildItem -Recurse src\features\*.tsx | Select-String 'dot=\{true\}' | Measure-Object
"dot={true} total in features: $($dotTrue.Count)"
# Should be 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/12-charts-remaining: apply AREA_DEFAULTS + areaGradient to remaining 17 chart files

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/12-charts-remaining` as the commit message prefix.
