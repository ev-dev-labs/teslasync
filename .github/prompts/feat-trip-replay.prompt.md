---
description: "New feature: Interactive trip replay with elevation profile — animate drive route on map with synced telemetry charts"
---

# Feature: Interactive Trip Replay with Elevation Profile

## Overview

A new page (or DriveDetail sub-feature) that replays a completed drive on a map with:
- Animated car marker moving along the route
- Synced elevation profile chart below the map
- Speed/power/battery timeline synced to the replay position
- Play/pause/speed controls (1x, 2x, 5x, 10x)
- Click anywhere on timeline or elevation chart to jump to that point

## Data Sources (ALL EXIST — no backend changes needed)

| Endpoint | Data | Hook |
|----------|------|------|
| `GET /drives/{driveID}` | DriveDetail with positions[] + telemetry[] | `useDrive(id)` in useDriving.ts |
| `GET /drives/{driveID}/positions` | DrivePosition[] (lat, lng, speed, power, elevation, battery, timestamp) | Needs new hook |
| `GET /drives/{driveID}/telemetry` | DriveTelemetryPoint[] (speed, power, battery, elevation, temps, soc) | Needs new hook |

### DrivePosition fields (already typed in `types/driving.ts`):
```typescript
interface DrivePosition {
  latitude: number;
  longitude: number;
  speed: number | null;
  power: number | null;
  batteryLevel: number;
  timestamp: string;
  elevation: number | null;
  odometer: number | null;
  // + insideTemp, outsideTemp, idealRange, ratedRange
}
```

## Step 1 — Add Missing Hooks

In `web/src/api/hooks/useDriving.ts`, add:

```typescript
export function useDrivePositions(driveId: string) {
  return useQuery({
    queryKey: ['drive-positions', driveId],
    queryFn: () => request<DrivePosition[]>(`/drives/${driveId}/positions`),
    enabled: !!driveId,
  });
}

export function useDriveTelemetry(driveId: string) {
  return useQuery({
    queryKey: ['drive-telemetry', driveId],
    queryFn: () => request<DriveTelemetryPoint[]>(`/drives/${driveId}/telemetry`),
    enabled: !!driveId,
  });
}
```

## Step 2 — Create Replay Hook

Create `web/src/hooks/useTripReplay.ts` — manages replay state:

```typescript
interface ReplayState {
  isPlaying: boolean;
  speed: 1 | 2 | 5 | 10;
  currentIndex: number;       // index into positions array
  progress: number;           // 0-1 fraction through the drive
  currentPosition: DrivePosition | null;
  elapsedTime: number;        // ms since drive start
}

interface ReplayControls {
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (speed: 1 | 2 | 5 | 10) => void;
  seekTo: (index: number) => void;
  seekToProgress: (progress: number) => void;  // 0-1
}

export function useTripReplay(positions: DrivePosition[]): [ReplayState, ReplayControls]
```

Uses `requestAnimationFrame` or `setInterval` to advance through positions.
At each tick, advances `currentIndex` by 1 (adjusted for speed multiplier).
Returns the current position for the map marker and the progress for chart cursors.

## Step 3 — Create Shared Components

### `components/maps/AnimatedMarker.tsx`
A map marker that smoothly animates between positions:

```typescript
interface AnimatedMarkerProps {
  position: [number, number];   // [lat, lng]
  heading?: number;             // rotation angle
  color?: string;
}
```

Uses Leaflet's `Marker` with CSS transition for smooth movement.
Add to `components/maps/index.ts` barrel.

### `components/charts/ElevationProfile.tsx`
An area chart showing elevation over distance/time:

```typescript
interface ElevationProfileProps {
  data: { distance: number; elevation: number; speed?: number }[];
  currentIndex?: number;        // highlight cursor position
  onClickIndex?: (index: number) => void;  // seek to position
  height?: number;
}
```

Uses `AreaChart` from `@/components/charts` with:
- Green gradient fill for elevation
- Vertical reference line at current replay position
- Click handler to seek
- Speed color overlay (optional — slow=green, fast=red)

Add to `components/charts/index.ts` barrel.

### `components/ui/PlaybackControls.tsx`
Transport-style play/pause/stop/speed controls:

```typescript
interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: 1 | 2 | 5 | 10;
  progress: number;           // 0-1
  elapsed: string;            // "12:34"
  total: string;              // "45:00"
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: 1 | 2 | 5 | 10) => void;
  onSeek: (progress: number) => void;
}
```

Shows: [⏮] [⏯] [⏹] [1x ▼] ━━━━●━━━━━ 12:34 / 45:00
Add to `components/ui/index.ts` barrel.

## Step 4 — Create TripReplayPage

Create `web/src/features/driving/pages/TripReplayPage.tsx`:

### Layout (top to bottom)

