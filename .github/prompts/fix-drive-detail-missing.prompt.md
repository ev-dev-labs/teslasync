# Fix DriveDetailPage — Missing Panels & Bugs vs Production

> **Context**: The refactored `DriveDetailPage.tsx` is missing several data fields
> that exist in the production version. Fix ALL items below surgically — no gutting,
> no removing existing sections.

---

## Part 1 — Duration Gauge Raw Float Bug

**File**: `web/src/features/driving/pages/DriveDetailPage.tsx`

**Line ~348**: The Duration RadialGauge passes `drive.durationMin` raw, which renders
as `"26.1431260521192.64"`.

**Fix** (two lines):
```tsx
// BEFORE
value={drive.durationMin}
max={Math.max(drive.durationMin * 1.5, 60)}

// AFTER
value={Math.round(drive.durationMin ?? 0)}
max={Math.max((drive.durationMin ?? 0) * 1.5, 60)}
```

---

## Part 2 — Add "Range (Start → End)" to More Details

**File**: `web/src/features/driving/pages/DriveDetailPage.tsx`

In the **More Details** section (the `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6` grid),
add a new cell **between the Odometer cell and the Elevation Summary cell**.

The data is already computed in the `stats` useMemo: `stats.startRange` and `stats.endRange`.

**Add this cell after the Odometer `</div>` and before the Elevation Summary `<div>`:**
```tsx
<div className="text-center">
  <p className="text-[10px] text-[var(--text-muted)] mb-1">
    {t('driveDetail.rangeStartEnd', 'Range (Start → End)')}
  </p>
  <p className="text-lg font-bold text-green-400">
    {stats.startRange != null
      ? `${Math.round(stats.startRange)} → ${stats.endRange != null ? Math.round(stats.endRange) : '?'}`
      : '—'}{' '}
    <span className="text-xs text-[var(--text-muted)]">{distanceUnit}</span>
  </p>
</div>
```

Since this adds a 7th cell to row 1, update the grid to `lg:grid-cols-7` (or keep `lg:grid-cols-6`
and let it wrap — either is acceptable).

---

## Part 3 — Add "Avg Inside Temp" to More Details Row 2

**File**: `web/src/features/driving/pages/DriveDetailPage.tsx`

In the **second row** of More Details (the `border-t` grid), add **Avg Inside Temp** cell
after the existing Avg Power cell (or next to Avg Outside Temp if you reorder).

The data is already computed: `stats.avgInsideTemp`.

**Add this cell:**
```tsx
{stats.avgInsideTemp !== null && (
  <div className="text-center">
    <p className="text-[10px] text-[var(--text-muted)] mb-1">
      {t('driveDetail.avgInsideTemp', 'Avg Inside Temp')}
    </p>
    <p className="text-lg font-bold text-orange-400">
      {fmtNumber(stats.avgInsideTemp)}{tempUnit}
    </p>
  </div>
)}
```

Also move the existing **Avg Outside Temp** cell from row 1 into row 2 (next to Inside Temp)
to match the production layout where both temps are in row 2 together.

---

## Part 4 — Add Range Info to Journey Details

**File**: `web/src/features/driving/pages/DriveDetailPage.tsx`

In the **Journey Details** section, both the Start and Destination blocks currently show
only `Battery: XX%`. Production shows `Battery: XX% · Range: XX mi`.

**Fix the Start block** (around line ~594-596):
```tsx
// BEFORE
<p className="text-xs text-[var(--text-secondary)]">
  {t('driveDetail.battery', 'Battery')}: {drive.startBatteryLevel ?? '?'}%
</p>

// AFTER
<p className="text-xs text-[var(--text-secondary)]">
  {t('driveDetail.battery', 'Battery')}: {drive.startBatteryLevel ?? '?'}%
  {drive.startRangeKm != null && (
    <> · {t('driveDetail.range', 'Range')}: {Math.round(convertDistance(drive.startRangeKm))} {distanceUnit}</>
  )}
</p>
```

**Fix the Destination block** (around line ~606-608) similarly:
```tsx
<p className="text-xs text-[var(--text-secondary)]">
  {t('driveDetail.battery', 'Battery')}: {drive.endBatteryLevel ?? '?'}%
  {drive.endRangeKm != null && (
    <> · {t('driveDetail.range', 'Range')}: {Math.round(convertDistance(drive.endRangeKm))} {distanceUnit}</>
  )}
</p>
```

---

## Part 5 — Add Lat/Lng Coordinate Fallback in Journey Details

**File**: `web/src/features/driving/pages/DriveDetailPage.tsx`

When no address data exists, production shows lat/lng coordinates instead of
"No address data". The current code just shows the text fallback.

