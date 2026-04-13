---
description: "Fix DrivingDynamicsPage — page shows empty because hooks call non-existent endpoints. Rewire to real backend + restore all prod sections"
---

# Fix: DrivingDynamicsPage — Completely Broken (Shows Empty)

## Root Cause Analysis

The page has 754 lines of code but **shows nothing** because:

1. `useDrivingDynamics` calls `/drives/dynamics` — **ENDPOINT DOES NOT EXIST** in backend → 400 error
2. `useDrivingStats` calls `/drives/stats` — **ENDPOINT DOES NOT EXIST** in backend → 400 error
3. `PageContainer` has `empty={!dynamics}` which **hides the entire page** when dynamics is null
4. The page was rewritten as analytics-only but the **prod version was a live motor telemetry dashboard**

### What the PROD version had (9 sections, 616 lines)

```
Section 1: Live Motor Status — 4 gauges (torque, axle speed, stator temp, motor state)
Section 2: Acceleration G-Force — lateral/longitudinal values + G-Force dot viz + peak values
Section 3: Pedal Usage — throttle position gauge + brake pedal status badge
Section 4: Speed & Gear — current speed + gear selector viz + speed stats + time-in-gear
Section 5: Speed Over Time — line/area chart (vehicle_speed over time)
Section 6: Motor Torque History — line chart (di_torque over time)
Section 7: G-Force History — dual line chart (lateral_accel + longitudinal_accel over time)
Section 8: Motor Efficiency Insights — 3 cards (torque distribution, throttle behavior, motor thermal)
Section 9: Summary Stats — 6 stat cards (total readings, avg torque, max lateral G, max longitudinal G, avg pedal position, avg stator temp)
```

### What the refactored version has (all hidden behind `empty={!dynamics}`)

```
Section 1: G-Force Circular Gauges (4 RadialGauge) — uses dynamics.maxAccelerationG etc ← MISSING DATA
Section 2: G-Force Metric Cards (6 cards) — uses dynamics fields ← MISSING DATA
Section 3: Smoothness Assessment — uses dynamics.smoothnessScore ← MISSING DATA
Section 4: Speed Distribution + Acceleration Patterns — uses filteredDrives ✅ WORKS
Section 5: Power Profile — uses filteredDrives ✅ WORKS
Section 6: G-Force Comparison Bars — uses dynamics fields ← MISSING DATA
Section 7: Driving Style Recommendations — uses dynamics.smoothnessScore ← MISSING DATA
Section 8: Summary Stats — uses stats fields ← MISSING DATA
```

## What MUST Change

### Data Sources Available in Backend

| Endpoint | What it returns | Hook that exists |
|----------|----------------|-----------------|
| `GET /motor/latest?vehicle_id=X` | Latest motor snapshot (torque, speed, temps, G-forces, pedals, gear) | `useMotorLatest(vehicleId)` in `useVehicles.ts` |
| `GET /motor/?vehicle_id=X&limit=N` | Motor snapshot history array | **NEEDS NEW HOOK** |
| `GET /drives?vehicle_id=X` | Drive session list (speed, power, distance, etc.) | `useDrives(vehicleIdStr)` in `useDriving.ts` |
| `GET /signals/{vehicleID}/live` | Live signal values (real-time) | `useSignalGaps(vehicleId)` in `useTelemetry.ts` |

### MotorSnapshot type (already exists in `web/src/api/types.ts` line 507)

```typescript
interface MotorSnapshot {
  id: number
  vehicle_id: number
  di_state?: string           // motor state (e.g., "ready", "driving")
  di_torque?: number          // motor torque (Nm)
  di_axle_speed?: number      // axle speed (RPM)
  di_stator_temp?: number     // stator temperature (°C)
  pedal_position?: number     // throttle 0-100%
  brake_pedal?: boolean       // brake active
  lateral_accel?: number      // lateral G-force
  longitudinal_accel?: number // longitudinal G-force
  vehicle_speed?: number      // speed (km/h)
  gear?: string               // P, R, N, D
  created_at: string          // timestamp
  // ... plus 30+ dual-motor fields
}
```

---

## Step 0 — Add `useMotorHistory` hook

In `web/src/api/hooks/useVehicles.ts`, add this hook right after the existing `useMotorLatest`:

```typescript
export function useMotorHistory(vehicleId: number, limit = 200) {
  return useQuery({
    queryKey: ['motor-history', vehicleId, limit],
    queryFn: () => request<import('../types').MotorSnapshot[]>(`/motor?vehicle_id=${vehicleId}&limit=${limit}`),
    enabled: vehicleId > 0,
  });
}
```

