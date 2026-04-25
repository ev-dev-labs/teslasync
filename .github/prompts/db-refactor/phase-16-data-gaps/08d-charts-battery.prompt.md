---
description: "Phase-16 — Apply chart defaults to battery/energy charts"
---
# Prompt 08d — Charts: Battery + Energy Pages
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08d-charts-battery.log` |
| Allowed files to change | Files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 08a

## Files (8)

1. `BatteryCellsPage.tsx`
2. `BatteryDegradationPage.tsx`
3. `BatteryDegradationTrendWidget.tsx`
4. `BatteryHealthPage.tsx`
5. `BatteryRangeCharts.tsx`
6. `BatteryTab.tsx`
7. `EnergyPage.tsx`
8. `EnergyFlowPage.tsx`

## Task

Same pattern as 08b: import `AREA_DEFAULTS` + `areaGradient`, spread onto `<Area>`/`<Line>`, add gradient defs, remove `dot={true}`.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
grep -rn 'dot={true}' --include="*.tsx" src/features/battery/ src/features/energy/ | wc -l
```

## Commit

```powershell
git add -A
git commit -m "phase-16/08d-charts-battery: apply smoothed area defaults to battery/energy charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08d-charts-battery` as the commit message prefix.
