---
description: "Fix StatisticsPage — restore 5 missing sections (Battery Health, State Distribution, Mileage, Vehicle Comparison, Charging Trend)"
---

# Fix: StatisticsPage — 69% of Original, 5 Sections Missing

## Comparison

| Metric | Original (218 lines) | Current (150 lines) | Gap |
|--------|---------------------|--------------------|----|
| Data sources | 5 (fleet, energy, battery, mileage, state) | 1 (period-stats only) | -4 |
| Charts | 4 (RadialBar, Pie, 2× BarChart) | 0 | -4 |
| Panels | 4 (Battery Health, State Dist, Mileage, Charts) | 0 | -4 |
| Metric cards | 6 | 8 | ✅ |
| Date range filter | ✅ | ❌ missing | -1 |

## Missing Sections

### 1. Date Range Filter (old had start/end date picker)
Currently missing. Add DateRangeFilter at the top.

### 2. Battery Health Panel
Old page had:
- RadialBarChart showing battery health %
- Battery level, degradation, capacity stats

**Data source:** `GET /vehicles/{vehicleID}/battery` → `batteryHandler.Report` (router.go:217)
**Hook exists:** `useEnergy.ts` → `useBatteryReport(vehicleId)` or use `useBatteryHealthAnalytics(vehicleId)` at `/analytics/battery-health`

### 3. State Distribution Panel
Old page had:
- PieChart showing time in each state (driving/charging/parked/sleeping)

**Data source:** Use `useStateSummary(vehicleId)` from `useAnalytics.ts` → `/vehicle-states/summary?vehicle_id=X`

### 4. Mileage Summary Panel
Old page had:
- Odometer reading, daily average, monthly average distance

**Data source:** `GET /mileage/stats?vehicle_id=X` → `mileageHandler.Stats` (router.go:421)
**Hook exists:** `useMileageStats(vehicleId)` in `useAnalytics.ts`

### 5. Vehicle Comparison BarChart
Old page had:
- BarChart comparing distance + energy across vehicles
- Only shown when multiple vehicles exist

**Data source:** Use `useFleetAnalytics(30)` from `useAnalytics.ts` → `/analytics/fleet`

### 6. Monthly Charging Trend BarChart
Old page had:
- BarChart with energy/cost/savings per month

**Data source:** Use `useMonthlyMileage(vehicleId)` or derive from fleet analytics

## Implementation

### Step 1 — Add missing data hooks

Add these hook calls to the page (all hooks already exist in `useAnalytics.ts` and `useEnergy.ts`):

```typescript
import { useFleetAnalytics, useMileageStats, useStateSummary } from '@/api/hooks/useAnalytics';
import { useBatteryHealthAnalytics } from '@/api/hooks/useEnergy';
import { DateRangeFilter } from '@/components/forms';

const { data: fleet } = useFleetAnalytics(30, startDate);
const { data: mileage } = useMileageStats(activeId);
const { data: stateSummary } = useStateSummary(activeId);
const { data: batteryHealth } = useBatteryHealthAnalytics(activeId);
```

**CRITICAL:** These hooks already exist — do NOT create new ones. Do NOT add `/api/v1/` prefix.

### Step 2 — Add Date Range Filter

```typescript
import { DateRangeFilter } from '@/components/forms';

// Add state
const [startDate, setStartDate] = useState(() => {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
});
const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

// Render after PageContainer actions
<DateRangeFilter
  startDate={startDate} endDate={endDate}
  onStartDateChange={setStartDate} onEndDateChange={setEndDate}
  presets
/>
```

### Step 3 — Add Battery Health Panel

```typescript
import { RadialGauge } from '@/components/charts';

<FadeIn>
  <GlassPanel className="p-6">
    <h2 className="mb-4 text-lg font-semibold text-white/90">
      {t('statistics.batteryHealth', 'Battery Health')}
    </h2>
    {batteryHealth ? (
      <Grid cols={{ default: 1, md: 2 }} gap={4}>
        <div className="flex justify-center">
          <RadialGauge value={batteryHealth.health_pct ?? 0} max={100}
            label={t('statistics.health', 'Health')} unit="%" color="#10b981" size={140} />
        </div>
        <div className="space-y-3">
          {/* Battery stats: capacity, degradation, cycle count */}
        </div>
      </Grid>
    ) : (
      <EmptyState message={t('statistics.noBattery', 'No battery health data available')} />
    )}
  </GlassPanel>
</FadeIn>
```

