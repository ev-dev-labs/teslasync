---
description: "Fix UI data binding bugs — TirePressure NaN/zero, Map 0,0 positions, Locations empty"
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
- [ ] TypeScript compiles clean
