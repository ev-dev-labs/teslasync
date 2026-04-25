---
description: "Phase-16 — Apply chart defaults to remaining chart files"
---
# Prompt 08g — Charts: Remaining Files (dashboard, trips, fleet, signals, mileage)
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08g-charts-remaining.log` |
| Allowed files to change | Files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 08a

## Files (remaining ~15)

1. `DrivesListPage.tsx` (inline sparklines)
2. `DriveEfficiencyChartWidget.tsx`
3. `DriveOverviewChart.tsx`
4. `DrivingTab.tsx` / `ChargingTab.tsx` / `BatteryTab.tsx` / `OverviewTab.tsx`
5. `ChartsRow.tsx`
6. `ProjectedRangePage.tsx`
7. `PowerFlowDashboardPage.tsx`
8. `MileagePage.tsx`
9. `YearlyTrendChart.tsx`
10. `SharedDrivePage.tsx`
11. `TripReplayPage.tsx`
12. `NavigationRoutePage.tsx`
13. `SOCRouteChart.tsx`
14. `VehicleCharts.tsx`

## Task

Same pattern: import `AREA_DEFAULTS` + `areaGradient`, spread, gradient defs, no dots.

Survey each file first — some may be bar charts or non-time-series that should stay as-is.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
# Final count: total dot={true} remaining across entire codebase
grep -rn 'dot={true}' --include="*.tsx" src/ | wc -l
# Should be 0 or near 0
```

## Commit

```powershell
git add -A
git commit -m "phase-16/08g-charts-remaining: apply smoothed area defaults to remaining charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08g-charts-remaining` as the commit message prefix.
