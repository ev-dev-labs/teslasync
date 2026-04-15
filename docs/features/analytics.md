# Analytics & Charts

TeslaSync provides rich analytics across your fleet with interactive charts, trend analysis, and comparative reports — all powered by [Recharts](https://recharts.org/) and backed by PostgreSQL. Frequently queried data is pre-aggregated in 3 materialized views (`mv_energy_daily`, `mv_position_hourly`, `mv_signal_stats`) refreshed daily by the maintenance worker for fast dashboard loads.

## Fleet Analytics

The **Analytics** page (`/analytics`) offers a fleet-wide view of your vehicles' performance.

### Fleet Summary Metrics

| Metric | Description |
|--------|-------------|
| **Total Distance** | Cumulative distance driven across all vehicles |
| **Total Energy Used** | Total kWh consumed from the grid |
| **Total Charging Cost** | Estimated electricity cost for all charging sessions |
| **Average Efficiency** | Fleet-wide Wh/km or Wh/mi |
| **Total Drives** | Number of drives recorded |
| **Total Charging Sessions** | Number of charging sessions recorded |

```bash
# Fetch fleet analytics
curl http://localhost:8080/api/v1/analytics/fleet
```

**Response:**

```json
{
  "total_vehicles": 3,
  "total_distance_km": 45230.5,
  "total_energy_kwh": 8750.2,
  "total_cost": 1050.02,
  "avg_efficiency_wh_km": 155.3,
  "total_drives": 892,
  "total_charging_sessions": 234
}
```

## Energy Analytics

The **Energy** page (`/energy`) shows detailed energy consumption patterns:

### Energy Consumption Charts

- **Daily energy usage** — Bar chart showing kWh consumed per day
- **Efficiency trends** — Line chart of Wh/km over time
- **Consumption by vehicle** — Stacked bar comparing vehicles
- **Cost breakdown** — Pie chart of electricity costs by location/charger type

### API Endpoints

```bash
# Energy stats for a vehicle
curl http://localhost:8080/api/v1/vehicles/123/energy

# Response includes daily breakdowns, averages, and totals
```

## Battery Health

The **Battery Health** page (`/battery`) tracks battery degradation and health over time:

### Battery Health Charts

| Chart | Description |
|-------|-------------|
| **Degradation Curve** | Rated range at 100% SOC over time |
| **Charge Cycles** | Cumulative charge cycles counted |
| **SOC Distribution** | Histogram of battery levels at charge start/end |
| **Temperature Impact** | Correlation between temperature and range |
| **Projected Range** | Estimated future range based on degradation trend |

Battery health snapshots are generated daily by the maintenance worker from charging telemetry data. Historical data is backfilled via migration 000057.

```bash
# Battery health report
curl http://localhost:8080/api/v1/vehicles/123/battery
```

**Response:**

```json
{
  "vehicle_id": 123,
  "current_range_at_100": 310,
  "original_range_at_100": 350,
  "degradation_pct": 11.4,
  "estimated_cycles": 450,
  "snapshots": [
    {
      "date": "2024-01-01",
      "rated_range": 320,
      "battery_level": 100,
      "odometer": 20000
    }
  ]
}
```

## Charging Analytics

The **Charging** page (`/charging`) provides detailed charging session analysis:

### Charging Charts

- **Sessions over time** — Bar chart of charging sessions per week/month
- **Energy added** — Total kWh added per session
- **Cost tracking** — Cost per session with geofence-based pricing
- **Charger type distribution** — Pie chart (Home, Supercharger, Destination, Other)
- **Charging speed** — Average power (kW) per session
- **Duration trends** — Average session duration over time

### Charging Cost Calculation

Costs are calculated based on:

1. **Geofence pricing** — If a vehicle charges within a geofence that has `cost_per_kwh` set
2. **Base cost** — Falls back to the `base_cost_per_kwh` from Settings
3. **Supercharger** — Uses actual billed amount if available

```bash
# List charging sessions
curl "http://localhost:8080/api/v1/charging?vehicle_id=123&start=2024-01-01"

# Single session detail
curl http://localhost:8080/api/v1/charging/456
```

## Mileage Reports

The **Mileage** page (`/mileage`) shows driving distance breakdowns:

### Daily Mileage

```bash
curl "http://localhost:8080/api/v1/mileage/daily?vehicle_id=123&start=2024-01-01&end=2024-01-31"
```

A bar chart shows daily driving distance with color coding:

- **Green** — Below average daily mileage
- **Amber** — Average daily mileage
- **Red** — Above average daily mileage

### Monthly Mileage

```bash
curl "http://localhost:8080/api/v1/mileage/monthly?vehicle_id=123"
```

Monthly totals displayed as a bar chart with year-over-year comparison.

### Mileage Statistics

```bash
curl "http://localhost:8080/api/v1/mileage/stats?vehicle_id=123"
```

Returns:

```json
{
  "total_distance": 25430.2,
  "avg_daily_distance": 42.5,
  "max_daily_distance": 350.0,
  "driving_days": 598,
  "non_driving_days": 132
}
```

## Vampire Drain Analysis

The **Vampire Drain** page (`/vampire-drain`) analyzes standby battery loss:

```bash
# List vampire drain events
curl http://localhost:8080/api/v1/vampire-drain?vehicle_id=123

# Vampire drain statistics
curl http://localhost:8080/api/v1/vampire-drain/stats?vehicle_id=123
```

### Vampire Drain Charts

- **Drain events** — Timeline showing when and how much battery was lost while parked
- **Average drain rate** — kWh/hour or %/hour while parked
- **Sentry mode impact** — Drain rate comparison with/without sentry mode
- **Temperature correlation** — Drain rate vs. outside temperature

## Tire Pressure

The **Tire Pressure** page (`/tire-pressure`) monitors tire health:

```bash
# Tire pressure history
curl http://localhost:8080/api/v1/tire-pressure?vehicle_id=123

# Latest readings
curl http://localhost:8080/api/v1/tire-pressure/latest?vehicle_id=123
```

Displays a 4-wheel visualization with friendly labels (e.g., "Front Left" instead of i18n keys), pressure unit in column headers (bar/psi based on settings), and alerts for low or uneven pressure. Zero-value readings are filtered out on both insert and display. Position data with (0,0) coordinates is also filtered out to prevent map artifacts.

## Software Updates

The **Software Updates** page (`/software-updates`) tracks firmware versions:

```bash
curl http://localhost:8080/api/v1/software-updates?vehicle_id=123
```

Shows a timeline of software updates with version numbers, install dates, and release notes links.

## Visited Locations

The **Locations** page (`/locations`) shows frequently visited places:

```bash
curl http://localhost:8080/api/v1/locations?vehicle_id=123
```

A table and map showing:

- Location name (if matched to a geofence) or address
- Visit count
- Last visited date
- Average duration at location

## Grafana Dashboards

In addition to the built-in charts, TeslaSync ships with 5 pre-built Grafana dashboards:

| Dashboard | Metrics |
|-----------|---------|
| **Vehicle Overview** | Battery, range, speed, temperature over time |
| **Charging** | Session count, energy added, cost trends |
| **Drives** | Distance per drive, average speed, efficiency |
| **Battery Health** | Degradation, charge cycles, SOC distribution |
| **Fleet Overview** | Cross-vehicle comparison, fleet totals, cost allocation |

Access Grafana at [http://localhost:3001](http://localhost:3001) (default login: `admin` / `teslasync`).

### Custom Dashboards

Create custom dashboards in Grafana using the pre-configured PostgreSQL datasource:

```sql
-- Example: Battery level over time
SELECT created_at AS time, battery_level
FROM positions
WHERE vehicle_id = 123
  AND $__timeFilter(created_at)
ORDER BY time
```

## Statistics Page

The **Statistics** page (`/statistics`) provides summary statistics:

- Total distance driven (all time, this month, this week)
- Total energy consumed and cost
- Most efficient drive
- Longest drive
- Most expensive charging session
- Average daily mileage
- Fleet utilization percentage