This calls `GET /motor/` which is `motorHandler.List` (router.go line 327).

---

## Step 1 — Rewire data hooks in DrivingDynamicsPage

**REMOVE these imports:**
```typescript
// DELETE — these hooks call non-existent endpoints
import { useDrivingDynamics, useDrives, useDrivingStats } from '@/api/hooks/useDriving';
```

**REPLACE with:**
```typescript
import { useDrives } from '@/api/hooks/useDriving';
import { useMotorLatest, useMotorHistory } from '@/api/hooks/useVehicles';
```

**REMOVE these hook calls (around lines 149-154):**
```typescript
// DELETE
const { data: dynamics, isLoading: dynLoading } = useDrivingDynamics(vehicleIdStr);
const { data: stats } = useDrivingStats(vehicleIdStr);
```

**REPLACE with:**
```typescript
const vehicleIdNum = vehicleId ?? 0;
const { data: motorLatest, isLoading: motorLoading } = useMotorLatest(vehicleIdNum, 5000);
const { data: motorHistory } = useMotorHistory(vehicleIdNum, 200);
const { data: drives } = useDrives(vehicleIdStr);
```

---

## Step 2 — Remove the `empty={!dynamics}` gate

On the `<PageContainer>` (around line 291), change:
```typescript
// BEFORE
empty={!dynamics}
emptyMessage={t('dynamics.empty', 'No dynamics data available.')}

// AFTER — remove the empty gate entirely, let individual sections handle no-data
loading={motorLoading}
error={null}
```

Remove the `{dynamics && ( ... <>...</> ... )}` wrapper that gates ALL content. Each section should independently handle missing data with placeholders.

---

## Step 3 — Rebuild sections to match prod

Rewrite the page body to have these sections in order. **Every section MUST always render** — if data is null, show a placeholder with an info message, never hide the section.

### Section 1: Live Motor Status (4 gauges)

Use `motorLatest` data. Show 4 RadialGauge components:
- **Torque**: `motorLatest?.di_torque` — max 500, unit "Nm", color blue
- **Axle Speed**: `motorLatest?.di_axle_speed` — max 18000, unit "RPM", color purple
- **Stator Temp**: `motorLatest?.di_stator_temp` (converted via `convertTemp`) — max 200, unit tempUnit, color amber
- **Motor State**: Show as a Badge instead of gauge — `motorLatest?.di_state ?? 'Unknown'`

If `motorLatest` is null → show 4 placeholder gauges with value 0 and "Awaiting data" text.

### Section 2: Acceleration G-Force

Use `motorLatest` data. Show:
- Two large numbers: lateral G (`motorLatest?.lateral_accel`) and longitudinal G (`motorLatest?.longitudinal_accel`)
- A G-Force vector dot visualization (SVG circle with dot positioned by lat/lon G values, with crosshair grid)
- Peak values from `motorHistory`: compute `Math.max(...)` across history for lateral and longitudinal

If no data → show "—" for values and centered dot (0,0) for visualization.

### Section 3: Pedal Usage

Use `motorLatest` data. Show:
- **Throttle Position**: RadialGauge with `motorLatest?.pedal_position`, max 100, unit "%"
- **Brake Pedal**: Badge showing Active (red) / Inactive (green) based on `motorLatest?.brake_pedal`

### Section 4: Speed & Gear

Use `motorLatest` data. Show:
- **Current Speed**: Large AnimatedNumber with `motorLatest?.vehicle_speed` (converted)
- **Gear**: Badge showing `motorLatest?.gear ?? '—'` with color per gear (P=gray, R=red, N=yellow, D=green)
- **Speed Stats** from drives: avg speed, top speed (computed from `filteredDrives`)

### Section 5: Speed Over Time Chart

Use `motorHistory` array. Map to chart data:
```typescript
const speedChartData = (motorHistory ?? []).map(s => ({
  time: new Date(s.created_at).toLocaleTimeString(),
  speed: s.vehicle_speed != null ? convertSpeed(s.vehicle_speed) : null,
}));
```

Use `ChartContainer` + `AreaChart` with gradient fill. Show placeholder if empty.

### Section 6: Motor Torque History Chart

Use `motorHistory` array. Map `di_torque` over time.
Use `ChartContainer` + `AreaChart`. Show placeholder if empty.

### Section 7: G-Force History Chart

Use `motorHistory` array. Map `lateral_accel` and `longitudinal_accel` over time.
Use `ChartContainer` + `AreaChart` with two Area series (different colors). Show placeholder if empty.

### Section 8: Motor Efficiency Insights (3 cards)

