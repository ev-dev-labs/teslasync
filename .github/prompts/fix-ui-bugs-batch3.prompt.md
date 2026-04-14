---
description: "Fix UI bugs batch 3 — Safety Settings missing panels + Media Player missing sections"
---

# Fix: UI Bugs Batch 3 — Safety Settings & Media Player

> Bugs 1-10 from batch 2 were fixed. These 2 remaining bugs involve missing panels/sections
> compared to the pre-refactoring production version.

## Bug 1 — Safety Settings: Missing 4 major panels vs pre-refactoring

**Page:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx` (568 lines)
**Old:** `D:\repos\teslasync-old\web\src\pages\SafetySettings.tsx` (573 lines)

**Missing panels (visible in pre-refactoring prod):**
1. **Live Safety Signals** — real-time display of AEB, blind spot camera, collision warning,
   lane departure, speed limit warning with ON/OFF badges and live values
2. **Driving Statistics Panel** — safety score breakdown with per-metric analysis (hard braking,
   aggressive turning, forward collision warnings per 1000 miles, unsafe following distance)
3. **ADAS Status Timeline** — line chart showing AEB, Blind Spot Warning, Emergency Lane Departure
   enabled/disabled over time (`type="stepAfter"` chart)
4. **Safety Overview Panel** — detailed Autopilot configuration panel showing each safety feature's
   current setting with ON/OFF toggles, descriptions, and last-changed timestamps

**Root Cause (two issues):**

**A — camelCaseKeys transform:** The `SafetySnapshot` interface uses snake_case field names
(`automatic_emergency_braking_off`, `automatic_blind_spot_camera`) but `camelCaseKeys()`
transforms API responses to camelCase. So `latest.automatic_emergency_braking_off` is
`undefined` while `latest.automaticEmergencyBrakingOff` has the value.

After camelCaseKeys, the response has BOTH keys (original + camelCase). But if the code
only accesses snake_case fields, those values work. Check which fields are actually undefined.

**B — Sections may be conditionally hidden:** Check if panels are inside `{data && ...}` or
`{latest && ...}` blocks that evaluate to false due to field name mismatches.

**Fix:**
1. Update field access to handle both snake_case and camelCase throughout the page:
   ```typescript
   const aebOff = latest.automatic_emergency_braking_off ?? latest.automaticEmergencyBrakingOff;
   const blindSpot = latest.automatic_blind_spot_camera ?? latest.automaticBlindSpotCamera;
   const fcw = latest.forward_collision_warning ?? latest.forwardCollisionWarning;
   const lda = latest.lane_departure_avoidance ?? latest.laneDepartureAvoidance;
   const slw = latest.speed_limit_warning ?? latest.speedLimitWarning;
   ```
2. Restore missing panels from old page at `D:\repos\teslasync-old\web\src\pages\SafetySettings.tsx`:
   - **Live Safety Signals**: old page lines ~343-406 (7 FeatureCard components)
   - **ADAS Status Timeline**: old page lines ~491-518 (stepAfter line chart with AEB/BSCW/ELDA)
   - **Safety Overview**: old page lines ~530-600 (detail panel with per-feature settings)
   - **Driving Statistics**: compute from safety history data (hard braking count, FCW events, etc.)
3. Ensure all 4 panels always render (with EmptyState when no data)
4. Use shared components (`GlassPanel`, `ChartContainer`, `Badge`, `DataTable`) per guardrails
5. Do NOT use inline styles (use Tailwind classes or CSS variables)
6. Do NOT import directly from 'recharts' — use `@/components/charts` or the shared chart wrappers

---

## Bug 2 — Media Player: Only "Now Playing" card, 6 sections missing

**Page:** `web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx` (524 lines)
**Old:** `D:\repos\teslasync-old\web\src\pages\MediaPlayer.tsx` (500 lines)

**Missing sections from old page:**
1. **Equalizer Visualization** — animated bars when playing (old page lines ~112-150)
2. **Volume Gauge** — SVG arc gauge with current volume level (old page lines ~32-67, `VolumeGauge` component)
3. **Listening Stats Cards** (3 cards) — Unique Tracks, Top Source, Avg Volume (old page lines ~380-407)
4. **Playback History Table** — track name, artist, source, volume, duration, timestamp (old page lines ~412-429)
5. **Volume Over Time Chart** — line chart of volume history (old page lines ~432-450)
6. **Source Distribution Pie Chart** — Spotify vs Radio vs USB vs Bluetooth breakdown (old page lines ~453-494)
7. **Listening Stats Summary** — 3-panel summary grid (old page lines ~497-543)

**Fix:**
1. Check if the refactored page (524 lines) has these sections in code but hidden/broken
2. If sections exist, debug why they don't render (likely data binding or conditional display)
3. If sections are missing, restore from old page using shared components:
   - VolumeGauge → use shared `RadialGauge` or create in the page
   - Charts → use `ChartContainer` + `ResponsiveContainer` from shared wrappers
   - Playback History → use `DataTable` with proper column definitions
   - Source Distribution → use shared pie chart wrapper
4. All charts must use `@/components/charts` wrapper imports, NOT direct `from 'recharts'`
5. Stat cards must use `MetricCard` from `@/components/data-display`

**Data source:** The media player data comes from the live state API (`/vehicles/{id}/state`)
which includes `media_playback_status`, `media_artist`, `media_title`, `audio_volume`, etc.
History comes from `/media/history?vehicle_id=X` endpoint. Check what APIs exist:

```bash
# Check router for media endpoints:
grep -n "media\|audio\|playback" internal/api/router.go
```

---

## Verification

```bash
cd web && npx tsc --noEmit

# Safety Settings — check all 4 panels render
# 1. Feature cards with ON/OFF badges visible
# 2. ADAS timeline chart shows step lines
# 3. Safety overview shows per-feature settings
# 4. No "undefined" values displayed

# Media Player — check all sections render
# 1. Volume gauge visible (not just text)
# 2. Playback history table shows rows
# 3. Volume over time chart visible
# 4. Source distribution pie chart visible
```

**COMPLETION DEFINITION:**
- [ ] Safety Settings: Live Safety Signals panel with feature ON/OFF badges
- [ ] Safety Settings: ADAS Status Timeline chart (stepAfter line chart)
- [ ] Safety Settings: Safety Overview detail panel
- [ ] Safety Settings: no "undefined" values — camelCase field access fixed
- [ ] Media Player: Volume Gauge rendered (SVG or RadialGauge)
- [ ] Media Player: Listening Stats cards (Unique Tracks, Top Source, Avg Volume)
- [ ] Media Player: Playback History table with DataTable
- [ ] Media Player: Volume Over Time line chart
- [ ] Media Player: Source Distribution pie chart
- [ ] No direct `from 'recharts'` imports — use shared chart wrappers
- [ ] No inline styles — use Tailwind classes
- [ ] TypeScript compiles clean
