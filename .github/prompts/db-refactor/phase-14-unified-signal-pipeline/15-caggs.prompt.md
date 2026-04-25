---
description: "Phase-14 — Continuous aggregates for dashboard reads"
---
# Prompt 15 — Continuous Aggregates (replace snapshot table reads)
> **Severity:** Performance | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-15-caggs.log` |
| Allowed files to change | `internal/database/migrations/` (new migration), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (signal_log hypertable)

## Context

Dashboard pages (fleet overview, battery health, energy stats, climate) previously
read from snapshot tables. Those are gone. For historical/aggregated views, we need
TimescaleDB continuous aggregates over signal_log.

Live/real-time reads come from Redis (prompt 14 handles that). Continuous aggregates
are for historical trend pages.

## Task

### Create continuous aggregates for key dashboard views

```sql
-- 1. Fleet daily stats (replaces cagg_fleet_stats partially)
CREATE MATERIALIZED VIEW IF NOT EXISTS cagg_vehicle_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', created_at) AS bucket,
  vehicle_id,
  last(value_num, created_at) FILTER (WHERE signal = 'BatteryLevel') AS battery_level,
  last(value_num, created_at) FILTER (WHERE signal = 'Odometer') AS odometer,
  avg(value_num) FILTER (WHERE signal = 'VehicleSpeed' AND value_num > 0) AS avg_speed,
  max(value_num) FILTER (WHERE signal = 'VehicleSpeed') AS max_speed,
  avg(value_num) FILTER (WHERE signal = 'OutsideTemp') AS avg_outside_temp,
  avg(value_num) FILTER (WHERE signal = 'InsideTemp') AS avg_inside_temp,
  count(*) FILTER (WHERE signal = 'VehicleSpeed' AND value_num > 0) AS driving_signal_count
FROM signal_log
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_vehicle_daily',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour'
);

-- 2. Climate hourly (for climate trend pages)
CREATE MATERIALIZED VIEW IF NOT EXISTS cagg_climate_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', created_at) AS bucket,
  vehicle_id,
  avg(value_num) FILTER (WHERE signal = 'InsideTemp') AS avg_inside_temp,
  avg(value_num) FILTER (WHERE signal = 'OutsideTemp') AS avg_outside_temp,
  last(value_str, created_at) FILTER (WHERE signal = 'HvacPower') AS hvac_state,
  last(value_bool, created_at) FILTER (WHERE signal = 'DefrostMode') AS defrost_on
FROM signal_log
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_climate_hourly',
  start_offset => INTERVAL '2 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes'
);

-- 3. Battery health daily (for degradation trend)
CREATE MATERIALIZED VIEW IF NOT EXISTS cagg_battery_daily
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', created_at) AS bucket,
  vehicle_id,
  min(value_num) FILTER (WHERE signal = 'BatteryLevel') AS min_soc,
  max(value_num) FILTER (WHERE signal = 'BatteryLevel') AS max_soc,
  last(value_num, created_at) FILTER (WHERE signal = 'BatteryLevel') AS end_soc,
  avg(value_num) FILTER (WHERE signal = 'PackVoltage') AS avg_pack_voltage,
  count(*) FILTER (WHERE signal = 'ACChargingEnergyIn') AS charge_signal_count
FROM signal_log
GROUP BY bucket, vehicle_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('cagg_battery_daily',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour'
);
```

### Constraints

- Use `WITH NO DATA` — aggregates populate on next refresh cycle, not at creation
- Refresh policies auto-refresh; no manual REFRESH needed
- Handlers that need these aggregates should query the cagg views instead of signal_log
  for better performance (handler rewiring is in prompt 14)
- Add more aggregates later as needed — this is the starter set

## Gate

```powershell
cd D:\repos\teslasync
# Apply migration
docker exec -i teslasync-postgres psql -U teslasync -d teslasync < internal/database/migrations/XXXXXX_continuous_aggregates.up.sql
# Verify
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY 1;"
# Should list cagg_vehicle_daily, cagg_climate_hourly, cagg_battery_daily
```

Log result. STATUS=DONE only if all 3 continuous aggregates created.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/15-caggs: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/15-caggs` as the commit message prefix.

