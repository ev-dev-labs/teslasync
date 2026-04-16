# Feature: Energy Cost Forecasting

## Context

TeslaSync already has:
- **`charging_sessions`** table: `charge_energy_added`, `cost`, `duration_min`, `start_date`, `fast_charger_type`, `fast_charger_brand`, `latitude/longitude`, `location_name`
- **`CostAnalysisPage.tsx`** at `web/src/features/charging/pages/CostAnalysisPage.tsx` — shows total cost, monthly trends, charger type breakdown, gas comparison, CO2 savings
- **`GET /analytics/tco`** — total cost of ownership endpoint
- **`GET /analytics/fleet`** — includes `total_cost`, `total_energy_kwh`
- **`drives`** table with `distance` per drive for cost-per-km calculations

## What to Build

A **cost forecasting engine** that predicts future energy costs based on historical patterns.

### Backend — New endpoint: `GET /api/v1/analytics/cost-forecast?vehicle_id=X&months=6`

**Handler:** Create `internal/api/cost_forecast_handler.go`

1. **Monthly cost aggregation** from charging_sessions:
   ```sql
   SELECT DATE_TRUNC('month', start_date) AS month,
          SUM(cost) AS total_cost,
          SUM(charge_energy_added) AS total_kwh,
          COUNT(*) AS sessions,
          AVG(cost / NULLIF(charge_energy_added, 0)) AS avg_cost_per_kwh
   FROM charging_sessions
   WHERE vehicle_id = $1 AND cost > 0
   GROUP BY month ORDER BY month
   ```

2. **Trend calculation:**
   - Linear regression on monthly cost → slope = monthly cost growth rate
   - Seasonal adjustment: compute average cost per calendar month (Jan-Dec) across all years
   - Project next N months using: `base_trend + seasonal_factor`

3. **Cost breakdown forecasting:**
   - Home charging vs Supercharging split (by `fast_charger_type`)
   - Average cost per kWh at home vs Supercharger
   - Project each category separately

4. **Gas savings projection:**
   - Compute average km/month from drives table
   - Gas equivalent: `km_per_month * 0.085 L/km * gas_price_per_L` (configurable or default $1.50/L)
   - EV cost: projected monthly electricity cost
   - Monthly savings = gas_equivalent - ev_cost

5. **Response shape:**
```json
{
  "historical": [
    { "month": "2026-01", "cost": 45.20, "kwh": 320, "sessions": 12, "cost_per_kwh": 0.14 },
    ...
  ],
  "forecast": [
    { "month": "2026-05", "cost": 48.50, "cost_low": 42.00, "cost_high": 55.00, "kwh": 335 },
    ...
  ],
  "breakdown": {
    "home": { "pct": 72, "avg_cost_per_kwh": 0.12, "monthly_avg": 34.50 },
    "supercharger": { "pct": 28, "avg_cost_per_kwh": 0.35, "monthly_avg": 13.70 }
  },
  "gas_comparison": {
    "avg_km_per_month": 2100,
    "gas_cost_per_month": 267.75,
    "ev_cost_per_month": 48.20,
    "monthly_savings": 219.55,
    "annual_savings": 2634.60,
    "lifetime_savings": 12450.00
  },
  "insights": [
    "Your cost per kWh has decreased 8% over the last 6 months",
    "Shifting 2 more sessions to home charging would save ~$12/month"
  ]
}
```

### Frontend — Enhance `CostAnalysisPage.tsx`

Add a **"Forecast"** section/tab:
1. **Forecast chart** — AreaChart showing historical cost (solid) + forecast (dashed line with shaded confidence band)
2. **Breakdown donut** — home vs Supercharger with cost_per_kwh labels
3. **Savings calculator** — gas vs EV monthly/annual/lifetime with animated counters
4. **Insights cards** — auto-generated tips with icons
5. **Cost per kWh trend** — small line chart showing avg_cost_per_kwh over time

### Key Files
- Create: `internal/api/cost_forecast_handler.go`
- Wire in: `internal/api/router.go` (under `/analytics`)
- Enhance: `web/src/features/charging/pages/CostAnalysisPage.tsx`
- Query: `charging_sessions` and `drives` tables directly (no new repo needed)

### Technical Notes
- Linear regression: same pattern as battery degradation (least-squares, ~20 lines Go)
- Seasonal adjustment: average of same-month values across years (handles seasonal electricity rates)
- Gas price default: make configurable via Settings (add `gas_price_per_liter` to settings table)
- All monetary values follow user's existing currency settings
- Handle edge case: <3 months of data → skip forecast, show "Need more data" message
