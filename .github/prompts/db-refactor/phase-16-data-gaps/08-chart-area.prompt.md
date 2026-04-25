---
description: "Phase-16 — Refactor charts to continuous smoothed area style"
---
# Prompt 08 — Chart Refactor: Scatter Points → Smoothed Area Charts
> **Severity:** UI | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-16-08-chart-area.log` |
| Allowed files to change | All chart component files listed below, `web/src/components/charts/`, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Problem

After switching from snapshot tables to signal_log pivot data, many chart components
now show scatter points instead of continuous curves. The data arrives at irregular
timestamps with gaps, causing Recharts to render disconnected dots.

Example pages affected:
- `/charging/{id}` — temperature chart shows scatter points
- `/drives/{id}` — telemetry charts show isolated dots or "No telemetry data"
- Battery degradation, climate, motor, tire pressure pages — same pattern

## Requirements

Apply these changes to ALL time-series chart components:

### 1. Chart Type: Smoothed Area Charts
Convert `<LineChart>` / `<ScatterChart>` / bare `<Line>` to `<AreaChart>` with `<Area>`:
```tsx
<AreaChart data={data}>
  <Area
    type="monotone"              // cubic interpolation — smooth curves
    dataKey="speed_mph"
    stroke="#3b82f6"
    fill="url(#gradient-speed)"  // gradient fill
    strokeWidth={2}
    dot={false}                  // NO dots
    connectNulls={true}          // bridge null gaps
  />
</AreaChart>
```

### 2. Gradient Fill
Add SVG gradient definitions for each area:
```tsx
<defs>
  <linearGradient id="gradient-speed" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
  </linearGradient>
</defs>
```

### 3. No Dots
Set `dot={false}` on ALL `<Area>` and `<Line>` components. No activeDot either
unless it's for hover tooltip interaction (in which case use `activeDot={{ r: 3 }}`).

### 4. Connect Nulls
Set `connectNulls={true}` on all `<Area>` and `<Line>` components to bridge gaps.

### 5. Time-Series X-Axis
```tsx
<XAxis
  dataKey="ts"
  type="category"
  tick={{ fontSize: 11 }}
  tickFormatter={(v) => formatTime(v)}  // use existing date formatter
/>
```

## Files to update (survey FIRST — not all may need changes)

Priority files (telemetry/session detail charts):
- `ChargingDetailPage.tsx` / `ChargingDetailSection.tsx`
- `DriveAnalyticsSection.tsx` / `DriveOverviewChart.tsx`
- `TemperatureSection.tsx` / `TemperatureTrendChart.tsx`
- `PowerProfileChart.tsx` / `PowerFlowDashboardPage.tsx`
- `SocChart.tsx` (State of Charge)
- `SpeedTrendChart.tsx`
- `ElevationChart.tsx` / `ElevationProfile.tsx`

Analytics pages:
- `BatteryDegradationPage.tsx` / `BatteryHealthPage.tsx`
- `RegenEfficiencyPage.tsx` / `EfficiencyPage.tsx`
- `TemperatureImpactPage.tsx`
- `TirePressurePage.tsx` / `TirePressureSection.tsx`
- `ClimateControlPage.tsx`
- `VampireDrainPage.tsx`
- `SpeedProfilePage.tsx`

Shared/reusable:
- `AreaChartWrapper.tsx` — if this shared wrapper exists, update it FIRST
  and all consumers inherit the changes automatically.

## Strategy

### Step 1: Check if `AreaChartWrapper.tsx` is a shared component
If it is, update it with the gradient + monotone + dot=false + connectNulls
defaults. Then verify how many consumers use it vs custom chart code.

### Step 2: Update shared wrapper first
This may fix 50%+ of charts in one shot.

### Step 3: Fix remaining custom chart components
For charts that don't use the shared wrapper, apply the same pattern.

### Step 4: Do NOT change charts that are intentionally scatter/bar
- Bar charts (distribution histograms) should stay as bars
- Pie charts stay as pies
- Only convert LINE/SCATTER time-series to AREA

## Constraints

- **Do NOT change non-time-series charts** (bar charts, pie charts, gauges)
- **Do NOT change chart data** — only the rendering configuration
- **Keep color scheme** — use existing CHART_COLORS from `@/lib/colors.ts`
- If `AreaChartWrapper` already has most of these settings, just add what's missing
- Use `type="monotone"` not `type="natural"` (monotone preserves data bounds)

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
# Verify no ScatterChart remains in time-series components
grep -rn "ScatterChart" --include="*.tsx" src/features/ src/components/charts/ | grep -v "Bar\|Pie\|Histogram\|Distribution"
# Count of dot={true} or dot not set (should be minimal)
grep -rn 'dot={true}\|dot={{' --include="*.tsx" src/features/ | wc -l
```

## Commit

```powershell
git add -A
git commit -m "phase-16/08-chart-area: refactor charts to continuous smoothed area style

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
Include `phase-16/08-chart-area` as the commit message prefix.
