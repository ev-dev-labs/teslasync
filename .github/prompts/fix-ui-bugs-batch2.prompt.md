---
description: "Fix UI bugs batch 2 — Signal Explorer, and additional issues found during testing"
---

# Fix: UI Bugs Batch 2 — Found During Post-Fix Testing

> These bugs were found after executing `fix-ui-data-binding.prompt.md` (commit 3dae2de).
> Signal names now load correctly but other issues remain.

## Bug 1 — Signal Explorer: Explore button clicks but returns no data (404)

**Page:** `web/src/features/telemetry/pages/SignalExplorerPage.tsx`
**Screenshot:** Signals load and are selectable (✅ fixed), but clicking "Explore" returns nothing.

**Root Cause:** The Explorer page calls a non-existent bulk endpoint:
```typescript
// Line 121:
request(`/signals/history?vehicle_id=${vehicleId}&signals=${signalsCsv}&from=${fromIso}&to=${toIso}&page=1&per_page=1000`)
```

But the API route is per-signal, not bulk:
```
GET /signals/{vehicleID}/{signalName}/history?from=...&to=...&limit=...
```

There is NO `/signals/history` bulk endpoint. The Explorer tries to query multiple signals
at once via `signals=HvacFanSpeed,Gear,Odometer` but the API only supports one signal at a time.

**Fix:** Fetch each signal individually and merge results:
```typescript
const handleExplore = useCallback(async () => {
  if (!canExplore) return;
  setExploreKey(Date.now());
}, [canExplore]);

// Replace the single bulk query with parallel per-signal queries:
const { data: chartData, isLoading: chartLoading } = useQuery({
  queryKey: ['explorer-chart', exploreKey],
  queryFn: async () => {
    const results = await Promise.all(
      selectedSignals.map(sig =>
        request<SignalHistoryEntry[]>(
          `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=1000`
        )
      )
    );
    // Merge into a unified dataset keyed by timestamp
    return mergeSignalResults(selectedSignals, results);
  },
  enabled: !!exploreKey,
});
```

Helper function:
```typescript
function mergeSignalResults(signalNames: string[], results: SignalHistoryEntry[][]) {
  const byTime = new Map<string, Record<string, number | null>>();
  results.forEach((entries, i) => {
    const name = signalNames[i];
    for (const entry of entries) {
      const key = entry.timestamp ?? entry.created_at;
      const row = byTime.get(key) ?? { time: key };
      row[name] = entry.value_num ?? entry.valueNum ?? null;
      byTime.set(key, row);
    }
  });
  return Array.from(byTime.values()).sort((a, b) =>
    new Date(a.time as string).getTime() - new Date(b.time as string).getTime()
  );
}
```

Also apply the same fix to the table data query (line 134-135) and stats query (line 127).

**Note:** Check what the `/signals/{vehicleID}/{signalName}/history` actually returns —
it queries MongoDB `signal_log`. If MongoDB is unavailable, this will also fail. Consider
adding a PostgreSQL fallback that queries `vehicle_live_state` history or returns an error
message to the user.

---

## Bug 2 — Signal Explorer: Explore button vertically misaligned with Per Page

**Page:** `web/src/features/telemetry/pages/SignalExplorerPage.tsx`

The Explore button has `className="mt-5"` (line ~269) which pushes it down relative to the
Per Page dropdown. Both should be baseline-aligned.

**Fix:** Remove `mt-5` from the Button, and add `items-end` to the parent flex container
so both controls align to the bottom:

```tsx
// Line 250: change items-center → items-end
<div className="flex items-end gap-3 justify-end">
  <Select ... />
  <Button
    ...
    className=""  // remove mt-5
  >
```

---

## Bug 3 — Signal Log Viewer: Same two issues as Signal Explorer

**Page:** `web/src/features/telemetry/pages/SignalLogViewerPage.tsx`
**Screenshot:** Query returns "0 records" even with signals selected. Query button misaligned.

**Root Cause A — Wrong endpoint (same as Bug 1):**
Line 133 calls non-existent bulk endpoint:
```typescript
request(`/signals/history?${params}`)
```
Should fetch per-signal from `/signals/{vehicleID}/{signalName}/history`.

