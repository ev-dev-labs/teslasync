---
description: "Phase-16 — Charts: battery + energy (7 files)"
---
# Prompt 09 — Charts: Battery + Energy
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-09-charts-battery-energy.log` |
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
| `BatteryCellsPage.tsx` | `features/battery/pages/` |
| `BatteryDegradationPage.tsx` | `features/battery/pages/` |
| `BatteryDegradationTrendWidget.tsx` | `features/dashboard/widgets/` |
| `BatteryHealthPage.tsx` | `features/battery/pages/` |
| `BatteryRangeCharts.tsx` | `features/vehicles/components/vehicle-detail/` |
| `EnergyPage.tsx` | `features/battery/pages/` |
| `EnergyFlowPage.tsx` | `features/battery/pages/` |

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
<Area {...AREA_DEFAULTS} dataKey="batteryLevel" stroke="#22c55e" fill="url(#batteryGradient)" />
```

Remove redundant props already covered by AREA_DEFAULTS. Keep props that intentionally
differ from defaults.

### 3. Add gradient defs for Area charts

Use unique gradient IDs per chart (e.g., `'batteryDegradationGradient'`, `'energyFlowGradient'`).

### 4. DO NOT change:
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
  "src/features/battery/pages/BatteryCellsPage.tsx",
  "src/features/battery/pages/BatteryDegradationPage.tsx",
  "src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx",
  "src/features/battery/pages/BatteryHealthPage.tsx",
  "src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx",
  "src/features/battery/pages/EnergyPage.tsx",
  "src/features/battery/pages/EnergyFlowPage.tsx"
)
$dotTrue = $files | ForEach-Object { Select-String -Path $_ -Pattern 'dot=\{true\}' -ErrorAction SilentlyContinue } | Measure-Object
"dot={true} count: $($dotTrue.Count)"
# Should be 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/09-charts-battery-energy: apply AREA_DEFAULTS + areaGradient to 7 battery + energy charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/09-charts-battery-energy` as the commit message prefix.
