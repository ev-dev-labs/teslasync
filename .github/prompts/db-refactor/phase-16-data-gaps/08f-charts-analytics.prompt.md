---
description: "Phase-16 — Apply chart defaults to analytics/comparison charts"
---
# Prompt 08f — Charts: Analytics + Comparison + Dashboard Widgets
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08f-charts-analytics.log` |
| Allowed files to change | Files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 08a

## Files (8)

1. `SpeedProfilePage.tsx`
2. `TemperatureImpactPage.tsx`
3. `EfficiencyPage.tsx`
4. `RegenEfficiencyPage.tsx`
5. `ComparisonPage.tsx`
6. `DriveScorePage.tsx`
7. `DrivingCoachSection.tsx`
8. `CostForecastSection.tsx`

## Task

Same pattern as 08b: import `AREA_DEFAULTS` + `areaGradient`, spread onto `<Area>`/`<Line>`, add gradient defs, remove `dot={true}`.

Do NOT change bar charts or pie charts in these files — only Line/Area time-series.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
grep -rn 'dot={true}' --include="*.tsx" src/features/analytics/ | wc -l
```

## Commit

```powershell
git add -A
git commit -m "phase-16/08f-charts-analytics: apply smoothed area defaults to analytics charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08f-charts-analytics` as the commit message prefix.
