# Phase 16 — Data Gaps: Replace Empty TODO Stubs with Real signal_log Queries

## Goal

Phase 14 agent replaced some dropped-table queries with empty data / TODO comments
instead of implementing the signal_log replacement. This phase fills those gaps.

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
| `telemetry_handler.go` | 1825 | Vehicle config write = no-op comment | Delete entire `trackVehicleConfig` function |
| `telemetry_sessions.go` | 165 | Buffer callbacks = no-ops comment | Remove dead callback wiring |

### Compound signal loss (1 critical gap — Location never reaches signal_log)
| File | Line | What | Fix |
|---|---|---|---|
| `signal_history_writer.go` | 83 | `map[string]interface{}: continue` skips Location | Flatten lat/lng + store others as JSONB |

### Drive/Charge completion fields null (2 gaps — SnapshotAt not filling all columns)
| File | What | Fix |
|---|---|---|
| `telemetry_sessions.go` (drive) | start/end lat/lon, energy, regen, score, ended_status all null | Audit + fix every field in UPDATE |
| `telemetry_sessions.go` (charge) | charger_location, power max/avg, cost may be null | Audit + fix every field in UPDATE |

## Prompt ordering (9 atomic prompts)

```
00 — Battery trend: implement from cagg_battery_daily (battery_handler + analytics_handler)
01 — Battery trend: implement in export/analytics.go
02 — Remove dead snapshot dispatch (trackMedia, trackVehicleConfig, buffer callbacks)
04 — Flatten compound signals in signal_history_writer (Location → Latitude + Longitude rows)
05 — Drive completion audit: fix ALL null fields (lat/lon, energy, regen, score, ended_status)
06 — Charge completion audit: fix ALL null fields (same pattern)
07 — Gate: build + vet + zero TODOs + zero dead dispatch + battery data + drive field check
08 — Chart refactor: scatter points → continuous smoothed area charts (50+ files)
```
