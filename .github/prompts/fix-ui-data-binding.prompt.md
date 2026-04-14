---
description: "Fix UI data binding bugs — TirePressure, Map, Locations, FSM Debugger, Signal Log/Explorer/Diff"
---

# Fix: UI Data Binding Bugs Found During Signal Replay Testing

> **NOTE:** Timeline blank columns (Bug 2 in original) was already fixed in commit 8a66ba7
> (`fix(api,web): fix FSM state flapping and wire transition logging`). Do NOT touch TimelinePage.tsx.

## Bug 1 — Tire Pressure: NaN gauges + all zeros

**Page:** `web/src/features/vehicle-systems/pages/TirePressurePage.tsx`
**Screenshot:** 4 gauges show "NaN", history table shows "0.00 Bar Unit" for all rows

**Root Cause:** Field name mismatch. API returns `front_left`/`front_right`/`rear_left`/`rear_right`
but the page interface expects `tpms_pressure_fl`/`tpms_pressure_fr`/`tpms_pressure_rl`/`tpms_pressure_rr`.

**API response (confirmed working):**
```json
{"id":28, "vehicle_id":1, "front_left":3.05, "front_right":3.05, "rear_left":3.075, "rear_right":3.05, "created_at":"2026-04-14T13:17:09Z"}
```

**Page interface (line 30-36):**
```typescript
interface TirePressureReading {
  // ...
  tpms_pressure_fl: number;  // ❌ should be front_left
  tpms_pressure_fr: number;  // ❌ should be front_right
  tpms_pressure_rl: number;  // ❌ should be rear_left
  tpms_pressure_rr: number;  // ❌ should be rear_right
}
```

**Fix:**
1. Update the interface to match the API:
```typescript
interface TirePressureReading {
  id: number;
  vehicle_id: number;
  front_left: number;
  front_right: number;
  rear_left: number;
  rear_right: number;
  created_at: string;
}
```

2. Update `getTirePressureValue` (line 60-68):
```typescript
function getTirePressureValue(reading: TirePressureReading, position: TirePosition): number {
  const map = {
    fl: reading.front_left,
    fr: reading.front_right,
    rl: reading.rear_left,
    rr: reading.rear_right,
  };
  return map[position] ?? 0;
}
```

3. Update ALL references to `tpms_pressure_fl/fr/rl/rr` throughout the page — search and replace.

4. Fix the page title — shows "Title" / "Subtitle" instead of proper text. Ensure PageContainer
   uses `t('tirePressure.title', 'Tire Pressure')` and `t('tirePressure.subtitle', '...')`.

5. Fix unit display — shows "Bar Unit" instead of the actual unit. Check `pressureUnit` from `useSettings()`.

---

## Bug 2 — Map Overview (Live Map): All positions show 0,0 coordinates

**Page:** `web/src/features/maps/pages/MapOverviewPage.tsx`
**Screenshot:** Recent Location History table shows LAT=0.0000, LON=0.0000 for all rows.
Map shows marker at 0,0 (Gulf of Guinea).

**Root Cause:** The `positions` table has 1,349 rows but ALL have `latitude=0, longitude=0`.
GPS coordinates come from the `Location` compound signal which is sent via the Fleet Telemetry
**HTTP dispatcher** — not via MQTT. Our signal replay only uses MQTT, so no GPS data arrives.

The prod version works because it receives `Location: {latitude: X, longitude: Y}` via
`POST /api/v1/telemetry` (HTTP endpoint from fleet-telemetry config).

**This is NOT a code bug.** But the page should handle it gracefully.

**Fix:**
1. When latest position has `latitude=0 AND longitude=0`, treat it as "no location data":
```typescript
const hasValidLocation = latest && (latest.latitude !== 0 || latest.longitude !== 0);
```

2. Show info banner when no GPS:
```typescript
{!hasValidLocation && (
  <AlertBanner variant="info">
    {t('map.noGps', 'GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.')}
  </AlertBanner>
)}
```

3. Don't render the map or marker at 0,0 — show EmptyState with map icon instead.

4. In the "Recent Location History" table, show "—" instead of "0.0000" when lat/lng are 0:
```typescript
render: (row) => row.latitude !== 0 ? fmtNumber(row.latitude, 5) : '—'
```

---

