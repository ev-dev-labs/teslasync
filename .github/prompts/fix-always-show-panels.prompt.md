---
description: "Fix 104 hidden panel violations — remove empty={} gates, convert {data && <Panel>} to always-show with EmptyState, add chart placeholders"
---

# Fix: Always-Show Panels — 104 Hidden Panel Violations

## Problem

The app hides entire sections/panels when data is missing. Users see blank areas or
"No data available" pages instead of properly structured panels with helpful empty states.
This makes the app feel broken even when it's just waiting for data.

**3 categories to fix (104 total). DO NOT touch category 4 (~106 field-level conditionals — those are acceptable).**

---

## Category 1 — Remove `empty={}` from PageContainer (26 instances)

**Pattern to find:**
```bash
grep -rn "empty={" web/src/features/ --include="*.tsx"
```

**Fix:** Remove the `empty=` prop entirely. Let each section inside handle its own empty state.

```tsx
// ❌ BEFORE — hides ALL children when data is null
<PageContainer title={t('page.title')} loading={isLoading} empty={!data}>
  <Section1 />
  <Section2 />
</PageContainer>

// ✅ AFTER — page always renders, each section handles its own state
<PageContainer title={t('page.title')} loading={isLoading}>
  <Section1 data={data} />
  <Section2 data={data} />
</PageContainer>
```

**Files to fix (26):**
```
web/src/features/admin/pages/SecurityAccessPage.tsx:322
web/src/features/analytics/pages/MileagePage.tsx:144
web/src/features/analytics/pages/TimelinePage.tsx:218
web/src/features/battery/pages/BatteryCellsPage.tsx:280
web/src/features/battery/pages/BatteryDegradationPage.tsx:195
web/src/features/battery/pages/EnergyPage.tsx:242
web/src/features/battery/pages/ProjectedRangePage.tsx:87
web/src/features/battery/pages/VampireDrainPage.tsx:118
web/src/features/charging/pages/ChargingCurvePage.tsx:749
web/src/features/charging/pages/ChargingCurvePage.tsx:815
web/src/features/charging/pages/ChargingCurvePage.tsx:889
web/src/features/charging/pages/ChargingHeatmapPage.tsx:130
web/src/features/driving/pages/DrivetrainHealthPage.tsx:379
web/src/features/driving/pages/RegenEfficiencyPage.tsx:114
web/src/features/driving/pages/RouteEfficiencyPage.tsx:156
web/src/features/driving/pages/SpeedProfilePage.tsx:102
web/src/features/maps/pages/MapOverviewPage.tsx:189
web/src/features/maps/pages/NavigationRoutePage.tsx:496
web/src/features/maps/pages/TemperatureImpactPage.tsx:205
web/src/features/system/pages/DBHealthPage.tsx:215
web/src/features/system/pages/StateMachineDebuggerPage.tsx:308
web/src/features/system/pages/SystemStatusPage.tsx:1594
web/src/features/telemetry/pages/MQTTInspectorPage.tsx:135
web/src/features/trips/pages/TripListPage.tsx:194
web/src/features/vehicle-systems/pages/ClimateControlPage.tsx:338
web/src/features/vehicle-systems/pages/TirePressurePage.tsx:273
```

For each file:
1. Remove the `empty={...}` prop from `<PageContainer>`
2. Find the first content section inside PageContainer
3. Wrap that section's content in a ternary: `{data ? <Content /> : <EmptyState message={t('...')} />}`
4. If the page has multiple sections with the same data dependency, wrap each independently

**IMPORTANT:** Some pages use `empty=` with complex conditions like `empty={!data && !isLoading}`.
Remove ALL of them — the `loading=` prop already handles the loading state.

---

## Category 2 — Fix `{data && <section>}` hiding whole panels (~40 instances)

**Pattern to find:**
```bash
grep -rn '{[a-zA-Z_.]*\s*&&\s*($' web/src/features/ --include="*.tsx" | grep -v "field\|icon\|className\|Error\|Loading\|Pending\|Success"
```

**Fix:** Replace conditional rendering with always-visible panel + EmptyState fallback.

```tsx
// ❌ BEFORE — entire panel hidden when data is null
{stats && (
  <GlassPanel className="p-6">
    <StatCards data={stats} />
  </GlassPanel>
)}

// ✅ AFTER — panel always visible with empty state
<GlassPanel className="p-6">
  <h2 className="mb-4 text-lg font-semibold text-white/90">
    {t('section.title', 'Statistics')}
  </h2>
  {stats ? (
    <StatCards data={stats} />
  ) : (
    <EmptyState message={t('section.noData', 'No statistics available yet')} />
  )}
</GlassPanel>
```

