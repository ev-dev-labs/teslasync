---
description: "Phase-16 — Charts: vehicle systems (8 files)"
---
# Prompt 10 — Charts: Vehicle Systems
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-10-charts-vehicle-systems.log` |
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
| `TirePressurePage.tsx` | `features/vehicle-systems/pages/` |
| `TirePressureSection.tsx` | `features/driving/components/drive-detail/` |
| `ClimateControlPage.tsx` | `features/vehicle-systems/pages/` |
| `MotorHistoryCharts.tsx` | `features/driving/components/driving-dynamics/` |
| `StatorTempChart.tsx` | `features/driving/components/drivetrain-health/` |
| `TorqueHistoryChart.tsx` | `features/driving/components/drivetrain-health/` |
| `SafetySettingsPage.tsx` | `features/vehicle-systems/pages/` |
| `VampireDrainPage.tsx` | `features/battery/pages/` |

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
<Line {...AREA_DEFAULTS} dataKey="pressure" stroke="#f59e0b" />
```

Remove redundant props already covered by AREA_DEFAULTS. Keep props that intentionally
differ from defaults.

### 3. Add gradient defs for Area charts

Use unique gradient IDs per chart (e.g., `'tirePressureGradient'`, `'statorTempGradient'`).

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
  "src/features/vehicle-systems/pages/TirePressurePage.tsx",
  "src/features/driving/components/drive-detail/TirePressureSection.tsx",
  "src/features/vehicle-systems/pages/ClimateControlPage.tsx",
  "src/features/driving/components/driving-dynamics/MotorHistoryCharts.tsx",
  "src/features/driving/components/drivetrain-health/StatorTempChart.tsx",
  "src/features/driving/components/drivetrain-health/TorqueHistoryChart.tsx",
  "src/features/vehicle-systems/pages/SafetySettingsPage.tsx",
  "src/features/battery/pages/VampireDrainPage.tsx"
)
$dotTrue = $files | ForEach-Object { Select-String -Path $_ -Pattern 'dot=\{true\}' -ErrorAction SilentlyContinue } | Measure-Object
"dot={true} count: $($dotTrue.Count)"
# Should be 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/10-charts-vehicle-systems: apply AREA_DEFAULTS + areaGradient to 8 vehicle system charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/10-charts-vehicle-systems` as the commit message prefix.