```
┌──────────────────────────────────────────────────────────┐
│  🗺 Trip Replay                                          │
│  Drive #42 — Apr 12, 2026 · Home → Office · 23.4 km     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─ Map (60% height) ──────────────────────────────────┐ │
│  │  [Leaflet map with route polyline]                  │ │
│  │  [Animated car marker at current position]          │ │
│  │  [Start pin 🟢] [End pin 🔴]                        │ │
│  │  [Map style switcher]                               │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Playback Controls ─────────────────────────────────┐ │
│  │  [⏮] [▶] [⏹]  [1x ▼]  ━━━━●━━━━━  12:34 / 45:00  │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Current Stats (live during replay) ────────────────┐ │
│  │  Speed: 65 mph  │ Power: 18 kW  │ Battery: 72%     │ │
│  │  Elevation: 245m │ Range: 189 mi │ Temp: 22°C       │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Elevation Profile ─────────────────────────────────┐ │
│  │  [Area chart: elevation over distance]              │ │
│  │  [Cursor synced to replay position]                 │ │
│  │  [Click to seek]                                    │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Speed + Power Timeline ────────────────────────────┐ │
│  │  [Dual-axis area chart: speed + power over time]    │ │
│  │  [Cursor synced to replay position]                 │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─ Drive Summary ─────────────────────────────────────┐ │
│  │  Distance │ Duration │ Efficiency │ Elev Gain/Loss  │ │
│  │  Max Speed │ Avg Speed │ Energy Used │ SOC Start→End│ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### Sections

**1. Map (largest section)**
- Full route as `Polyline` from positions
- Color-code polyline by speed (green=slow, yellow=medium, red=fast)
- Animated marker at current replay position
- Start marker (green) + End marker (red)
- `MapLayerSwitcher` for dark/satellite/terrain
- Auto-fit bounds to route on load

**2. Playback Controls**
- Play/Pause toggle, Stop (resets to start)
- Speed selector: 1x, 2x, 5x, 10x
- Progress bar (seekable — click to jump)
- Elapsed / total time display

**3. Current Stats Bar (updates during replay)**
- 6 MetricCards showing values AT the current replay position
- Speed, Power, Battery %, Elevation, Range, Temperature
- Uses `fmtNumber()` for user's decimal precision
- Animated transitions between values

**4. Elevation Profile**
- `ElevationProfile` component with area chart
- X-axis: cumulative distance (km/mi)
- Y-axis: elevation (m/ft)
- Vertical cursor line at current replay position
- Click anywhere to seek replay to that point
- Show elevation gain/loss summary

**5. Speed + Power Timeline**
- Dual-axis `AreaChart`: speed (left axis) + power (right axis)
- X-axis: time
- Vertical cursor synced to replay
- Regen power shown below zero line

**6. Drive Summary (always visible at bottom)**
- 8 StatCards: distance, duration, efficiency, elevation gain, elevation loss, max speed, avg speed, energy used

### Data Transformation

```typescript
// Compute cumulative distance for elevation profile X-axis
const routeData = useMemo(() => {
  let cumDist = 0;
  return positions.map((p, i) => {
    if (i > 0) {
      cumDist += haversineDistance(
        positions[i-1].latitude, positions[i-1].longitude,
        p.latitude, p.longitude
      );
    }
    return {
      index: i,
      distance: convertDistance(cumDist / 1000),  // km → user unit
      elevation: p.elevation ?? 0,
      speed: p.speed != null ? convertSpeed(p.speed) : 0,
      power: p.power ?? 0,
      battery: p.batteryLevel,
      timestamp: p.timestamp,
    };
  });
}, [positions, convertDistance, convertSpeed]);
```

Add `haversineDistance` utility to `web/src/lib/geo.ts` if it doesn't exist.

## Step 5 — Wire Route

In `web/src/App.tsx`:
```typescript
const TripReplayPage = lazy(() => import('./features/driving/pages/TripReplayPage'));
<Route path="drives/:id/replay" element={<TripReplayPage />} />
```

Add "Replay" button on `DriveDetailPage` that links to `/drives/{id}/replay`.

## Engineering Rules

```
✅ Import maps from @/components/maps (MapContainer, Polyline, Marker)
✅ Import charts from @/components/charts (AreaChart, Area, ReferenceLine)
✅ Use useTranslation() for all strings
✅ Use fmtNumber/fmtInt for all displayed values
✅ Use useSettings() for unit conversions (distance, speed, temp, elevation)
✅ PageContainer wrapper
✅ All sections always visible with EmptyState fallbacks
✅ Use cn() for conditional classes
❌ DO NOT import from 'recharts' or 'react-leaflet' directly
❌ DO NOT hardcode units — use convertDistance, convertSpeed, convertTemp
❌ DO NOT use style={{}} with static var(--*)
```

## Verification

```bash
cd web
npx tsc --noEmit

# New files created
ls src/features/driving/pages/TripReplayPage.tsx
ls src/hooks/useTripReplay.ts
ls src/components/maps/AnimatedMarker.tsx
ls src/components/charts/ElevationProfile.tsx
ls src/components/ui/PlaybackControls.tsx

# Violations
grep -c "from 'recharts'" src/features/driving/pages/TripReplayPage.tsx   # 0
grep -c "from 'react-leaflet'" src/features/driving/pages/TripReplayPage.tsx  # 0
grep -c "empty={" src/features/driving/pages/TripReplayPage.tsx  # 0

# Line count — this is a rich feature page
wc -l src/features/driving/pages/TripReplayPage.tsx  # target: 400+
```

**COMPLETION DEFINITION:**
- [ ] `useDrivePositions` + `useDriveTelemetry` hooks added
- [ ] `useTripReplay` hook with play/pause/seek/speed controls
- [ ] `AnimatedMarker` component in components/maps/
- [ ] `ElevationProfile` component in components/charts/
- [ ] `PlaybackControls` component in components/ui/
- [ ] TripReplayPage with all 6 sections
- [ ] Route wired at `/drives/:id/replay`
- [ ] "Replay" button added to DriveDetailPage
- [ ] Color-coded speed polyline on map
- [ ] Synced cursors across map + elevation + timeline charts
- [ ] Unit conversion via useSettings (distance, speed, temp, elevation)
- [ ] TypeScript compiles clean
- [ ] Zero violations
