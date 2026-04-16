# Feature: Driving Pattern Analysis & Coaching

## Context

TeslaSync already has:
- **`drives`** table with rich per-drive data: `distance`, `duration_min`, `speed_max/min/avg`, `power_max/power_min`, `elevation_gain/loss`, `soc_start/end`, `inside_temp_avg`, `outside_temp_avg`, `start/end_odometer`
- **`DrivingDynamicsPage.tsx`** at `web/src/features/driving/pages/DrivingDynamicsPage.tsx` — shows speed distribution, acceleration patterns, power profile, throttle style
- **`DriveDetailPage.tsx`** — per-drive breakdown with speed/power/elevation charts
- **`GET /analytics/speed-profile`** — speed distribution histogram
- **`GET /analytics/temperature-impact`** — efficiency vs temperature
- **`positions`** table with per-drive GPS trail, speed, power, elevation at ~10s intervals

## What to Build

A **Driving Coach** system that analyzes patterns and gives actionable improvement tips.

### Backend — New endpoint: `GET /api/v1/analytics/driving-coach?vehicle_id=X&days=30`

**Handler:** Create `internal/api/driving_coach_handler.go`

1. **Efficiency Score (0-100)** per drive and aggregate:
   - Compute Wh/km for each drive: `(soc_start - soc_end) * battery_capacity_kwh * 10 / distance`
   - Compare to vehicle's best-ever efficiency → score = (best / actual) * 100
   - Weight recent drives higher (exponential moving average)

2. **Driving Style Classification** per drive:
   - **Aggressive**: `power_max > 150kW` OR `speed_max > 130km/h` frequently
   - **Moderate**: middle range
   - **Efficient**: low power variance, steady speed, high regen ratio
   - Compute from: `power_max`, `power_min` (regen), `speed_max - speed_avg` spread

3. **Pattern Detection** (aggregate over N drives):
   - **Hard acceleration frequency**: count drives where `power_max > 100kW`
   - **Hard braking frequency**: count drives where `power_min < -60kW` (regen spike)
   - **Highway vs city ratio**: drives with `speed_avg > 80km/h` vs below
   - **Short trip frequency**: drives under 5km (battery overhead)
   - **Cold start penalty**: drives where `outside_temp_avg < 5°C`

4. **Personalized Recommendations** (rule-based):
   - If hard_accel_pct > 40%: "Gentler acceleration can improve range by 10-15%"
   - If highway_pct > 70%: "Highway driving at 110 vs 130 km/h saves ~20% energy"
   - If short_trip_pct > 50%: "Combining short trips reduces battery conditioning overhead"
   - If cold_start_pct > 30%: "Pre-condition while plugged in to save ~5% range in cold weather"
   - If avg_efficiency > 180 Wh/km: "Your efficiency is above average — check tire pressure"

5. **Response shape:**
```json
{
  "overall_score": 78,
  "efficiency_wh_km": 165,
  "best_efficiency_wh_km": 142,
  "total_drives_analyzed": 45,
  "style_breakdown": { "efficient": 18, "moderate": 20, "aggressive": 7 },
  "patterns": {
    "hard_accel_pct": 15.5,
    "hard_brake_pct": 8.2,
    "highway_pct": 42,
    "short_trip_pct": 22,
    "cold_start_pct": 10
  },
  "weekly_trend": [
    { "week": "2026-W14", "score": 75, "efficiency": 170, "drives": 8 },
    ...
  ],
  "recommendations": [
    { "category": "acceleration", "impact": "high", "tip": "Reduce hard acceleration events — currently 15% of drives" },
    ...
  ],
  "per_drive_scores": [
    { "drive_id": 29, "date": "2026-04-14", "score": 85, "style": "efficient", "efficiency": 148, "distance": 32.5 },
    ...
  ]
}
```

### Frontend — Enhance `DrivingDynamicsPage.tsx`

Add a new **"Driving Coach"** tab or section:
1. **Overall score gauge** — RadialGauge 0-100 with color (red < 50, amber < 75, green ≥ 75)
2. **Style breakdown pie chart** — efficient/moderate/aggressive distribution
3. **Weekly trend line chart** — score over last 8 weeks
4. **Pattern indicators** — visual bars for each pattern metric with color thresholds
5. **Recommendations list** — cards with icon, category, impact badge, and tip text
6. **Per-drive score table** — sortable, shows score, style badge, efficiency, distance

### Key Files
- Create: `internal/api/driving_coach_handler.go`
- Wire in: `internal/api/router.go` (add route under `/analytics`)
- Enhance: `web/src/features/driving/pages/DrivingDynamicsPage.tsx`
- Read from: `internal/database/drive_repo.go` — `GetByVehicle()`

### Technical Notes
- All computation server-side in Go — no ML libraries needed, pure arithmetic
- Nominal battery capacity: use 75 kWh (Model Y LR) or make configurable
- The per-drive efficiency formula is an approximation — fine for coaching purposes
- Weekly trend: GROUP BY `DATE_TRUNC('week', start_date)`
