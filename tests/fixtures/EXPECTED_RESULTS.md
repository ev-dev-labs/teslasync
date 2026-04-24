# Signal Replay Test — Expected Results Report

**Date:** 2026-04-23
**Source:** `prod-signals/signal_history_last_7d.csv`
**Replay window:** 2026-04-18 00:22:00 → 00:46:30 UTC (24.5 minutes)
**Signals:** 6,672 across 80+ signal types
**Test vehicle:** VIN=`TEST00000000000VIN`, ID=1, Units=Miles/Fahrenheit/PSI

---

## Scenario: R → D → P Short Drive

### Input Gear Sequence

| Timestamp (UTC) | Gear | Expected FSM state |
|---|---|---|
| 00:44:26 | R | Online → stay Parked (reverse, not driving) |
| 00:44:35 | **D** | **→ Driving** (TriggerGearDriving) |
| 00:44:45 | **P** | **→ Parked** (TriggerGearParked + GuardNoCharge) |

### Input Speed Values (during D phase)

| Timestamp | Speed (mph) |
|---|---|
| 00:44:34 | 1 |
| 00:44:39 | 1 |
| 00:44:44 | 0 |

---

## Expected Database State After Replay

### 1. `vehicles` table
- [ ] Vehicle ID=1 exists (pre-seeded)
- [ ] No new vehicles created

### 2. `vehicle_live_state` table
- [ ] Row for vehicle_id=1 updated
- [ ] Last known signals reflect final batch values:
  - `gear` = `P`
  - `vehicle_speed` = `0`
  - `battery_level` ≈ `90.5`
  - `soc` ≈ `90.4`
  - `pack_voltage` ≈ `394.6`
  - `inside_temp` ≈ `18.3`
  - `outside_temp` ≈ `14.5`
  - `odometer` ≈ `26595.88`
  - `locked` = `false`

### 3. `drives` table
- [ ] **One new drive row** created for vehicle_id=1
- [ ] `start_ts` ≈ `2026-04-18 00:44:35` (when Gear=D)
- [ ] `end_ts` ≈ `2026-04-18 00:44:45` (when Gear=P)
- [ ] `duration_min` ≈ `0.17` (~10 seconds)
- [ ] `distance_mi` — small value or 0 (speed was 0-1 mph for 10 seconds)
- [ ] `start_battery_pct` ≈ 90 or 91
- [ ] `end_battery_pct` ≈ 90 or 91
- [ ] `ended_status` = `completed`

### 4. `positions` table (hypertable)
- [ ] Multiple rows for vehicle_id=1 during the drive window
- [ ] Each row has: latitude, longitude, heading, speed_mph, elevation_m
- [ ] **Note:** Lat/lon may NOT be present — signal_history doesn't store GPS coordinates (they come via Fleet Telemetry proto). Heading IS present.
- [ ] If no lat/lon signals → zero position rows is acceptable

### 5. `tire_pressure_snapshots` table
- [ ] At least 1-2 rows from the pre-drive readings:
  - `front_left` ≈ 3.0 (bar — this is raw value from Tesla)
  - `front_right` ≈ 3.0
  - `rear_right` ≈ 3.0
- [ ] Post-drive reading (00:46:15):
  - `front_left` ≈ 3.075
  - `front_right` ≈ 3.05
  - `rear_left` ≈ 3.075
  - `rear_right` ≈ 3.05

### 6. `climate_snapshots` table
- [ ] Multiple rows covering the 24-minute window
- [ ] `inside_temp_c` ranges from ~22.2 down to ~18.3 (cooling cabin)
- [ ] `outside_temp_c` ranges from 18.0 down to ~14.5
- [ ] HVAC status fields populated if signals present

### 7. `motor_snapshots` table
- [ ] Rows during the drive window (00:44:35 → 00:44:45)
- [ ] `power_kw` values present
- [ ] Motor RPM/torque/current values — depends on model field mapping

### 8. `security_events` table
- [ ] Lock/unlock events:
  - 00:22:14 Locked=false (unlock)
  - 00:26:04 Locked=true (lock)
  - 00:44:45 Locked=false (unlock at park)
- [ ] Sentry mode changes if value_bool is populated

### 9. `charging_telemetry` table
- [ ] Rows during charging phase (00:22 → 00:44) — pack voltage, current, SOC
- [ ] **Note:** The car was likely NOT actively charging (Gear transitions suggest parked→drive), but battery telemetry still arrives

### 10. FSM State (in-memory, verify via API)
- [ ] `GET /api/v1/vehicles/1/state` should show current FSM state
- [ ] After replay: FSM state = `Parked` (D→P completed)

---

## Verification Queries

Run these AFTER replay completes:

```sql
-- Drive created?
SELECT id, start_ts, end_ts, duration_min, distance_mi, start_battery_pct, end_battery_pct, ended_status
FROM drives WHERE vehicle_id = 1 ORDER BY start_ts DESC LIMIT 5;

-- Vehicle live state updated?
SELECT gear, vehicle_speed, battery_level, soc, inside_temp, outside_temp, odometer, locked
FROM vehicle_live_state WHERE vehicle_id = 1;

-- Positions written?
SELECT count(*), min(ts), max(ts) FROM positions WHERE vehicle_id = 1;

-- Tire pressure snapshots?
SELECT front_left, front_right, rear_left, rear_right, created_at
FROM tire_pressure_snapshots WHERE vehicle_id = 1 ORDER BY created_at DESC LIMIT 5;

-- Climate snapshots?
SELECT inside_temp_c, outside_temp_c, ts
FROM climate_snapshots WHERE vehicle_id = 1 ORDER BY ts DESC LIMIT 10;

-- Security events?
SELECT event_type, locked, sentry_mode, ts
FROM security_events WHERE vehicle_id = 1 ORDER BY ts DESC LIMIT 10;

-- Motor snapshots?
SELECT power_kw, ts FROM motor_snapshots WHERE vehicle_id = 1 ORDER BY ts DESC LIMIT 10;

-- FSM state via API
-- curl http://localhost:8080/api/v1/vehicles/1/state
```

---

## Pass/Fail Criteria

| # | Check | Pass | Fail |
|---|---|---|---|
| 1 | No panics/crashes in API logs | Clean logs | Stack trace in `docker logs teslasync-api` |
| 2 | Drive row created | `drives` has 1 row with start_ts ≈ 00:44:35 | No drive row |
| 3 | vehicle_live_state updated | gear=P, battery≈90, temps present | Row empty or stale |
| 4 | Climate snapshots written | ≥10 rows with inside_temp_c values | 0 rows |
| 5 | Tire pressure written | ≥1 row with front_left≈3.0 | 0 rows |
| 6 | No SQL errors in logs | No `failed to insert` warnings | SQL errors in log |
| 7 | API responds after replay | `/vehicles/1/state` returns 200 | 500 or empty |

---

## Known Limitations

1. **No GPS lat/lon in signal_history** — positions may not be written
2. **Short drive (10s)** — drive detection may require a minimum duration threshold
3. **VIN mapping** — replay publishes under `TEST00000000000VIN`, handler must resolve to vehicle_id=1
4. **Unit columns** — new unit columns (distance_unit, temp_unit, pressure_unit) are from future-1 phase, not yet migrated. Values will be 0 (Unknown) or column may not exist.
5. **Charging telemetry** — the pre-drive battery signals may trigger charging session creation if charge detection logic fires
