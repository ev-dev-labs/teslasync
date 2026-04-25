# Phase 16 — Data Gaps: Replace Empty TODO Stubs with Real signal_log Queries

## Goal

Phase 14 agent replaced some dropped-table queries with empty data / TODO comments
instead of implementing the signal_log replacement. This phase fills those gaps,
cleans up dead dispatch code, and standardizes chart rendering across the frontend.

## Data gaps found

### Battery Health (5 gaps — user-visible empty charts/data)
| File | Line | What's empty | Fix |
|---|---|---|---|
| `battery_handler.go` | 75 | Monthly battery trend = `[]` | Query `cagg_battery_daily` for BatteryLevel over time |
| `analytics_handler.go` | 124 | Per-vehicle battery health empty | `SnapshotAt(now)` for latest BatteryLevel + derive health |
| `analytics_handler.go` | 268 | Battery trend in fleet analytics empty | Same as battery_handler trend |
| `export/analytics.go` | 103 | Battery health in export empty | Same pattern |
| `export/analytics.go` | 217 | Battery trend in export empty | Same pattern |

### Dead dispatch code (3 gaps — no-op comments where code should be deleted)
| File | Line | What | Fix |
|---|---|---|---|
| `telemetry_handler.go` | 1712 | Media snapshot write = no-op comment | Delete entire `trackMedia` function |
| `telemetry_handler.go` | 1825 | Vehicle config write = no-op comment | Trim `trackVehicleConfig` — keep `swUpdateRepo.InsertIfChanged` for firmware tracking |
| `telemetry_sessions.go` | 165 | Buffer callbacks = no-ops comment | Remove dead callback wiring |

### Compound signal loss (1 critical gap — Location never reaches signal_log)
| File | Line | What | Fix |
|---|---|---|---|
| `signal_history_writer.go` | 87 | Compounds stored as opaque JSONB — Location lat/lng invisible to SnapshotAt | Flatten Location→Lat/Lng rows in writer + unpack historical Location JSONB in reader |

### Drive/Charge completion fields null (2 gaps — schema mismatch + missing fields)
| File | What | Fix |
|---|---|---|
| `telemetry_sessions.go` (drive) | `score`, `ended_status` always NULL | Audit + fix every field in drives UPDATE |
| `telemetry_sessions.go` (charge) | writes to non-existent columns (`latitude`, `inside_temp_avg_c`, etc.); `charger_location`, `cost_currency`, `ended_status` never set | Rewrite against actual charging_sessions schema |

## Prompt ordering (14 atomic prompts)

```
── Data gaps ──
00 — Battery trend from cagg_battery_daily (battery_handler.go + analytics_handler.go + router.go)
01 — Battery trend in export (analytics.go + processor.go)
02 — Clean dead dispatch: delete trackMedia, trim trackVehicleConfig (keep firmware tracking), remove buffer no-ops
03 — Flatten Location compounds in writer + unpack Location in SnapshotAt reader
04 — Drive completion audit: fix ALL 20+ null fields in drives UPDATE (score, ended_status, orphan closure)
05 — Charge completion audit: fix all null fields using ACTUAL schema (charger_location, cost_currency, ended_status)

── Chart refactor (smoothed area) ──
06 — Create shared chartDefaults.tsx (AREA_DEFAULTS + areaGradient)
07 — Charts: drive detail (SpeedTrendChart, PowerProfileChart, ElevationProfile, SocChart, TemperatureSection, TemperatureTrendChart, DriveAnalyticsSection)
08 — Charts: charging detail (ChargingDetailPage, SessionCurveChart, SessionComparisonChart, CostPerKwhChart, MonthlyCostChart, PowerOutputChart, ChargingDetailSection)
09 — Charts: battery + energy (BatteryCellsPage, BatteryDegradationPage, BatteryDegradationTrendWidget, BatteryHealthPage, BatteryRangeCharts, EnergyPage, EnergyFlowPage)
10 — Charts: vehicle systems (TirePressurePage, TirePressureSection, ClimateControlPage, MotorHistoryCharts, StatorTempChart, TorqueHistoryChart, SafetySettingsPage, VampireDrainPage)
11 — Charts: analytics (SpeedProfilePage, TemperatureImpactPage, EfficiencyPage, RegenEfficiencyPage, ComparisonPage, DriveScorePage, DrivingCoachSection, CostForecastSection)
12 — Charts: remaining (DrivesListPage, DriveEfficiencyChartWidget, DriveOverviewChart, tabs, ChartsRow, ProjectedRangePage, PowerFlowDashboardPage, MileagePage, YearlyTrendChart, SharedDrivePage, TripReplayPage, NavigationRoutePage, SOCRouteChart, VehicleCharts, MediaPlayerPage, SignalDiffPage, FSMTimelineChart)

── Gate ──
13 — Gate: go build + go vet + tsc + zero TODOs + zero dead dispatch + zero dot={true} + API scan + drive field DB check
```

## Key fixes from rubber-duck review

1. **Prompt 02** — `trackVehicleConfig` preserves `swUpdateRepo.InsertIfChanged` for firmware version tracking (not deleted entirely)
2. **Prompt 03** — Writer flattens Location-type compounds ONLY; Reader unpacks historical Location JSONB in `SnapshotAt()`
3. **Prompt 05** — Charge audit uses actual `charging_sessions` schema (no latitude/longitude/temp columns); fixes `location_name` → `charger_location`
4. **Prompts 00/01** — Allowed files include `router.go` and `processor.go` for wiring `SignalLogReader`
5. **Prompt 06** — File is `chartDefaults.tsx` (not `.ts`) since `areaGradient()` returns JSX
6. **Prompt 13** — Gate fails on: go vet, TODO…signal_log refs, dead dispatch refs, API failures, dot={true} in feature tsx
7. **Prompts 07–12** — Chart files grouped by actual directory path, not assumed domain
