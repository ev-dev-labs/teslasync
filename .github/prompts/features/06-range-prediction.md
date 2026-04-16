# Feature: Range Prediction Based on Weather + Route + Driving Style

## Context

TeslaSync already has:
- **`GET /analytics/range-projection`** endpoint in `internal/api/range_projection_handler.go` — basic range projection
- **`drives`** table: `distance`, `speed_avg`, `outside_temp_avg`, `elevation_gain/loss`, `soc_start/end`, efficiency per drive
- **`battery_snapshots`**: `health_score`, `capacity_kwh`, `est_range_km`
- **`vehicle_live_state`**: current `battery_level`, `rated_range`, `ideal_range`, `est_range`, `outside_temp`
- **`GET /analytics/temperature-impact`** — existing temp vs efficiency analysis
- **`positions`** table: GPS trail with elevation data per drive

## What to Build

An enhanced **range prediction engine** that factors in weather, route profile, and personal driving style.

### Backend — Enhance: `GET /api/v1/analytics/range-projection?vehicle_id=X`

**Handler:** Enhance `internal/api/range_projection_handler.go`

1. **Personal efficiency model** (derived from drive history):
   ```sql
   -- Compute efficiency buckets by temperature and speed
   SELECT
     CASE
       WHEN outside_temp_avg < 0 THEN 'freezing'
       WHEN outside_temp_avg < 10 THEN 'cold'
       WHEN outside_temp_avg < 25 THEN 'mild'
       ELSE 'hot'
     END AS temp_bucket,
     CASE
       WHEN speed_avg < 50 THEN 'city'
       WHEN speed_avg < 90 THEN 'suburban'
       ELSE 'highway'
     END AS speed_bucket,
     AVG((soc_start - soc_end) * 75.0 * 10 / NULLIF(distance, 0)) AS wh_per_km,
     COUNT(*) AS sample_count
   FROM drives
   WHERE vehicle_id = $1 AND distance > 5 AND soc_start > soc_end
   GROUP BY temp_bucket, speed_bucket
   ```

2. **Scenario-based projections** using the personal model:
   - **City driving** (speed_avg=35, mild temp): lookup `city+mild` efficiency → range = capacity / efficiency
   - **Highway driving** (speed_avg=110, mild temp): lookup `highway+mild`
   - **Cold city** (speed_avg=35, freezing): lookup `city+freezing`
   - **Cold highway** (speed_avg=110, freezing): highest consumption scenario
   - **With HVAC**: add 1-3 kW overhead based on outside temp delta
   - **With Sentry**: add ~300W continuous drain

3. **Weather integration** (optional — degrade gracefully if not configured):
   - Add config: `WEATHER_API_KEY` (OpenWeatherMap free tier: 1000 calls/day)
   - Fetch current conditions for vehicle's last known position
   - Use actual temp + wind + rain in the projection instead of bucket average
   - If no API key: use `vehicle_live_state.outside_temp` as current condition

4. **Degradation adjustment:**
   - From `battery_snapshots`: current `health_score` and `capacity_kwh`
   - Adjust usable capacity: `capacity_kwh * (health_score / 100)`

5. **Response shape:**
```json
{
  "current_battery_pct": 72,
  "usable_capacity_kwh": 68.4,
  "health_factor": 0.912,
  "scenarios": [
    {
      "name": "City (Mild)",
      "speed_kmh": 35,
      "temp_c": 20,
      "efficiency_wh_km": 145,
      "range_km": 471,
      "range_mi": 293,
      "sample_count": 28,
      "extras": []
    },
    {
      "name": "Highway (Mild)",
      "speed_kmh": 110,
      "temp_c": 20,
      "efficiency_wh_km": 195,
      "range_km": 350,
      "range_mi": 218,
      "sample_count": 15,
      "extras": []
    },
    {
      "name": "Highway (Cold) + HVAC",
      "speed_kmh": 110,
      "temp_c": -5,
      "efficiency_wh_km": 265,
      "range_km": 258,
      "range_mi": 160,
      "sample_count": 4,
      "extras": ["hvac"]
    },
    {
      "name": "Current Conditions",
      "speed_kmh": 80,
      "temp_c": 15,
      "efficiency_wh_km": 168,
      "range_km": 407,
      "range_mi": 253,
      "sample_count": 12,
      "is_current": true,
      "weather": { "temp_c": 15, "condition": "partly_cloudy", "wind_kmh": 12 }
    }
  ],
  "efficiency_matrix": [
    { "temp_bucket": "mild", "speed_bucket": "city", "wh_km": 145, "samples": 28 },
    { "temp_bucket": "mild", "speed_bucket": "highway", "wh_km": 195, "samples": 15 },
    ...
  ],
  "tesla_estimate_km": 380,
  "your_estimate_km": 407,
  "accuracy_note": "Based on 62 drives over 4 months"
}
```

### Frontend — Enhance existing or create `RangeProjectionPage.tsx`

Create `web/src/features/battery/pages/RangeProjectionPage.tsx`:

1. **Current range hero** — large gauge showing predicted range at current conditions vs Tesla's estimate
2. **Scenario cards** — grid of 4-6 scenarios, each showing range with speed/temp/extras icons
3. **Efficiency matrix heatmap** — temp_bucket × speed_bucket colored by Wh/km (green=efficient, red=high consumption)
4. **"What if" sliders** — adjust speed (30-150 km/h) and temp (-20 to 40°C) to see interpolated range
5. **Weather badge** — if weather API configured, show current conditions with icon

### Key Files
- Enhance: `internal/api/range_projection_handler.go`
- Create: `web/src/features/battery/pages/RangeProjectionPage.tsx`
- Add route + nav entry
- Config: add optional `WEATHER_API_KEY` to `internal/config/config.go` + `docker-compose.yml`

### Technical Notes
- Weather API is **optional** — everything works without it (uses vehicle's outside_temp)
- Efficiency matrix: skip buckets with < 3 samples (insufficient data)
- "What if" sliders: bilinear interpolation between nearest buckets (client-side math)
- HVAC overhead model: `max(0, abs(cabin_target - outside_temp) * 0.1)` kW (simplified)
- Sentry overhead: flat 300W
- All range calculations: `range_km = (usable_capacity_kwh * 1000 * (battery_pct / 100)) / efficiency_wh_km`
- Use unit conversion from Settings (km/mi) for display
