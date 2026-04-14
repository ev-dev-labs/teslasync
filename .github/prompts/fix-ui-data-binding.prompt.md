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

## Bug 3b — Navigation & Route Page: Current Location 0,0 + Location History all zeros

**Page:** `web/src/features/maps/pages/NavigationRoutePage.tsx`

Same GPS root cause as Bug 2/3 — all positions are lat=0, lng=0.

**Issues visible:**
1. **Current Location card** shows "0.0000, 0.0000 · — 0 mph" — must NOT display 0,0.
   When lat=0 AND lng=0, show "Location unavailable" or "—" instead of raw zeros.
2. **Home Status** shows "At Home" ✅ — false positive because 0,0 matches as "home"
   (or default). When no valid GPS, Home/Work status should show "Unknown" or "—".
3. **Location History table** shows `0.000000` for every LAT/LON, `0.0 mph` speed,
   `0° —` heading, `0.0 mi` odometer.
4. **Speed Profile chart** is empty (no data at all — same underlying data issue).

**Fix:**
1. Treat lat=0 AND lng=0 as "no location data":
```typescript
const hasValidLocation = latest && (latest.latitude !== 0 || latest.longitude !== 0);
```
2. Current Location card: show "Location unavailable" when `!hasValidLocation`
3. Home/Work Status: show "Unknown" when no valid GPS
4. Location History table: show "—" instead of "0.000000" when lat/lng are 0
5. Add info banner when all positions have zero coordinates
6. Filter out 0,0 positions from charts

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

## Bug 10 — Speed Profile: Crashes with "Cannot read properties of undefined (reading 'match')"

**Page:** `web/src/features/driving/pages/SpeedProfilePage.tsx`
**Screenshot:** Error boundary: "Cannot read properties of undefined (reading 'match')"

**Root Cause:** Complete field name mismatch between API and frontend.

API response (`internal/api/speed_profile_handler.go`) returns:
```json
{"distribution": [{"speed_bucket": "0-15", "readings": 42, "avg_power_kw": 3.5}]}
```
After `camelCaseKeys`: `speedBucket`, `readings`, `avgPowerKw`

But the frontend expects:
- `b.range` (line 98, 169, 186) → should be `b.speed_bucket` or `b.speedBucket`
- `b.percentage` (line 169) → doesn't exist, needs to be computed from `readings`
- `b.driveCount` (line 169) → should be `b.readings`

**Fix:**
1. Update line 98 and all references to use actual API field names:
```typescript
// Before: const parts = r.range.match(/(\d+)/g);
const parts = (r.speedBucket ?? r.speed_bucket ?? '').match(/(\d+)/g);
```

2. Fix the bar chart data mapping (line 169):
```typescript
// Before:
.map((b) => ({ range: b.range, pct: b.percentage, count: b.driveCount }))
// After:
.map((b) => ({ range: b.speedBucket ?? b.speed_bucket, pct: b.readings, count: b.readings }))
```

3. Fix all other references to `bucket.range` in the summary cards section (line 186+):
```typescript
bucket.speedBucket ?? bucket.speed_bucket  // instead of bucket.range
```

4. If percentage is needed, compute it from total readings:
```typescript
const totalReadings = distribution.reduce((s, b) => s + (b.readings ?? 0), 0);
// pct = totalReadings > 0 ? (b.readings / totalReadings) * 100 : 0
```

---

## Bug 11 — Drive Detail: "Invalid Date" on all chart X-axes + Tire Pressure empty

**Page:** `web/src/features/driving/pages/DriveDetailPage.tsx`
**Screenshot:** Every chart (Speed, SOC%, Temperatures, Power Profile, Elevation) shows
"Invalid Date" on X-axis. "Tire Pressure During Drive" shows "No telemetry data available".

**Root Cause A — Invalid Date:** The chart data mapping (line 135) uses:
```typescript
time: new Date(tp.timestamp).toLocaleTimeString(...)
```
But the API model (`DriveTelemetryReading`) has `created_at`, NOT `timestamp`.
After `camelCaseKeys`, the field is `createdAt` (or `created_at`).
`tp.timestamp` is `undefined` → `new Date(undefined)` → "Invalid Date".

**Fix A:** Change line 135:
```typescript
time: new Date(tp.createdAt ?? tp.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
```

