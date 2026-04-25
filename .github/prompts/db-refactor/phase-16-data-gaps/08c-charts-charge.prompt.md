---
description: "Phase-16 — Apply chart defaults to charging detail charts"
---
# Prompt 08c — Charts: Charging Detail Pages
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08c-charts-charge.log` |
| Allowed files to change | Files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 08a

## Files (6)

1. `ChargingDetailPage.tsx`
2. `SessionCurveChart.tsx`
3. `SessionComparisonChart.tsx`
4. `CostPerKwhChart.tsx`
5. `MonthlyCostChart.tsx`
6. `PowerOutputChart.tsx`

## Task

Same pattern as 08b: import `AREA_DEFAULTS` + `areaGradient`, spread onto `<Area>`/`<Line>`, add gradient defs, remove `dot={true}`.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
grep -rn 'dot={true}' --include="*.tsx" src/features/charging/ | wc -l
```

## Commit

```powershell
git add -A
git commit -m "phase-16/08c-charts-charge: apply smoothed area defaults to charging charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08c-charts-charge` as the commit message prefix.