**Fix A:** Same approach as Bug 1 — parallel per-signal fetches:
```typescript
queryFn: async () => {
  const results = await Promise.all(
    selectedSignals.map(sig =>
      request<SignalHistoryEntry[]>(
        `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=${perPage}&page=${page}`
      )
    )
  );
  return mergeSignalResults(selectedSignals, results);
},
```

**Root Cause B — Button alignment (same as Bug 2):**
Line 257 has `className="mt-5"` on the Query button, pushing it below the Per Page dropdown.

**Fix B:** Remove `mt-5`, use `items-end` on the parent flex container.

---

## Bug 4 — Live Map: Crashes with "Invalid LatLng object: (undefined, undefined)"

**Page:** `web/src/features/maps/pages/MapOverviewPage.tsx`
**Screenshot:** Error boundary: "Invalid LatLng object: (undefined, undefined)" — Retry attempt 2.

**Root Cause:** The `hasValidLocation` guard (line 115) doesn't check for `undefined`:
```typescript
const hasValidLocation = latest != null && (latest.latitude !== 0 || latest.longitude !== 0);
```
When `latest` exists but `latest.latitude` is `undefined` (field name mismatch from
`camelCaseKeys` or API returning different structure), `undefined !== 0` evaluates to `true`,
so `hasValidLocation = true`. Then `MapContainer center={[undefined, undefined]}` → Leaflet crash.

**Fix:** Add type guard for actual numbers:
```typescript
const hasValidLocation = latest != null
  && typeof latest.latitude === 'number'
  && typeof latest.longitude === 'number'
  && (latest.latitude !== 0 || latest.longitude !== 0);
```

Also investigate WHY `latest.latitude` is undefined:
1. Check the `/location-snapshots/latest` API response — what field names does it return?
2. The `LocationSnapshot` interface (line ~26) has `latitude`/`longitude` — verify the API
   model matches. After `camelCaseKeys`, snake_case fields get duplicated.
3. If the API returns wrapped response (like `{data: {...}}` or `{snapshot: {...}}`),
   the hook needs to extract the inner object.

Quick debug: `curl http://localhost:8080/api/v1/location-snapshots/latest?vehicle_id=1 | jq`

---

## Bug 5 — Navigation: Location History still shows 0.000000 (undefined guard missing)

**Page:** `web/src/features/maps/pages/NavigationRoutePage.tsx`
**Screenshot:** Location History table still shows `0.000000` for all LAT/LON despite the
batch 1 fix adding `row.latitude !== 0 || row.longitude !== 0` guards.

**Root Cause:** Same as Bug 4 — `row.latitude` is likely `undefined` (field name mismatch
from API response), NOT `0`. `undefined !== 0` evaluates to `true`, so the guard passes
and `fmtNumber(undefined ?? 0, 6)` displays `0.000000`.

The batch 1 fix (line 339) has:
```typescript
{row.latitude !== 0 || row.longitude !== 0 ? fmtNumber(row.latitude ?? 0, 6) : '—'}
```

**Fix:** Add `typeof` guard consistently across the page:
```typescript
const isValidCoord = (lat: unknown, lng: unknown) =>
  typeof lat === 'number' && typeof lng === 'number' && (lat !== 0 || lng !== 0);

// Line 339:
{isValidCoord(row.latitude, row.longitude) ? fmtNumber(row.latitude, 6) : '—'}
// Line 349:
{isValidCoord(row.latitude, row.longitude) ? fmtNumber(row.longitude, 6) : '—'}
```

Apply the same `typeof` guard to ALL coordinate checks on this page:
- Line 247: `hasValidLocation` — add `typeof latest.latitude === 'number'`
- Line 339/349: table LAT/LON columns
- Line 611-612: Current Location card
- Home/Work Status cards (lines 629, 641)

Also apply to **MapOverviewPage.tsx** (Bug 4) and **LocationsPage.tsx** — any page that
checks `!== 0` on coordinates needs the `typeof` guard.

---

## Bug 6 — Speed Profile: Summary cards have unequal heights