## Bug 3 — Locations Page: Empty (same GPS issue)

**Page:** `web/src/features/maps/pages/LocationsPage.tsx`

Same root cause as Bug 3 — no GPS data from MQTT-only replay.

**Fix:** Add info banner:
```typescript
import { AlertBanner } from '@/components/feedback';

<AlertBanner variant="info" className="mb-4">
  {t('locations.noGpsInfo', 'Location data requires Fleet Telemetry streaming. GPS coordinates are not available via MQTT signals alone.')}
</AlertBanner>
```

---

## Bug 3b — Navigation & Route Page: Location History all zeros

**Page:** `web/src/features/maps/pages/NavigationRoutePage.tsx`

Same GPS root cause as Bug 2/3 — all positions are lat=0, lng=0.
The Location History table shows `0.000000` for every LAT/LON, `0.0 mph` speed, `0° —` heading, `0.0 mi` odometer.

**Fix:** Apply the same graceful handling as Bug 2:
1. Show "—" instead of "0.000000" when lat/lng are 0
2. Add info banner when all positions have zero coordinates
3. Filter out 0,0 positions from the Home/Work Presence chart (they're not real locations)

---

## Bug 4 — FSM Debugger: Duplicate time range controls

**Page:** `web/src/features/system/pages/StateMachineDebuggerPage.tsx`
**Screenshot:** Both a `<Select>` dropdown ("Last 1 hour") AND quick-toggle buttons (1h, 6h, 24h, 7d) are shown for the same Time Range filter.

**Fix:** Remove the quick-toggle button group (lines ~360-376). Keep only the `<Select>` dropdown for Time Range.

Remove this block:
```tsx
<div className="flex items-end gap-2">
  <div className="flex flex-wrap gap-1.5">
    {HOURS_OPTIONS.map((opt) => (
      <Button
        key={opt.value}
        size="sm"
        variant={hours === opt.value ? 'primary' : 'ghost'}
        onClick={() => {
          setHours(opt.value);
          setServerPage(1);
        }}
      >
        {opt.value === '1' ? '1h' : opt.value === '6' ? '6h' : opt.value === '24' ? '24h' : '7d'}
      </Button>
    ))}
  </div>
</div>
```

---

## Bug 5 — FSM Debugger: Transition Distribution & Counts show duplicate entries

**Page:** `web/src/features/system/pages/StateMachineDebuggerPage.tsx`
**Screenshot:** Pie chart shows `vehicle_state` (19) AND `vehicleState` (19) as separate slices.
Transition Counts table shows both as separate rows with identical counts.

**Root Cause:** `web/src/lib/resilience.ts` lines 19-33 — the `camelCaseKeys()` response transformer
keeps BOTH the original snake_case key AND adds a camelCase duplicate. The `/fsm/stats` endpoint
returns `{"stats": {"vehicle_state": 19}}`. After transformation it becomes:
```json
{"stats": {"vehicle_state": 19, "vehicleState": 19}}
```

The `stats` record keys are **data values** (FSM type names from the DB), not structural JSON
field names. The transformer incorrectly treats them as field names and duplicates them.

**Fix:** Deduplicate in the page where stats are consumed. In `StateMachineDebuggerPage.tsx`:

1. Filter the `pieData` computation (line ~150-158) to skip camelCase duplicates:
```typescript
const pieData = useMemo(() => {
  const seen = new Set<string>();
  return Object.entries(stats)
    .filter(([name]) => {
      // Skip camelCase duplicates created by the response transformer
      if (!name.includes('_') && Object.prototype.hasOwnProperty.call(stats, name.replace(/[A-Z]/g, m => '_' + m.toLowerCase()))) {
        return false;
      }
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    })
    .map(([name, value], i) => ({
      name,
      value,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
}, [stats]);
```

2. Apply the same filter to `summaryRows` computation (line ~169).

3. **Alternative simpler approach:** Filter stats ONCE before both computations:
```typescript
const cleanStats = useMemo(() => {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    // Keep only snake_case keys (original from API), skip camelCase duplicates
    if (key.includes('_') || !Object.keys(stats).some(k => k.includes('_') && k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()) === key)) {
      result[key] = value;
    }
  }
  return result;
}, [stats]);
```
Then use `cleanStats` instead of `stats` for both `pieData` and `summaryRows`.

---

## Bug 5b — FSM Debugger: Transition Distribution should show actual states, not FSM type names

**Page:** `web/src/features/system/pages/StateMachineDebuggerPage.tsx`

The Transition Distribution pie chart currently shows the `fsm_name` (e.g. "vehicle_state") — which
is the FSM type, NOT the actual states (driving, charging, parked, online, etc.).

**Fix:** Change the pie chart to show distribution of `to_state` values from the transitions:
```typescript
const pieData = useMemo(() => {
  const byState = new Map<string, number>();
  for (const tr of transitions) {
    byState.set(tr.to_state, (byState.get(tr.to_state) ?? 0) + 1);
  }
  return Array.from(byState.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({
      name,
      value,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
}, [transitions]);
```

This shows actual state distribution (how many times vehicle transitioned TO each state).

---

## Bug 6 — Signal Log, Signal Explorer, Signal Diff: No signal names in search/dropdown

**Pages:**
- `web/src/features/telemetry/pages/SignalLogViewerPage.tsx` — typing in Signals search shows nothing
- `web/src/features/telemetry/pages/SignalExplorerPage.tsx` — "Search signals…" shows nothing
- `web/src/features/telemetry/pages/SignalDiffPage.tsx` — "Select a signal..." dropdown is empty

**Root Cause (two issues):**

**Issue A — API response type mismatch:**
The `useSignals` hook in `web/src/api/hooks/useTelemetry.ts` line 19:
```typescript
queryFn: () => request<string[]>(`/signals/${vehicleId}/available`),
```
expects a raw `string[]`, but the API handler (`internal/api/signal_handler.go:106`) returns:
```json
{"vehicle_id": 1, "count": 42, "signals": ["ACChargingEnergyIn", "BatteryLevel", ...]}
```
After `camelCaseKeys` transforms it, the hook receives an **object**, not an array.
`safeArray` then returns `[]`.

**Fix A:** Update the hook to extract `.signals` from the response:
```typescript
export function useSignals(vehicleId: number) {
  return useQuery({
    queryKey: telemetryKeys.signals(vehicleId),
    queryFn: async () => {
      const resp = await request<{ signals: string[] }>(`/signals/${vehicleId}/available`);
      return resp.signals ?? [];
    },
    enabled: vehicleId > 0,
    staleTime: 60_000,
    select: safeArray,
  });
}
```

**Issue B — MongoDB dependency:**
`GetAvailableSignals()` in `internal/database/signal_log_repo.go:180` queries MongoDB's
`signal_log` collection via `Distinct("signal")`. If MongoDB is not running or has no data,
this returns empty. And if `signalLogRepo == nil` (MongoDB not configured), the handler
returns HTTP 503.

**Fix B:** Add a PostgreSQL fallback in the signal handler. If MongoDB is unavailable or returns
empty, query distinct signal names from `vehicle_live_state` columns that have non-null values:
```go
// Fallback: get column names from vehicle_live_state that have data
fallbackQuery := `
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'vehicle_live_state'
    AND column_name NOT IN ('id', 'vehicle_id', 'created_at', 'updated_at')
  ORDER BY column_name`
```
Or maintain a static list of known Fleet Telemetry signal names as a last resort.

---

## Bug 6b — Signal Explorer: Per Page + Explore button not right-aligned

**Page:** `web/src/features/telemetry/pages/SignalExplorerPage.tsx`

The "Per Page" dropdown and "Explore" button sit left-aligned (line ~250).

**Fix:** Add `justify-end` or `ml-auto` to push them right:
```tsx
<div className="flex items-center gap-3 justify-end">
```

---

## Bug 6c — Explore / Query buttons disabled (consequence of Bug 6)

**Pages:** SignalExplorerPage, SignalLogViewerPage

Both buttons have `disabled={!canExplore}` / `disabled={!canQuery}` where:
```typescript
const canExplore = selectedSignals.length > 0 && fromStr && toStr;
```

Since no signals can be selected (Bug 6), the buttons stay permanently disabled.
**This is fixed automatically by fixing Bug 6.** No separate code change needed.

---

## Bug 7 — Data Export: Raw i18n keys shown everywhere instead of labels

**Page:** `web/src/features/system/pages/DataExportPage.tsx`
**Screenshot:** Every label shows raw i18n key prefixes: `dataExport.types.drives`,
`dataExport.formats.csv`, `dataExport.presets.last30`, etc. Page title shows "Page Title",
section headers show "Title", format cards show "Csv Title" / "Json Title".

**Root Cause:** The page defines constants with `labelKey`/`descKey` (lines 92-123):
```typescript
{ value: 'drives', labelKey: 'dataExport.types.drives', ... }
```
Then renders with `t(et.labelKey)` (line 216) — **no fallback value**. Since i18n translation
files don't include these keys, the raw key is displayed.

Additionally, other labels use bare `t('Title')`, `t('Csv Title')`, `t('Csv Desc')` —
generic placeholder strings that aren't proper i18n keys with fallbacks.

**Fix:** Add human-readable fallback values to every `t()` call. Two approaches:

1. **Add fallbacks to the constant definitions:**
```typescript
const EXPORT_TYPES = [
  { value: 'drives', labelKey: 'dataExport.types.drives', label: 'Drives',
    descKey: 'dataExport.types.drivesDesc', desc: 'Export drive sessions, routes, and efficiency data',
    icon: Car, color: 'cyan' },
  { value: 'charging', labelKey: 'dataExport.types.charging', label: 'Charging',
    descKey: 'dataExport.types.chargingDesc', desc: 'Export charging sessions and energy data',
    icon: Zap, color: 'green' },
  // ... etc for all entries
];
// Then render: t(et.labelKey, et.label)
```

2. **Or provide inline fallbacks at every t() call site:**
```typescript
// Types
t('dataExport.types.drives', 'Drives')
t('dataExport.types.charging', 'Charging')
t('dataExport.types.analytics', 'Analytics')
t('dataExport.types.fullBackup', 'Full Backup')
t('dataExport.types.maintenance', 'Maintenance')
t('dataExport.types.energy', 'Energy')

// Formats
t('dataExport.formats.csv', 'CSV')
t('dataExport.formats.json', 'JSON')

// Presets
t('dataExport.presets.last7', 'Last 7 Days')
t('dataExport.presets.last30', 'Last 30 Days')
t('dataExport.presets.last90', 'Last 90 Days')
t('dataExport.presets.lastYear', 'Last Year')
t('dataExport.presets.allTime', 'All Time')

// Steps
t('dataExport.wizard.step1', 'STEP 1 — Select Data Type')
t('dataExport.wizard.step2', 'STEP 2 — Choose Format')
t('dataExport.wizard.step3', 'STEP 3 — Select Vehicle')
t('dataExport.wizard.step4', 'STEP 4 — Date Range')
```

3. **Fix placeholder labels:**
```typescript
// Replace generic placeholders:
t('Title') → t('dataExport.title', 'Data Export')
t('Csv Title') → t('dataExport.csvPreview', 'CSV Preview')
t('Json Title') → t('dataExport.jsonPreview', 'JSON Preview')
t('Csv Desc') → t('dataExport.csvDesc', 'Comma-separated values, compatible with Excel and Google Sheets')
t('Json Desc') → t('dataExport.jsonDesc', 'Structured JSON format for programmatic access')
```

Also fix: PageContainer `title` and `subtitle` should use proper fallbacks, not bare `t('Title')`.

---

## Bug 8 — Data Repair: "Not Found" (404)

**Page:** `web/src/features/system/pages/DataRepairPage.tsx`
**Screenshot:** Page shows "Not Found" error immediately on load.

**Root Cause:** Endpoint mismatch. The page (line 204) calls:
```typescript
queryFn: () => request<StaleData>('/data-repair/stale'),
```
But the API route (`internal/api/router.go:635`) is:
```go
r.Get("/stale-sessions", dataRepairHandler.GetStaleSessions)
```

The correct path is `/data-repair/stale-sessions`, not `/data-repair/stale`.

**Fix:** Update the query URL in DataRepairPage.tsx line 204:
```typescript
queryFn: () => request<StaleData>('/data-repair/stale-sessions'),
```

---

## Bug 9 — Map Overview (Live Map): Placeholder instead of real Leaflet map

**Page:** `web/src/features/maps/pages/MapOverviewPage.tsx`
**Screenshot:** Shows a "Map View" badge with raw coordinates and "Map requires Leaflet — showing
coordinates" note. Meanwhile DriveDetailPage renders real Leaflet maps correctly.

**Root Cause:** The page (lines 179-214) renders a static placeholder with a Lucide `<Map>` icon
instead of using the shared Leaflet map components. It was never wired up.

DriveDetailPage correctly imports from `@/components/maps`:
```typescript
import { MapContainer, MapTileLayer, MapInvalidator, MapLayerSwitcher, ... } from '@/components/maps';
```

**Fix:** Replace the placeholder with a real Leaflet map:

1. Import shared map components:
```typescript
import {
  MapContainer, Marker, Popup, useMap,
  MapTileLayer, MapInvalidator, MapLayerSwitcher,
  type MapStyle,
} from '@/components/maps';
import 'leaflet/dist/leaflet.css';
```

2. Replace the placeholder `<GlassPanel>` (lines 181-214) with:
```tsx
<GlassPanel className="relative overflow-hidden" style={{ height: 400 }}>
  {latest && (latest.latitude !== 0 || latest.longitude !== 0) ? (
    <>
      <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
      <MapContainer
        center={[latest.latitude, latest.longitude]}
        zoom={15}
        scrollWheelZoom
        className="h-full w-full"
      >
        <MapTileLayer style={mapStyle} />
        <MapInvalidator />
        <Marker position={[latest.latitude, latest.longitude]}>
          <Popup>{vehicle?.display_name ?? 'Vehicle'}</Popup>
        </Marker>
      </MapContainer>
    </>
  ) : (
    <EmptyState
      icon={<MapPin className="h-8 w-8" />}
      message={t('mapOverview.noLocation', 'No GPS data available.')}
    />
  )}
</GlassPanel>
```

3. Add `mapStyle` state: `const [mapStyle, setMapStyle] = useState<MapStyle>('dark');`

4. If positions list exists, also show the recent position trail as a `<Polyline>`.

5. Remove the "Map requires Leaflet" note — it's no longer needed.

---

## Verification

```bash
cd web && npx tsc --noEmit

# Tire Pressure — check field names match API
grep -n "front_left\|front_right\|rear_left\|rear_right" src/features/vehicle-systems/pages/TirePressurePage.tsx | head -10
# Should find matches

grep -n "tpms_pressure" src/features/vehicle-systems/pages/TirePressurePage.tsx
# Should be 0

# Timeline — check field mapping
grep -n "started_at\|from_state.*arr\|to_state.*row.state" src/features/analytics/pages/TimelinePage.tsx | head -5
# Should find matches
```

**COMPLETION DEFINITION:**
- [ ] TirePressure: interface updated to match API (front_left/front_right/rear_left/rear_right)
- [ ] TirePressure: gauges show real values, not NaN
- [ ] TirePressure: page title shows proper text, not "Title"
- [ ] TirePressure: unit display shows "PSI" or "Bar", not "Bar Unit"
- [ ] Map: graceful handling when lat=0, lng=0 (info banner, no marker at 0,0)
- [ ] Map: "—" in table instead of "0.0000" when no GPS
- [ ] Locations: info banner when no GPS data available
- [ ] FSM Debugger: only dropdown for Time Range, no duplicate button group
- [ ] FSM Debugger: no duplicate entries in pie chart or transition counts table
- [ ] FSM Debugger: pie chart shows actual state distribution (driving/charging/parked/online), not fsm_name
- [ ] Signal pages: useSignals hook extracts .signals from wrapped API response
- [ ] Signal pages: PostgreSQL fallback when MongoDB unavailable for signal names
- [ ] Signal pages: typing in signal search shows matching signal names
- [ ] Signal Diff: dropdown populated with signal names
- [ ] Signal Explorer: Per Page + Explore button right-aligned
- [ ] Data Export: all labels show human-readable text, no raw i18n key prefixes
- [ ] Data Export: PageContainer title/subtitle use proper fallbacks
- [ ] Data Repair: fix 404 — page calls wrong API endpoint
- [ ] Navigation & Route: "—" for zero lat/lng, info banner, filter 0,0 from Home/Work chart
- [ ] Map Overview: real Leaflet map rendered (not placeholder), using shared MapContainer/MapTileLayer
- [ ] TypeScript compiles clean
