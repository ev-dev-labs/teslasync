---
description: "Add signal freshness indicators showing 'last updated' timestamps on dashboard values"
---

# Signal Freshness Indicators

## Problem

The dashboard and vehicle state pages show current values (battery: 72%, speed: 0 mph)
but no indication of **when** the value was last updated. If Fleet Telemetry stops
sending data, the dashboard shows stale values with no visual cue. Users can't tell
if "battery 72%" is from 2 seconds ago or 2 hours ago.

## Current State

```
web/src/api/hooks/useVehicles.ts — vehicle state hooks
web/src/features/dashboard/ — dashboard pages
```

The vehicle state API response includes timestamp information, and the signal store
tracks per-signal timestamps. The `vehicle_live_state` table has an `updated_at` column.

## Task

### Step 1: Create FreshnessIndicator Component

Create `web/src/components/data-display/FreshnessIndicator.tsx`:

A small badge that shows how fresh the data is with color-coded urgency:

```tsx
interface FreshnessIndicatorProps {
  timestamp: string | null;      // ISO timestamp of last update
  staleThreshold?: number;       // seconds before "stale" (default: 120)
  offlineThreshold?: number;     // seconds before "offline" (default: 600)
  showLabel?: boolean;           // show "2m ago" text (default: true)
  size?: 'sm' | 'md';
}

// Colors:
// Fresh (< 60s):    green dot + "just now" or "30s ago"
// Recent (< 120s):  green dot + "1m ago"
// Stale (< 600s):   amber dot + "5m ago"
// Offline (> 600s): red dot + "2h ago"

export function FreshnessIndicator({ timestamp, staleThreshold = 120, offlineThreshold = 600, showLabel = true, size = 'sm' }: FreshnessIndicatorProps) {
  const age = timestamp ? Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000) : null;

  const status = age === null ? 'unknown'
    : age < staleThreshold ? 'fresh'
    : age < offlineThreshold ? 'stale'
    : 'offline';

  const dotColor = {
    fresh: 'bg-neon-green',
    stale: 'bg-neon-amber',
    offline: 'bg-neon-red',
    unknown: 'bg-white/20',
  }[status];

  const label = age === null ? '—'
    : age < 10 ? 'just now'
    : age < 60 ? `${age}s ago`
    : age < 3600 ? `${Math.floor(age / 60)}m ago`
    : `${Math.floor(age / 3600)}h ago`;

  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn('h-1.5 w-1.5 rounded-full', dotColor, status === 'fresh' && 'animate-pulse')} />
      {showLabel && (
        <span className="text-[10px] text-white/40">{label}</span>
      )}
    </span>
  );
}
```

**Auto-refresh:** Use `useEffect` with a 10-second interval to update the
relative timestamp display without re-fetching data.

### Step 2: Add to Dashboard Vehicle Card

On the dashboard, each vehicle card should show freshness:

```tsx
<FreshnessIndicator timestamp={vehicle.last_seen ?? vehicle.updated_at} />
```

Show near the vehicle name or battery level.

### Step 3: Add to Vehicle State Header on Commands Page

The Commands page vehicle header (line ~224) shows battery/range/temp. Add
freshness next to it:

```tsx
<FreshnessIndicator timestamp={state?.updated_at} />
```

### Step 4: Add to Live Signals Page

If there's a live signals / telemetry page, add per-signal freshness:
```tsx
{signals.map(s => (
  <div className="flex justify-between">
    <span>{s.name}: {s.value}</span>
    <FreshnessIndicator timestamp={s.timestamp} size="sm" />
  </div>
))}
```

### Step 5: Stale Data Warning Banner

When a vehicle's data is stale (> threshold), show a warning banner at the top
of vehicle-specific pages:

```tsx
{isStale && (
  <AlertBanner variant="warning">
    {t('vehicle.staleData', 'Vehicle data is {{age}} old. The vehicle may be asleep or offline.', { age: freshnessLabel })}
  </AlertBanner>
)}
```

Use `AlertBanner` from `@/components/feedback`.

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Green dot for fresh data (< 2 min)
- [ ] Amber dot for stale data (2-10 min)
- [ ] Red dot for offline data (> 10 min)
- [ ] Relative timestamp updates every 10 seconds
- [ ] Stale warning banner shows on vehicle pages
- [ ] No freshness indicator when timestamp is null (shows "—")

## Commit

```bash
git add -A
git commit -m "feat(web): add signal freshness indicators with stale data warnings

- Create FreshnessIndicator component with color-coded dot + relative time
- Add to dashboard vehicle cards, commands header, live signals
- Add stale data warning banner on vehicle pages
- Auto-refresh relative timestamps every 10s"
```
