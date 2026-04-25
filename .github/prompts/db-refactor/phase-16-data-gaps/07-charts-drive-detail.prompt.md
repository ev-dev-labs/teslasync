---
description: "Phase-16 — Charts: drive detail (7 files)"
---
# Prompt 07 — Charts: Drive Detail
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-07-charts-drive-detail.log` |
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
| `SpeedTrendChart.tsx` | `features/charging/components/charging-curve/` |
| `PowerProfileChart.tsx` | `features/driving/components/drive-detail/` |
| `ElevationProfile.tsx` | `components/charts/` |
| `SocChart.tsx` | `features/driving/components/drive-detail/` |
| `TemperatureSection.tsx` | `features/driving/components/drive-detail/` |
| `TemperatureTrendChart.tsx` | `features/driving/components/drivetrain-health/` |
| `DriveAnalyticsSection.tsx` | `features/driving/components/driving-dynamics/` |

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
// Before:
<Area type="monotone" dot={true} strokeWidth={2} ... />

// After:
<Area {...AREA_DEFAULTS} ... />
```

Remove any props that are now redundant because they match AREA_DEFAULTS:
- `type="monotone"` — covered by AREA_DEFAULTS
- `dot={true}` or `dot={false}` — AREA_DEFAULTS sets `dot: false`
- `connectNulls={true}` — covered by AREA_DEFAULTS
- `strokeWidth={2}` — covered by AREA_DEFAULTS

Keep props that differ from defaults (e.g., `strokeWidth={3}`, custom `type`).

### 3. Add gradient defs for Area charts
```tsx
<AreaChart ...>
  {areaGradient('gradientId', '#3b82f6')}
  <Area {...AREA_DEFAULTS} fill="url(#gradientId)" ... />
</AreaChart>
```

Use a unique gradient ID per chart (e.g., `'speedGradient'`, `'socGradient'`).

### 4. DO NOT change:
- `<Bar>` components
- `<Pie>` components
- `<Gauge>` / `<RadialBar>` components
- `<Radar>` components
- Component logic, data fetching, or layout

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit 2>&1 | Select-Object -Last 5

# Zero dot={true} in these files:
$files = @(
  "src/features/charging/components/charging-curve/SpeedTrendChart.tsx",
  "src/features/driving/components/drive-detail/PowerProfileChart.tsx",
  "src/components/charts/ElevationProfile.tsx",
  "src/features/driving/components/drive-detail/SocChart.tsx",
  "src/features/driving/components/drive-detail/TemperatureSection.tsx",
  "src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx",
  "src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx"
)
$dotTrue = $files | ForEach-Object { Select-String -Path $_ -Pattern 'dot=\{true\}' -ErrorAction SilentlyContinue } | Measure-Object
"dot={true} count: $($dotTrue.Count)"
# Should be 0
```

## Commit

```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-16/07-charts-drive-detail: apply AREA_DEFAULTS + areaGradient to 7 drive detail charts

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/07-charts-drive-detail` as the commit message prefix.