**Root Cause B — Tire Pressure empty:** The tire pressure fields (`tire_pressure_fl` etc.)
are likely NULL in the `drive_telemetry_readings` table because the Fleet Telemetry signal
`TirePressure` is NOT being captured into drive telemetry readings during drive flushes.

Check `internal/api/telemetry_sessions.go` `flushDriveTelemetry()` — verify it reads
`TirePressureFl`/`TirePressureFr`/`TirePressureRl`/`TirePressureRr` from accumulated signals
and writes them to the `tire_pressure_fl`/`fr`/`rl`/`rr` columns. The signal names from
Fleet Telemetry are likely different (e.g. `TirePressure` compound signal or individual
`TPMSFL`/`TPMSFR`/`TPMSRL`/`TPMSRR`).

**Fix B:** In `flushDriveTelemetry()`, map the correct Fleet Telemetry signal names:
```go
reading.TirePressureFL = toFloatPtr(signals["TPMSFL"])   // or "TirePressureFl"
reading.TirePressureFR = toFloatPtr(signals["TPMSFR"])
reading.TirePressureRL = toFloatPtr(signals["TPMSRL"])
reading.TirePressureRR = toFloatPtr(signals["TPMSRR"])
```
Check actual signal names in the export: `grep "TPMS\|TirePressure" scripts/signals-export.json`.

---

## Bug 12 — Trip Replay: Empty when all positions are 0,0

**Page:** `web/src/features/driving/pages/TripReplayPage.tsx`
**Screenshot:** Clicking "Replay" on Drive Detail opens Trip Replay but nothing happens — blank map,
no playback, no trail.

**Root Cause:** The page correctly filters out 0,0 positions (line 120-122):
```typescript
return pos.filter((p) => p.latitude !== 0 || p.longitude !== 0);
```
Since ALL positions have lat=0,lng=0 (GPS data issue), the filtered array is empty →
`useTripReplay([])` has nothing to animate → blank page.

**Fix:** Show an informative empty state instead of a blank page:
```typescript
if (positions.length === 0 && !isLoading) {
  return (
    <PageContainer title={t('replay.title', 'Trip Replay')}>
      <EmptyState
        icon={<MapPin className="h-10 w-10" />}
        message={t('replay.noGps', 'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.')}
      />
    </PageContainer>
  );
}
```

Also on **Drive Detail page** (line that links to replay), disable the Replay button when no
valid positions exist:
```typescript
<Button disabled={!hasValidPositions} ...>Replay</Button>
```

---

## Bug 12b — Drive Detail: SOC shows raw unformatted float

**Page:** `web/src/features/driving/pages/DriveDetailPage.tsx`
**Screenshot:** SOC card shows "85.9269662921..." instead of "86%". The raw float value is
displayed without rounding or formatting.

**Fix:** Use `fmtInt()` or `fmtNumber()` for SOC display:
```typescript
// Instead of showing raw soc value:
fmtInt(drive.startSoc) + '% → ' + fmtInt(drive.endSoc) + '%'
```

---

## Bug 13 — Trips Page: Empty despite 6 completed drives

**Page:** `web/src/features/trips/pages/TripListPage.tsx`
**Screenshot:** "No trips recorded yet" — Total Trips: 0, Total Distance: 0 mi. But the
`drives` table has 6 rows and the Drives page shows them.

**Root Cause:** The `trips` table is empty (0 rows, confirmed via DB query). Nothing in the
codebase automatically creates trips from completed drives.

The refactored code has `internal/app/tripsvc/service.go` with `Create()` but:
1. The telemetry session tracker (`telemetry_sessions.go`) creates drives but never calls
   `tripsvc.Create()` to group consecutive drives into trips.
2. The v1 trip handler is commented out in the router (line 714):
   ```go
   // NOTE: /trips conflicts with legacy tripHandler above; skip new trip handler.
   ```
3. The legacy `tripHandler.List` queries the `trips` table directly, which stays empty.

**Fix:** Wire automatic trip creation when a drive ends. In `telemetry_sessions.go` where
drives are finalized (the `endDrive()` or `closeDrive()` method):

