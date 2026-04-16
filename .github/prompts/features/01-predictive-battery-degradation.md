# Feature: Predictive Battery Degradation Modeling

## Context

TeslaSync already has:
- **`battery_snapshots`** table with daily snapshots: `health_score`, `capacity_kwh`, `degradation_pct`, `est_range_km`, `cycle_count`, `avg_cell_temp_c`, `created_at`
- **`BatteryDegradationPage.tsx`** at `web/src/features/battery/pages/BatteryDegradationPage.tsx` — shows health score, degradation %, capacity trend, cycle count, SOH projection, risk factors
- **`GET /analytics/battery-degradation`** endpoint in `internal/api/battery_degradation_handler.go` — returns degradation prediction
- **`charging_sessions`** table with `charge_energy_added`, `fast_charger_type`, `start/end_battery_level`, `outside_temp_avg`
- **Maintenance worker** generates daily `battery_snapshots` from charging telemetry (`internal/worker/maintenance_worker.go`)

## What to Build

Enhance the existing battery degradation system with a proper **predictive model**:

### Backend (`internal/api/battery_degradation_handler.go`)

1. **Linear regression** on `battery_snapshots` (health_score over time) to project:
   - Estimated date when health drops below 80% (warranty threshold)
   - Projected health_score at 1yr, 2yr, 3yr from now
   - Monthly degradation rate (% per month)
   - Confidence interval (based on data variance)

2. **Risk factor scoring** (0-100) based on:
   - Fast charge ratio: `COUNT(fast_charger_type != '') / COUNT(*)` from charging_sessions — frequent DC fast charging accelerates degradation
   - Average charge level: sessions that charge above 90% SOC regularly
   - Temperature exposure: `avg_cell_temp_c` extremes from battery_snapshots — hot climates degrade faster
   - Cycle count rate: cycles per month vs expected baseline
   - Deep discharge frequency: sessions starting below 10% SOC

3. **New API response shape:**
```json
{
  "current_health_pct": 96.2,
  "degradation_rate_pct_per_month": 0.12,
  "projected_80pct_date": "2029-08-15",
  "projections": [
    { "date": "2027-04", "health_pct": 94.8, "confidence_low": 93.5, "confidence_high": 96.1 },
    ...
  ],
  "risk_factors": [
    { "name": "fast_charge_ratio", "score": 35, "label": "Moderate", "detail": "28% of sessions are DC fast charge" },
    { "name": "high_soc_charging", "score": 60, "label": "Elevated", "detail": "42% of sessions charge above 90%" },
    ...
  ],
  "recommendations": [
    "Reduce charge limit to 80% for daily driving",
    "Avoid frequent Supercharging when possible"
  ]
}
```

### Frontend (`web/src/features/battery/pages/BatteryDegradationPage.tsx`)

Update the existing page:
1. **Projection chart** — extend the existing health timeline with a dashed projection line + shaded confidence interval (use Recharts `Area` for confidence band)
2. **Risk factor cards** — color-coded (green/amber/red) gauge for each risk factor with detail text
3. **Recommendations panel** — actionable tips based on risk factors
4. **"Warranty threshold" reference line** at 80% on the health chart

### Key Files
- `internal/api/battery_degradation_handler.go` — main handler (enhance `Predict` method)
- `internal/database/energy_repo.go` — `BatterySnapshotRepo.GetByVehicle()`
- `web/src/features/battery/pages/BatteryDegradationPage.tsx` — frontend page
- `internal/models/models.go` — BatterySnapshot struct (line ~570)

### Technical Notes
- Linear regression: implement simple least-squares in Go (no external library needed — ~20 lines)
- Confidence interval: use standard error of the regression slope × t-value for 95% CI
- All data comes from PostgreSQL — no external APIs needed
- Battery health model assumes roughly linear degradation (valid for Li-ion in the 100%→80% range)

### Testing
- Verify projection chart renders with <5 data points (graceful degradation)
- Verify risk factors compute correctly with zero charging sessions
- Verify 80% warranty line appears on chart
