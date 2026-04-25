---
description: "Phase-16 — Apply chart defaults to drive detail charts"
---
# Prompt 08b — Charts: Drive Detail Pages
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08b-charts-drive.log` |
| Allowed files to change | Files listed below, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 08a (AREA_DEFAULTS + areaGradient)

## Files (7)

1. `DriveAnalyticsSection.tsx`
2. `SpeedTrendChart.tsx`
3. `PowerProfileChart.tsx`
4. `ElevationProfile.tsx`
5. `SocChart.tsx`
6. `TemperatureSection.tsx` / `TemperatureTrendChart.tsx`

## Task

For each file:
1. Import `{ AREA_DEFAULTS, areaGradient }` from `@/components/charts`
2. Add `<defs>{areaGradient('grad-speed', '#3b82f6')}</defs>` inside the chart
3. On every `<Area>` or `<Line>`, spread `{...AREA_DEFAULTS}` and set `fill="url(#grad-xxx)"`
4. Remove any explicit `dot={true}` or `type="linear"`
5. Do NOT change bar/pie/scatter charts that are intentionally non-area

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
grep -rn 'dot={true}' --include="*.tsx" src/features/drives/ src/features/driving/ | wc -l
# Should be 0
```

## Commit

```powershell
git add -A
git commit -m "phase-16/08b-charts-drive: apply smoothed area defaults to drive detail charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08b-charts-drive` as the commit message prefix.