**Key files with section-level hiding (fix these):**
```
EfficiencyPage.tsx:170,210,317,346 — {stats && (...)} x4
DrivesListPage.tsx:315,337,360 — {stats && (...)} x3
DrivetrainHealthPage.tsx:401 — {health && (...)}
RegenEfficiencyPage.tsx:117 — {data && (...)}
SpeedProfilePage.tsx:105 — {data && (...)}
TemperatureImpactPage.tsx:283 — {stats && (...)}
ChargingListPage.tsx:334,356,577 — {stats && (...)} x3
MapOverviewPage.tsx:280 — {latest && (...)}
NavigationRoutePage.tsx:766 — {hasActiveRoute && (...)}
DriveScorePage.tsx:848,1435 — {apiScore && (...)}, {periodStats && (...)}
MQTTInspectorPage.tsx:178 — {status && (...)}
SignalExplorerPage.tsx:293 — {chartResponse && (...)}
```

**DO NOT change these patterns — they are field-level conditionals, not section hiding:**
- `{session.address && (...)}` — optional metadata display
- `{state.is_charging && (...)}` — contextual detail
- `{error && <QueryError>}` — error display
- `{isLoading && <Skeleton>}` — loading display
- `{item.due_date && (...)}` — optional field
- `{decoded.header && (...)}` — computed result display

**Rule of thumb:** If the parent is already a visible panel/section and the conditional shows/hides
a small detail row → LEAVE IT. If the conditional hides an entire `<GlassPanel>`, `<FadeIn>`,
`<Grid>`, or `<ChartContainer>` → FIX IT.

---

## Category 3 — Fix `{arr.length > 0 && <chart>}` hiding charts (38 instances)

**Pattern to find:**
```bash
grep -rn '\.length\s*>\s*0\s*&&\s*(' web/src/features/ --include="*.tsx"
```

**Fix:** Always show the chart container with a placeholder when data is empty.

```tsx
// ❌ BEFORE — chart hidden when array is empty
{chartData.length > 0 && (
  <ChartContainer title={t('chart.title')} height={300}>
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData}>...</AreaChart>
    </ResponsiveContainer>
  </ChartContainer>
)}

// ✅ AFTER — chart container always visible with placeholder
<ChartContainer title={t('chart.title')} height={300}>
  {chartData.length > 0 ? (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={chartData}>...</AreaChart>
    </ResponsiveContainer>
  ) : (
    <EmptyState message={t('chart.noData', 'Not enough data to display chart')} />
  )}
</ChartContainer>
```

**Key files with chart hiding (fix these):**
```
AnalyticsPage.tsx:571 — durationDist chart
BackupRestorePage.tsx:718 — failedRuns list
ChargingListPage.tsx:624,639,654,669 — charger specs breakdowns x4
CostAnalysisPage.tsx:535 — vehicle comparison
DashboardPage.tsx:256 — other vehicles strip
DriveDetailPage.tsx:825,831,860,863,866,869 — temperature charts x6
DrivingDynamicsPage.tsx:850 — acceleration patterns
DBHealthPage.tsx:336 — migrations list
StateMachineDebuggerPage.tsx:249,398 — vehicle select, transitions
MQTTInspectorPage.tsx:194,249,255 — topics, vehicles, stale
SignalExplorerPage.tsx:200 — selected signals
SignalLogViewerPage.tsx:187 — selected signals
TripListPage.tsx:258 — trips list
```

**DO NOT change these — they are list empty states (already show EmptyState):**
- `{drives.length === 0 && <EmptyState>}` — correct pattern
- `{filteredTemplates.length === 0 && <EmptyState>}` — correct pattern

---

## Engineering Guidelines Reminder

```
✅ Import EmptyState from '@/components/feedback'
✅ All empty state messages use t('key', 'Fallback English text')
✅ Keep the panel/section shell (GlassPanel, ChartContainer) always visible
✅ Only the CONTENT inside the panel changes (data vs EmptyState)
✅ DO NOT revert to old code — fix using new architecture only
✅ DO NOT use `any` type — keep proper TypeScript types
```

---

## Verification

```bash
cd web

# TypeScript must pass
npx tsc --noEmit

# Category 1: Zero empty= props remaining
grep -rn "empty={" src/features/ --include="*.tsx" | wc -l
# Target: 0

# Category 2: Count section-level {data && <Panel>} — should be significantly reduced
grep -rn '{[a-zA-Z_]*\s*&&\s*($' src/features/ --include="*.tsx" | grep -v "field\|icon\|Error\|Loading\|Success\|className\|is_\|address\|due_\|last_\|decoded\|cable\|brand" | wc -l
# Target: < 10 (some contextual ones are OK)

# Category 3: Count {.length > 0 && (} — should be significantly reduced
grep -rn '\.length\s*>\s*0\s*&&\s*(' src/features/ --include="*.tsx" | wc -l
# Target: < 10

# EmptyState usage should increase
grep -rn "EmptyState" src/features/ --include="*.tsx" | wc -l
# Target: should be significantly higher than before
```

**COMPLETION DEFINITION:**
- [ ] All 26 `empty={}` props removed from PageContainer
- [ ] Section-level `{data && <Panel>}` converted to always-show with EmptyState (~40 fixes)
- [ ] Chart-level `{arr.length > 0 && <Chart>}` converted to always-show with EmptyState (~38 fixes)
- [ ] Field-level conditionals (`{field && <detail>}`) left unchanged
- [ ] All EmptyState messages use useTranslation()
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code patterns