### Step 4 — Add State Distribution PieChart

```typescript
import { PieChart, Pie, Cell, ResponsiveContainer } from '@/components/charts';
import { CHART_COLORS } from '@/components/charts';

<FadeIn>
  <ChartContainer title={t('statistics.stateDistribution', 'State Distribution')} height={280}>
    {stateSummary?.length ? (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={stateSummary} dataKey="duration_pct" nameKey="state"
            cx="50%" cy="50%" innerRadius={50} outerRadius={90}>
            {stateSummary.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
          </Pie>
          <Legend />
          <Tooltip content={<ChartTooltip />} />
        </PieChart>
      </ResponsiveContainer>
    ) : (
      <EmptyState message={t('statistics.noStates', 'No state distribution data')} />
    )}
  </ChartContainer>
</FadeIn>
```

### Step 5 — Add Mileage Summary Panel

```typescript
<FadeIn>
  <GlassPanel className="p-6">
    <h2 className="mb-4 text-lg font-semibold text-white/90">
      {t('statistics.mileage', 'Mileage Summary')}
    </h2>
    {mileage ? (
      <Grid cols={{ default: 2, md: 4 }} gap={4}>
        <MetricCard label={t('statistics.odometer', 'Odometer')} value={...} />
        <MetricCard label={t('statistics.dailyAvg', 'Daily Average')} value={...} />
        <MetricCard label={t('statistics.monthlyAvg', 'Monthly Average')} value={...} />
        <MetricCard label={t('statistics.yearlyProjection', 'Yearly Projection')} value={...} />
      </Grid>
    ) : (
      <EmptyState message={t('statistics.noMileage', 'No mileage data available')} />
    )}
  </GlassPanel>
</FadeIn>
```

### Step 6 — Add Vehicle Comparison BarChart

Only show chart container when there are 2+ vehicles (but always show the section):

```typescript
<FadeIn>
  <ChartContainer title={t('statistics.vehicleComparison', 'Vehicle Comparison')} height={280}>
    {compData.length > 1 ? (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={compData}>
          {/* distance + energy bars per vehicle */}
        </BarChart>
      </ResponsiveContainer>
    ) : (
      <EmptyState message={t('statistics.singleVehicle', 'Add more vehicles to compare')} />
    )}
  </ChartContainer>
</FadeIn>
```

## Engineering Rules
- Import charts from `@/components/charts` (NOT from 'recharts')
- Import EmptyState from `@/components/feedback`
- All strings via `t('key', 'Fallback')`
- Always show panel shell with EmptyState — never hide sections
- Use existing hooks — do NOT create new ones or add `/api/v1/` prefix
- DO NOT revert to old code — use new architecture only

## Verification

```bash
cd web
npx tsc --noEmit

# Line count — must be ≥ 218 (original) or at minimum 153 (70%)
wc -l src/features/analytics/pages/StatisticsPage.tsx

# Chart count — should have PieChart, BarChart, RadialGauge
grep -c "PieChart\|BarChart\|RadialGauge\|ChartContainer" src/features/analytics/pages/StatisticsPage.tsx

# Section count
grep -c "GlassPanel\|ChartContainer" src/features/analytics/pages/StatisticsPage.tsx

# Violations
grep -c "from 'recharts'" src/features/analytics/pages/StatisticsPage.tsx  # must be 0
grep -c "empty={" src/features/analytics/pages/StatisticsPage.tsx  # must be 0
```

**COMPLETION DEFINITION:**
- [ ] Date Range Filter added
- [ ] Battery Health panel with RadialGauge
- [ ] State Distribution PieChart
- [ ] Mileage Summary panel
- [ ] Vehicle Comparison BarChart
- [ ] Line count ≥ 218
- [ ] Zero `empty={}`, zero direct imports, zero raw HTML
- [ ] TypeScript compiles clean