**Page:** `web/src/features/driving/pages/SpeedProfilePage.tsx`
**Screenshot:** The 3 speed bucket cards (0-15, 45-60, 90-105) have different heights.
Cards with efficiency data show 4 rows (Time, Drives, Avg Speed, Wh/mi) while others
show only 2 rows (Time, Drives).

**Root Cause:** The `{effData && (...)}` block at line 213 conditionally renders extra rows,
but the grid parent (line 189) doesn't enforce equal height:
```tsx
<StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
```

**Fix:** Add `items-stretch` and make each `<GlassPanel>` fill its grid cell:

```tsx
// Line 189: add items-stretch (default for grid, but ensure it)
<StaggerContainer className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">

// Line 196-197: make StaggerItem + GlassPanel fill height
<StaggerItem key={range} className="h-full">
  <GlassPanel className="p-4 h-full flex flex-col">
    ...
    <div className="space-y-2 flex-1">
      {/* existing rows */}
    </div>
  </GlassPanel>
</StaggerItem>
```

This makes all cards stretch to the tallest card's height.

---

## Bug 7 — Battery Cells: MIN/MAX CELL shows "#undefined"

**Page:** `web/src/features/battery/pages/BatteryCellsPage.tsx`
**Screenshot:** MIN CELL shows "#undefined 4.1240 V", MAX CELL shows "#undefined 4.1300 V".

**Root Cause:** Field name mismatch. The API returns `cell_id` (from `frontendCell` struct
in `battery_cells_handler.go:275`) but the frontend interface uses `cell_number`:

API (`frontendCell`):
```go
CellID      int     `json:"cell_id"`
```

Frontend (`CellReading` line 32):
```typescript
cell_number: number;
```

After `camelCaseKeys`: response has `cellId`/`cell_id` — neither matches `cell_number`.
So `minCell.cell_number` is `undefined` → displays "#undefined".

**Fix:** Update the frontend interface to match the API:
```typescript
interface CellReading {
  cell_id: number;       // was cell_number
  module: number;
  voltage: number;
  temperature: number;
  delta_from_avg?: number;
}
```

Then update ALL references from `cell_number` to `cell_id`:
- Line 142: `key={cell.cell_id}`
- Line 148, 150: `cell.cell_id`
- Line 317: `useSortToggle('cell_id', 'asc')`
- Line 329, 333: `key: 'cell_id'`, `r.cell_id`
- Line 407, 413: `minCell.cell_id`, `maxCell.cell_id`
- Line 476: `dataKey="cell_id"`
- Line 692: `keyExtractor={(r) => r.cell_id}`

---

## Bug 8 — Charging Curve: Summary card text overflows card boundaries

**Page:** `web/src/features/charging/pages/ChargingCurvePage.tsx`
**Screenshot:** 6 summary cards in a row (TOTAL SESSIONS, TOTAL ENERGY, AVG CHARGE RATE,
PEAK RATE, AVG DURATION, TOTAL COST) — text overflows card edges at narrow widths.

**Root Cause:** The `SummaryCard` component (line 141-167) uses `text-2xl` for values
without overflow protection. At `xl:grid-cols-6`, each card is narrow and values like
"214.20 kWh" overflow.

**Fix:** Add text truncation and responsive font sizing to `SummaryCard`:
```tsx
function SummaryCard({ label, value, unit, loading, className }) {
  return (
    <GlassPanel className={cn('p-4 min-w-0 overflow-hidden', className)}>
      <p className="text-xs uppercase tracking-wider text-white/50 truncate">{label}</p>
      {loading ? (
        <Skeleton className="mt-1 h-7 w-20" />
      ) : (
        <p className="mt-1 text-lg xl:text-2xl font-semibold text-white truncate">
          {value}
          {unit && <span className="ml-1 text-xs xl:text-sm text-white/60">{unit}</span>}
        </p>
      )}
    </GlassPanel>
  );
}
```

Key changes:
- `min-w-0` on GlassPanel — allows flex/grid items to shrink below content width
- `truncate` on both label and value — clips with ellipsis instead of overflow
- `text-lg xl:text-2xl` — smaller font on narrower screens

---

## Bug 9 — Maintenance: Only summary cards visible, all other panels blank/missing