Compute from `motorHistory`:
1. **Torque Distribution**: avg torque, max torque, % time at high torque
2. **Throttle Behavior**: avg pedal position, classify as conservative/moderate/aggressive
3. **Motor Thermal**: avg stator temp, max stator temp, thermal health badge

Use `GlassPanel` for each card. If no history → show "No motor data recorded yet" in each card.

### Section 9: Summary Stats

Compute from `motorHistory`:
- Total Readings: `motorHistory?.length ?? 0`
- Avg Torque: average of `di_torque` values
- Max Lateral G: max of `lateral_accel` values
- Max Longitudinal G: max of `longitudinal_accel` values
- Avg Pedal Position: average of `pedal_position` values
- Avg Stator Temp: average of `di_stator_temp` (converted)

Use 6 `StatCard` components in a Grid. If no data → show "—" as value.

---

## Step 4 — Keep existing good sections

The current page has these sections that work with drives data — **KEEP THEM** but move them AFTER the live motor sections:

- **Speed Distribution** bar chart (computed from `filteredDrives`)
- **Acceleration Patterns** scatter chart (computed from `filteredDrives`)
- **Power Profile** area chart (computed from `filteredDrives`)
- **Date Range Filter** (keep at top, applies to drives-based charts)

These are the analytical sections. Place them after Section 9 under a heading like "Drive Analytics".

---

## Step 5 — Remove dead types and imports

In `web/src/types/driving.ts`, the `DrivingDynamicsData` and `DrivingStats` interfaces are orphaned (no backend serves them). **Leave them for now** — they'll be cleaned up in a future pass.

In `web/src/api/hooks/useDriving.ts`, the `useDrivingDynamics` and `useDrivingStats` exports are dead code. **Leave them for now** — only remove the imports FROM the page.

---

## Engineering Guidelines Compliance

```
❌ DO NOT use inline style={{}} with static var(--*) values — use Tailwind classes
   EXCEPTION: Recharts wrapperStyle/contentStyle (library API) and computed dynamic values are OK
❌ DO NOT use raw <button>, <input>, <textarea>, <select>, <table> — use shared components
❌ DO NOT import from 'recharts' or 'react-leaflet' directly — use @/components/charts or @/components/maps
❌ DO NOT use fetch() or useEffect for data — use TanStack Query hooks
❌ DO NOT use hardcoded strings — use useTranslation()
❌ DO NOT hide sections when data is missing — show placeholder with info text
✅ DO use PageContainer as wrapper
✅ DO use null coalescence (?? 0, ?? '—') for all optional fields
✅ DO wrap each section in <FadeIn> for consistent animation
✅ DO use the `cn()` helper for conditional classNames
```

---

## Verification

```bash
cd web

# TypeScript must pass
npx tsc --noEmit

# Line count — must be ≥ 600 lines (prod was 616, current broken is 754)
wc -l src/features/driving/pages/DrivingDynamicsPage.tsx

# Zero violations
grep -n "style={{" src/features/driving/pages/DrivingDynamicsPage.tsx | grep -c "var(--"
grep -cP '<button\b|<input\b|<textarea\b|<select\b|<table\b' src/features/driving/pages/DrivingDynamicsPage.tsx
grep -c "from 'recharts'" src/features/driving/pages/DrivingDynamicsPage.tsx
grep -c "vehicleId=" src/features/driving/pages/DrivingDynamicsPage.tsx

# Hooks must use correct endpoints
grep -n "drives/dynamics\|drives/stats" src/features/driving/pages/DrivingDynamicsPage.tsx
# ^^^ Must return 0 matches

# Must import motor hooks
grep -n "useMotorLatest\|useMotorHistory" src/features/driving/pages/DrivingDynamicsPage.tsx
# ^^^ Must return matches

echo ""
echo "=== Section count ==="
grep -c "SECTION\|GlassPanel\|ChartContainer" src/features/driving/pages/DrivingDynamicsPage.tsx
# ^^^ Must be ≥ 15 (9 prod sections + drive analytics sections)
```

**COMPLETION DEFINITION — ALL must be true:**
- [ ] `useMotorHistory` hook added to useVehicles.ts
- [ ] Page no longer imports `useDrivingDynamics` or `useDrivingStats`
- [ ] Page uses `useMotorLatest` + `useMotorHistory` + `useDrives`
- [ ] No `empty={!dynamics}` gate — page always renders
- [ ] All 9 prod sections restored with correct data sources
- [ ] Drive analytics sections (speed distribution, accel patterns, power profile) retained
- [ ] Every section shows placeholder when data is null (never hidden)
- [ ] Zero static inline styles, zero raw HTML, zero direct library imports
- [ ] TypeScript compiles clean
- [ ] ≥ 600 lines
