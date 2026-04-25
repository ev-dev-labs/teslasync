---
description: "Phase-16 — Apply chart defaults to vehicle system charts"
---
# Prompt 08e — Charts: Vehicle Systems (tire, climate, motor, safety)
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08e-charts-systems.log` |
| Allowed files to change | Files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 08a

## Files (8)

1. `TirePressurePage.tsx`
2. `TirePressureSection.tsx`
3. `ClimateControlPage.tsx`
4. `MotorHistoryCharts.tsx`
5. `StatorTempChart.tsx`
6. `TorqueHistoryChart.tsx`
7. `SafetySettingsPage.tsx`
8. `VampireDrainPage.tsx`

## Task

Same pattern as 08b: import `AREA_DEFAULTS` + `areaGradient`, spread onto `<Area>`/`<Line>`, add gradient defs, remove `dot={true}`.

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
grep -rn 'dot={true}' --include="*.tsx" src/features/vehicle-systems/ src/features/tire/ | wc -l
```

## Commit

```powershell
git add -A
git commit -m "phase-16/08e-charts-systems: apply smoothed area defaults to vehicle system charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08e-charts-systems` as the commit message prefix.