**Page:** `web/src/features/vehicle-systems/pages/MaintenancePage.tsx`
**Screenshot:** Shows 4 summary cards (Total Items: 8, Due Soon: 0, Overdue: 0, Completed: 0)
but everything below is blank — no maintenance items grid, no cost summary, no service history.

The old page (`D:\repos\teslasync-old\web\src\pages\Maintenance.tsx`) had 6 full sections:
1. Service Overview Cards
2. Overdue Alert Banner
3. Upcoming Maintenance (items with progress bars)
4. Maintenance Schedule Table (all 8 items with intervals, last service, status)
5. Log Service Form (add new service record)
6. Service History Log + Estimated Annual Cost vs ICE comparison

**Root Cause:** The refactored page has these sections in code (lines 542-680) but they render
as blank/invisible. Investigate:

1. **Items grid (line 542-563):** `filteredItems` should have 8 items. Check if
   `MaintenanceItemCard` renders correctly — might have invisible styling or a silent error
   in `ProgressBar`/`CategoryBadge` components.

2. **Cost Summary (line 565-606):** `costStats` is null when no service records exist →
   shows EmptyState. But the EmptyState might be invisible or missing.

3. **Service History (line 652-680):** `records` likely empty → shows empty table.

4. **Missing from old page:** The "Log Service Form" section (add new record with item picker,
   date, mileage, cost, notes) is missing from the refactored page. The old page stored
   records in `localStorage` (`STORAGE_KEY`). Check if the new page relies on an API that
   returns empty.

**Fix:**
1. Debug render: temporarily add visible borders to each section to see which ones render
2. Ensure `MaintenanceItemCard` renders visibly (check text colors, backgrounds)
3. Restore "Log Service" form from old page if missing
4. Add visible EmptyState messages for each section when data is missing
5. Ensure all panels always show (not conditionally hidden when empty)

---

## Bug 10 — Security & Access: Only summary cards visible, 7 sections missing

**Page:** `web/src/features/admin/pages/SecurityAccessPage.tsx` (701 lines)
**Old:** `D:\repos\teslasync-old\web\src\pages\SecurityAccess.tsx` (780 lines)
**Screenshot:** Shows 4 summary cards (Current Status: Unsecure, Last Lock Change: 1h ago,
Sentry Uptime: 100%, Total Events: 31) + alert banner, then completely blank below.

**Missing sections from old page:**
1. **SVG Vehicle Diagram** — animated car outline with color-coded lock/door/window/sentry indicators
2. **Status Detail Cards** (2x3 grid) — Lock Status, Sentry Mode, Doors, Windows, HomeLink, Guest Mode
3. **Window Status Detail** — 4 individual window panels (FD, FP, RD, RP) with state badges
4. **Security Features Grid** (10 panels) — Speed Limit, Valet Mode, PIN to Drive, Parental Controls, Guest Mode, Remote Access, Service Mode, Auto Lock, Dashcam, Sentry Sound
5. **Security Stats** — Sentry Uptime %, Door Open Events, Window Open Events
6. **Sentry Mode Activity Chart** — stacked bar chart (sentry on/off per day)
7. **Security Event Timeline** — recent lock/unlock/door/window/sentry events with icons

**Fix:** The refactored page likely has these sections in code but they're not rendering
(same pattern as Maintenance Bug 9). Investigate:
1. Check if sections exist in the 701-line file but are conditionally hidden
2. If sections are missing, restore from old page at
   `D:\repos\teslasync-old\web\src\pages\SecurityAccess.tsx`
3. Use shared components (`GlassPanel`, `Badge`, `MetricCard`, `ChartContainer`) per guardrails
4. Ensure all sections always render (with EmptyState when no data)

---

## Bug 11 — Safety Settings: Missing details compared to pre-refactoring

