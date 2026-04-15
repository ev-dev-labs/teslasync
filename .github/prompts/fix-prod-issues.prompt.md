---
description: "Fix prod issues — Signal Log Invalid Date + additional bugs found after deployment"
---

# Fix: Production Issues After Refactor Deployment

> These bugs were found on production deployment V0.32.0-RC.REFACTOR-FULL-REWRITE.

## Bug 1 — Signal Log Viewer: TIMESTAMP column shows "Invalid Date"

**Page:** `web/src/features/telemetry/pages/SignalLogViewerPage.tsx`
**Screenshot:** Signal Data table shows "Invalid Date" for both rows in the TIMESTAMP column.
Signal name and values display correctly (LocatedAtHome: false, true).

**Root Cause:** The Postgres signal history endpoint returns `"timestamp"` key but the
frontend reads `row.created_at`.

API response from `/signals/{vehicleID}/{signalName}/history` (line 88 of `signal_handler.go`):
```json
{"data": [{"timestamp": "2026-04-14T...", "value_bool": false}]}
```

Frontend (`SignalLogViewerPage.tsx` line 139) reads:
```typescript
created_at: row.created_at,  // ❌ undefined — API returns "timestamp" not "created_at"
```

After `camelCaseKeys`, the response still has `timestamp` (no underscore → no transform).
So `row.created_at` is `undefined` → `new Date(undefined)` → "Invalid Date".

**Fix (two options — pick one):**

**Option A — Fix the frontend to read `timestamp`:**
```typescript
// Line 139:
created_at: row.created_at ?? row.timestamp,
```

**Option B — Fix the API to return `created_at` (preferred — consistent with DB column name):**
```go
// signal_handler.go line 88:
p := map[string]interface{}{"created_at": row.CreatedAt}  // was "timestamp"
```

Option B is preferred because `created_at` matches the actual DB column name and all other
endpoints use `created_at` for timestamps.

Also fix `SignalExplorerPage.tsx` — likely has the same issue.

---

## Bug 2 — Live Map: "At Home" / "At Work" show "Unknown" despite receiving signals

**Page:** `web/src/features/maps/pages/MapOverviewPage.tsx`
**Screenshots:** Location Details shows "At Home: ● Unknown" and "At Work: ● Unknown" even
though `LocatedAtHome` signal is received (value: true/false via Fleet Telemetry MQTT).

**Root Cause:** Lines 302-332 gate the Home/Work display behind `hasValidLocation`:
```typescript
{!hasValidLocation
  ? t('mapOverview.unknown', 'Unknown')    // ❌ shows this because no GPS
  : latest.located_at_home
    ? t('mapOverview.yes', 'Yes')
    : t('mapOverview.no', 'No')}
```

`hasValidLocation` requires valid GPS coordinates (lat ≠ 0, lng ≠ 0), but `LocatedAtHome`
and `LocatedAtWork` are **boolean signals** that work independently of GPS. They come from
Tesla's geofencing on the car itself — no GPS data on our end is needed.

**Fix:** Don't gate Home/Work status behind GPS validity. Check the boolean fields directly:

```typescript
// At Home badge (line 302-309):
variant={latest?.located_at_home ?? latest?.locatedAtHome ? 'success' : 'neutral'}
// ...
{(latest?.located_at_home ?? latest?.locatedAtHome) === true
  ? t('mapOverview.yes', 'Yes')
  : (latest?.located_at_home ?? latest?.locatedAtHome) === false
    ? t('mapOverview.no', 'No')
    : t('mapOverview.unknown', 'Unknown')}

// At Work badge (line 326-333) — same pattern:
{(latest?.located_at_work ?? latest?.locatedAtWork) === true
  ? t('mapOverview.yes', 'Yes')
  : (latest?.located_at_work ?? latest?.locatedAtWork) === false
    ? t('mapOverview.no', 'No')
    : t('mapOverview.unknown', 'Unknown')}
```

Note: check both snake_case AND camelCase field names (`located_at_home` AND `locatedAtHome`)
because `camelCaseKeys()` adds both to the response.

Also check the **Navigation Route page** (`NavigationRoutePage.tsx`) — it likely has the
same issue with Home/Work status gated behind GPS validity.

---

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

# After fix, Signal Log Viewer timestamp column should show actual dates
# Signal Explorer chart X-axis should show actual dates
```

**COMPLETION DEFINITION:**
- [ ] Signal Log Viewer: TIMESTAMP column shows real dates, not "Invalid Date"
- [ ] Signal Explorer: chart X-axis shows real dates
- [ ] Consistent field name (`created_at`) across API and frontend
- [ ] Live Map: At Home / At Work show Yes/No from signal, not gated behind GPS
- [ ] Navigation: same fix for Home/Work status
- [ ] Go build clean
- [ ] TypeScript compiles clean
