# Feature: Optimal Charging Schedule Recommendations

## Context

TeslaSync already has:
- **`charging_sessions`** table: `start_date`, `end_date`, `cost`, `charge_energy_added`, `charger_power`, `start/end_battery_level`, `latitude/longitude`, `location_name`
- **`GET /analytics/charging-heatmap`** — 7×24 grid of when charging happens
- **`ChargingListPage.tsx`** — session list with stats
- **`vehicle_live_state`** has `charge_limit_soc`, `scheduled_charging_start_time`
- **Settings** page where users can configure preferences

## What to Build

A system that analyzes charging habits and recommends optimal charging schedules to minimize cost and battery wear.

### Backend — New endpoint: `GET /api/v1/analytics/charging-optimizer?vehicle_id=X`

**Handler:** Create `internal/api/charging_optimizer_handler.go`

1. **Charging pattern analysis:**
   - Group sessions by hour-of-day and day-of-week
   - Compute average cost_per_kwh by time slot
   - Identify cheapest charging windows (typically overnight 11 PM - 6 AM)
   - Identify most expensive windows (typically 4 PM - 9 PM peak)

2. **Home vs away detection:**
   - Cluster charging locations by lat/lon (within 0.001° ≈ 100m = same location)
   - Most frequent location = "home"
   - Compute home_charging_pct, away_charging_pct

3. **Schedule recommendations:**
   - If user charges during peak hours at home: recommend shifting to off-peak
   - Compute potential savings: `(peak_cost_per_kwh - offpeak_cost_per_kwh) * avg_monthly_home_kwh`
   - Recommend charge limit: if avg end_battery_level > 90%, suggest 80% for daily use
   - Recommend pre-conditioning: if morning departures detected, suggest scheduled departure

4. **Battery-friendly scoring:**
   - Score current habits 0-100:
     - Deduct points for: charging to 100% frequently, frequent DC fast charging, charging in extreme temps
     - Add points for: consistent 80% limit, home charging, moderate charge rate

5. **Response shape:**
```json
{
  "current_schedule": {
    "most_common_start_hour": 18,
    "most_common_day": "weekday",
    "avg_sessions_per_week": 3.2,
    "home_charging_pct": 68,
    "avg_charge_to_pct": 88
  },
  "cost_analysis": {
    "peak_hours": [16, 17, 18, 19, 20],
    "offpeak_hours": [23, 0, 1, 2, 3, 4, 5],
    "peak_cost_per_kwh": 0.32,
    "offpeak_cost_per_kwh": 0.11,
    "sessions_during_peak_pct": 35,
    "potential_monthly_savings": 18.50
  },
  "battery_health_score": 72,
  "recommendations": [
    {
      "type": "schedule",
      "priority": "high",
      "title": "Shift home charging to off-peak hours",
      "detail": "35% of your home sessions start during peak rates (4-9 PM). Scheduling charging after 11 PM could save ~$18/month.",
      "estimated_savings": 18.50
    },
    {
      "type": "limit",
      "priority": "medium",
      "title": "Lower daily charge limit to 80%",
      "detail": "Your average charge target is 88%. Reducing to 80% for daily driving extends battery life with minimal range impact."
    },
    {
      "type": "precondition",
      "priority": "low",
      "title": "Enable scheduled departure",
      "detail": "You typically depart at 7:30 AM. Scheduled departure pre-conditions the battery while plugged in, saving 3-5% range."
    }
  ],
  "weekly_heatmap": [
    { "day": 0, "hour": 23, "sessions": 8, "avg_cost_per_kwh": 0.11 },
    ...
  ]
}
```

### Frontend — New section in ChargingListPage or standalone page

1. **Current habits summary** — cards showing avg sessions/week, home %, charge-to %
2. **Cost heatmap** — 7×24 grid colored by cost_per_kwh (green=cheap, red=expensive), dot size = session count
3. **Battery health score** — RadialGauge with breakdown
4. **Recommendations** — priority-sorted cards with savings estimate badges
5. **Potential savings banner** — prominent "Save ~$X/month by adjusting your schedule"

### Key Files
- Create: `internal/api/charging_optimizer_handler.go`
- Wire in: `internal/api/router.go`
- Create or enhance: frontend page/section
- Query: `charging_sessions` table

### Technical Notes
- Location clustering: simple distance threshold (0.001° lat/lon ≈ 100m)
- Peak/off-peak hours: derive from actual cost data, not hardcoded (adapts to user's local rates)
- If no cost data: skip cost recommendations, focus on battery health recommendations
- Handle single-vehicle and multi-vehicle fleets