**Page:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx` (568 lines)
**Old:** `D:\repos\teslasync-old\web\src\pages\SafetySettings.tsx` (573 lines)
**Screenshots:** Prod (before) shows full Safety Score gauge, 7 feature toggle cards (AEB,
Blind Spot, Forward Collision, Lane Departure, Speed Limit, Blind Spot Warning, Emergency
Lane), 4 stat summary cards, history table, settings timeline chart, and Autopilot detail
panel. Refactored version shows much less content.

**Root Cause:** The refactored page has the sections in code (lines 460-603) but they only
render when `latest` is truthy (line 461: `{!isLoading && latest && ( ... )}`). If the
`/safety/latest` API returns data but with different field names after `camelCaseKeys`, or
returns a wrapped response, `latest` might be populated but individual fields like
`latest.automatic_emergency_braking_off` become `undefined` after camelCase transformation.

The `SafetySnapshot` interface uses snake_case (`automatic_emergency_braking_off`,
`automatic_blind_spot_camera`, etc.) but `camelCaseKeys` transforms them to camelCase
(`automaticEmergencyBrakingOff`, `automaticBlindSpotCamera`). The code accesses snake_case
which returns `undefined` → all features show as disabled/missing.

**Fix:**
1. Check what `/safety/latest?vehicle_id=X` actually returns — curl it
2. Update field access to handle both snake_case and camelCase:
   ```typescript
   const aebOff = latest.automatic_emergency_braking_off ?? latest.automaticEmergencyBrakingOff;
   ```
3. Or update the interface to use camelCase and access camelCase fields
4. Compare section-by-section with old page and restore any missing panels
5. Ensure all feature cards render with proper enabled/disabled states

---

## Bug 12 — Media Player: Only "Now Playing" card, 6 sections missing

**Page:** `web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx` (524 lines)
**Old:** `D:\repos\teslasync-old\web\src\pages\MediaPlayer.tsx` (500 lines)
**Screenshot:** Shows only "No track · Playing" card with progress bar. Everything else blank.

**Missing sections from old page:**
1. **Equalizer Visualization** — animated bars when playing
2. **Volume Gauge** — SVG arc gauge with current volume level
3. **Listening Stats Cards** (3) — Unique Tracks, Top Source, Avg Volume
4. **Playback History Table** — track name, artist, source, volume, duration, timestamp
5. **Volume Over Time Chart** — line chart of volume history
6. **Source Distribution Pie Chart** — Spotify vs Radio vs USB vs Bluetooth breakdown
7. **Listening Stats Summary** — 3-panel summary grid

**Fix:** Compare with old page at `D:\repos\teslasync-old\web\src\pages\MediaPlayer.tsx` and
restore missing sections. The refactored page likely has sections in code but they're
conditionally hidden or have data binding issues.

---

## Verification

```bash
cd web && npx tsc --noEmit

# After fix, selecting signals + clicking Explore should:
# 1. Fetch each signal's history in parallel
# 2. Show chart with all selected signals overlaid
# 3. Show data table with merged results
```

**COMPLETION DEFINITION:**
- [ ] Signal Explorer: clicking Explore fetches per-signal history and merges results
- [ ] Signal Explorer: Explore button aligned with Per Page dropdown (no mt-5)
- [ ] Signal Log Viewer: Query fetches per-signal history (same fix as Explorer)
- [ ] Signal Log Viewer: Query button aligned (remove mt-5, items-end)
- [ ] Live Map: guard against undefined lat/lng (typeof check before rendering MapContainer)
- [ ] Live Map: investigate and fix why latest.latitude is undefined
- [ ] Navigation: Location History shows "—" not "0.000000" — add typeof guard to all coord checks
- [ ] All map pages: use consistent `isValidCoord(lat, lng)` helper with typeof + !== 0 check
- [ ] Speed Profile: summary cards equal height (h-full + flex-col on GlassPanel)
- [ ] Battery Cells: fix #undefined — use cell_id instead of cell_number (11 references)
- [ ] Charging Curve: SummaryCard text overflow — add min-w-0, truncate, responsive text size
- [ ] Maintenance: all sections visible — items grid, cost summary, service history, log form
- [ ] Security & Access: restore 7 missing sections (vehicle diagram, status cards, windows, features, stats, sentry chart, timeline)
- [ ] Safety Settings: fix field access for camelCase transform, restore all feature cards + stats + chart
- [ ] Media Player: restore 6 missing sections (equalizer, volume gauge, stats, history table, charts)
- [ ] Signal Explorer: chart renders with selected signals overlaid
- [ ] Signal Explorer: table shows merged data
- [ ] TypeScript compiles clean