1. After closing a drive, check if it should be grouped into an existing trip or create a new one:
```go
// After drive is closed:
// If the previous drive ended < 30 minutes ago, add this drive to the same trip.
// Otherwise create a new trip containing just this drive.
func (t *TelemetrySessionTracker) maybeCreateTrip(ctx context.Context, vehicleID int64, driveID int64) {
    // Query last trip for this vehicle
    lastTrip := t.tripRepo.GetLatestForVehicle(ctx, vehicleID)
    if lastTrip != nil && time.Since(lastTrip.EndDate) < 30*time.Minute {
        // Add drive to existing trip
        t.tripRepo.AddDriveToTrip(ctx, lastTrip.ID, driveID)
        t.tripRepo.UpdateTripStats(ctx, lastTrip.ID)
    } else {
        // Create new trip with this drive
        t.tripRepo.CreateFromDrive(ctx, vehicleID, driveID)
    }
}
```

2. Or add a periodic background job that scans for un-tripped drives and groups them.

3. Also resolve the router conflict — either remove the legacy tripHandler or register
   the v1 handler on a different path.

---

## Bug 14 — Mileage Page: All zeros despite data in DB

**Page:** `web/src/features/analytics/pages/MileagePage.tsx`
**Screenshot:** Current Odometer: 0, Month Distance: 0, Daily Avg: 0.00, Annual Projection: 0.
Charts empty. Monthly Summary shows Distance: 0.00. Subtitle shows raw "Mileage Subtitle".

**Root Cause:** Complete field name mismatch between API response and frontend interface.

API `/mileage/stats` (`internal/database/mileage_repo.go:105-112`) returns:
```json
{"total_distance": 16158, "avg_daily": 16158, "max_daily": 16158, "total_energy": 0, "total_drives": 0, "days_tracked": 1}
```

Frontend `MileageStats` interface (line 34-40) expects:
```typescript
interface MileageStats {
  current_odometer: number;   // ❌ not in API response
  month_distance: number;     // ❌ API has total_distance
  daily_avg: number;          // ❌ API has avg_daily
  annual_projection: number;  // ❌ not in API response
  entries: MileageEntry[];    // ❌ not in API response
}
```

After `camelCaseKeys`, API fields become `totalDistance`, `avgDaily`, `maxDaily`, etc. —
NONE match the interface. `stats?.current_odometer` is `undefined` → displays 0.

**Fix:** Update the interface to match the actual API response:
```typescript
interface MileageStats {
  total_distance: number;   // or totalDistance after camelCase
  avg_daily: number;        // or avgDaily
  max_daily: number;        // or maxDaily
  total_energy: number;     // or totalEnergy
  total_drives: number;     // or totalDrives
  days_tracked: number;     // or daysTracked
}
```

Then update the metric cards:
```typescript
// Current Odometer → needs a separate query or use latest odometer from daily_mileage
value={fmtInt(stats?.totalDistance ?? stats?.total_distance)}  // for Total Distance
value={fmtNumber(stats?.avgDaily ?? stats?.avg_daily)}         // for Daily Avg
// Annual projection: compute as avg_daily * 365
value={fmtInt((stats?.avgDaily ?? stats?.avg_daily ?? 0) * 365)}
```

Also: add `/mileage/stats` endpoint fields for `current_odometer` (latest odometer_end)
and `month_distance` (SUM for current month only), or compute them in the frontend.

Also fix: subtitle "Mileage Subtitle" → `t('mileage.subtitle', 'Daily and monthly distance tracking')`.

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
- [ ] Navigation & Route: "Location unavailable" for 0,0 Current Location card, "Unknown" Home/Work status, "—" in table, filter 0,0 from charts
- [ ] Speed Profile: fix crash — use actual API field names (speedBucket/readings, not range/percentage/driveCount)
- [ ] Drive Detail: fix "Invalid Date" — use createdAt/created_at instead of timestamp
- [ ] Drive Detail: wire tire pressure signals into flushDriveTelemetry (check TPMS signal names)
- [ ] Drive Detail: SOC display formatted with fmtInt, not raw float
- [ ] Trip Replay: show EmptyState with GPS info when no valid positions, disable Replay button on Drive Detail
- [ ] Trips: wire automatic trip creation from completed drives (tripsvc.Create never called)
- [ ] Mileage: fix interface to match API fields (total_distance/avg_daily, not current_odometer/month_distance)
- [ ] Mileage: fix subtitle "Mileage Subtitle" → proper i18n fallback
- [ ] Map Overview: real Leaflet map rendered (not placeholder), using shared MapContainer/MapTileLayer
- [ ] TypeScript compiles clean
