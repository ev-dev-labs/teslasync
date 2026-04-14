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
- [ ] Signal Explorer: chart renders with selected signals overlaid
- [ ] Signal Explorer: table shows merged data
- [ ] TypeScript compiles clean