**Fix the Start address** (around line ~592):
```tsx
// BEFORE
<p className="font-bold text-[var(--text-primary)] text-sm">
  {drive.startAddress || t('driveDetail.noAddress', 'No address data')}
</p>

// AFTER
<p className="font-bold text-[var(--text-primary)] text-sm">
  {drive.startAddress
    ? drive.startAddress
    : drive.startLatitude && drive.startLongitude
      ? <span className="font-mono">{fmtNumber(drive.startLatitude)}°{drive.startLatitude >= 0 ? 'N' : 'S'}, {fmtNumber(Math.abs(drive.startLongitude))}°{drive.startLongitude >= 0 ? 'E' : 'W'}</span>
      : t('driveDetail.noAddress', 'No address data')}
</p>
```

**Fix the Destination address** (around line ~602-603) similarly using
`drive.endLatitude` / `drive.endLongitude`.

---

## Part 6 — Show Chart Panels With Empty-State Placeholders

**File**: `web/src/features/driving/pages/DriveDetailPage.tsx`

All 5 chart panels (Drive Overview, SOC %, Elevation Profile, Temperatures,
Speed Histogram) plus Power Profile are wrapped in `{chartData.length > 1 && ...}`
(line ~615). When a drive has no telemetry, they all vanish. Production always
shows the panel shells.

**Fix**: Remove the outer `{chartData.length > 1 && ( <> ... </> )}` wrapper.
Instead, wrap each chart's **inner content** (the `<ResponsiveContainer>`)
individually with a ternary:

```tsx
// Pattern for each chart section:
<FadeIn>
  <ChartContainer title={...} height={...}>
    {chartData.length > 1 ? (
      <ResponsiveContainer ...>
        {/* existing chart code */}
      </ResponsiveContainer>
    ) : (
      <div className="h-full flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
        <Activity className="h-8 w-8 opacity-20" />
        <p className="text-xs">{t('driveDetail.noChartData', 'No telemetry data available')}</p>
      </div>
    )}
  </ChartContainer>
</FadeIn>
```

Apply this to ALL chart sections:
1. **Drive Overview** (ComposedChart) — keep the rich legend only when `chartData.length > 1`
2. **SOC % Over Time** (AreaChart)
3. **Elevation Profile** (ComposedChart) — keep gain/loss/net header only when data exists
4. **Temperatures** (LineChart) — keep temp stat cards only when `stats.hasAnyTemp`
5. **Speed Histogram** (BarChart) — guard on `speedHistData.length > 0` for chart, placeholder otherwise
6. **Power Profile** (AreaChart) — keep stats footer only when data exists
7. **Tire Pressure** (LineChart) — keep conditional on `stats.hasTirePressure` as-is (this one is OK to hide entirely)

Use `Activity` icon (already imported) for the empty-state icon.

---

## Part 7 — Show Route Map Placeholder When No Position Data

**File**: `web/src/features/driving/pages/DriveDetailPage.tsx`

The Route map section (line ~532) is wrapped in `{trail.length > 0 && ...}` which
hides it entirely when there's no telemetry. Production always shows the Route panel.
When there's no data, show a placeholder instead of hiding.

**Fix**: Change the conditional to always render the Route panel:
```tsx
// BEFORE
{trail.length > 0 && (
  <FadeIn>
    <GlassPanel className="overflow-hidden">
      ...map content...
    </GlassPanel>
  </FadeIn>
)}

// AFTER
<FadeIn>
  <GlassPanel className="overflow-hidden">
    <div className="p-4 pb-0">
      <h3 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-3">
        <MapPin className="h-4 w-4 text-cyan-400" /> {t('driveDetail.route', 'Route')}
      </h3>
    </div>
    {trail.length > 0 ? (
      <>
        {/* existing map + speed legend — keep all existing code here */}
      </>
    ) : (
      <div className="h-64 sm:h-80 flex flex-col items-center justify-center gap-3 text-[var(--text-muted)]">
        <MapPin className="h-10 w-10 opacity-30" />
        <p className="text-sm">{t('driveDetail.noRouteData', 'No route data available for this drive')}</p>
      </div>
    )}
  </GlassPanel>
</FadeIn>
```

Keep the entire existing map rendering code (MapContainer, Polyline, CircleMarker,
speed legend footer) inside the `trail.length > 0` branch. Only the empty-state
branch is new.

---

## Verification Checklist

After all changes:

1. `cd web && npx tsc --noEmit` — must pass clean
2. Duration gauge: `Math.round` applied, `?? 0` null safety on both value and max
3. More Details row 1: now has **Range (Start → End)** cell
4. More Details row 2: now has **Avg Inside Temp** cell (conditional)
5. Journey Details: both Start and Destination show `Battery: XX% · Range: XX mi`
6. Journey Details: lat/lng fallback when no address
7. Charts: all 6 chart panels always render — show "No telemetry data" placeholder when empty
8. Route map: always renders panel — shows placeholder when `trail` is empty
9. No new inline styles added (use Tailwind classes only)
10. No sections removed or gutted

**Do NOT**:
- Remove any existing sections
- Use `git mv`
- Add raw HTML (`<button>`, `<input>`, `<table>`)
- Add static inline styles
