-- Phase-42 / Prompt 0032: Recreate charging_telemetry + charging_sessions
-- with SI-canonical columns.
--
-- ADR-004 #4: every unit-bearing column lives in canonical SI and the
-- unit suffix is part of the column name (power_w, energy_wh, voltage_v,
-- current_a, odometer_m, ...). The contract is self-documenting and
-- audit-grep-able — a future reader (or a linter) cannot mistake an SI
-- value for a wire-format value.
--
-- Forward-only rewrite: the pre-phase-42 charging hot tables came in
-- two waves —
--   1. 000142_baseline_typed created `charging_telemetry` (hypertable,
--      kWh / mph / miles columns) and `charging_sessions` (regular
--      table, kWh / miles / miles_added columns).
--   2. 000146_drop_snapshot_tables dropped `charging_telemetry` (along
--      with `charge_telemetry_readings` and the `cagg_charging_summary`
--      continuous aggregate that fed off it via CASCADE).
-- `charging_sessions` was NOT dropped by 000146, so the legacy
-- regular table is still in place at the time this migration runs.
-- 000150_charging_session_charger_specs subsequently added
-- max_charger_voltage / charger_phases / cable_type to the legacy
-- charging_sessions schema.
--
-- Phase-42 is forward-only with no legacy retention
-- (.github/ARCHITECTURE.md ADR-004), so this migration drops the
-- residual legacy `charging_sessions` table wholesale (any pre-phase-42
-- pl/pgsql analytics functions that reference it — fn_battery_charge_cycles,
-- fn_charging_*_distribution, fn_true_cost_*, fn_weekly_activity — will
-- fail at runtime against the new schema; ADR-004 explicitly accepts
-- that as the cost of a forward-only rewrite, and a follow-up phase-42
-- prompt removes / rewrites those functions). Existing rows are not
-- migrated; clients backfill from MQTT replay if needed (prompt 0090
-- runbook).
--
-- Slot variance: prompt 0032 hardcodes slot 000164, but that slot is
-- already occupied by 000164_saved_views (a pre-phase-42 migration
-- committed before this phase began). Slot 000184 is the next free
-- slot after the trailing edge of existing migrations
-- (000183_snapshots_si is the immediately prior phase-42 migration,
-- created by prompt 0031). This mirrors the slot-variance the
-- predecessor phase-42 prompts 0022, 0030, and 0031 applied. The
-- schema, semantics, and gate intent are otherwise exactly as the
-- prompt specifies.
--
-- Tables created:
--   charging_telemetry  — per-tick charging readings (1 Hz when active);
--                         hypertable on `ts`, chunk = 7 days.
--   charging_sessions   — one row per charging session (start/end
--                         summary); regular table keyed by id with a
--                         (vehicle_id, started_at) index.
--
-- Routing rule (prompt 0046 wires this in routing.yaml):
--   charging-category atomics  -> charging_telemetry
--   session-completion summary -> charging_sessions (writer-built; not a
--                                  direct router destination)
--
-- Compression and retention policies are intentionally NOT applied
-- here; phase-42 defers those policy decisions to a later operational
-- prompt, the same way prompts 0030 and 0031 omitted them.

-- Defensive: drop any leftover legacy charging objects so this migration
-- is self-healing if a developer reapplies an old database snapshot.
-- CASCADE handles the FK from the legacy charge_telemetry_readings table
-- and the legacy cagg_charging_summary materialized view.
DROP MATERIALIZED VIEW IF EXISTS cagg_charging_summary CASCADE;
DROP TABLE IF EXISTS charge_telemetry_readings CASCADE;
DROP TABLE IF EXISTS charging_telemetry CASCADE;
DROP TABLE IF EXISTS charging_sessions CASCADE;

-- =========================================================================
-- charging_telemetry — per-tick charging hot table.
-- One row per (vehicle_id, ts) carrying the latest known value of every
-- charging-category atomic. Power in Watts, energy in Watt-hours, voltage
-- in Volts, current in Amperes, percent volume in _pct — all SI canonical.
-- session_id is intentionally a plain BIGINT (no FK constraint): the
-- writer attributes a tick to a session by id, but the hot path must not
-- block on a referential check, and a tick can legitimately precede the
-- corresponding charging_sessions row by a few writes (the session row
-- is inserted by the session-completion writer, not the per-tick writer).
-- =========================================================================
CREATE TABLE charging_telemetry (
  vehicle_id                  BIGINT      NOT NULL,
  ts                          TIMESTAMPTZ NOT NULL,
  session_id                  BIGINT,
  ac_charging_power_w         DOUBLE PRECISION,
  dc_charging_power_w         DOUBLE PRECISION,
  ac_charging_energy_in_wh    DOUBLE PRECISION,
  dc_charging_energy_in_wh    DOUBLE PRECISION,
  charger_voltage_v           DOUBLE PRECISION,
  charger_actual_current_a    DOUBLE PRECISION,
  charger_pilot_current_a     DOUBLE PRECISION,
  charger_phases              INTEGER,
  battery_heater_on           BOOLEAN,
  battery_heater_power_w      DOUBLE PRECISION,
  charge_limit_soc_pct        DOUBLE PRECISION,
  charge_request              TEXT,
  fast_charger_type           TEXT,
  charging_cable_type         TEXT,
  charge_port_door_open       BOOLEAN,
  charge_port_latch           TEXT,
  PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('charging_telemetry', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX charging_telemetry_vehicle_ts ON charging_telemetry (vehicle_id, ts DESC);
CREATE INDEX charging_telemetry_session_ts ON charging_telemetry (session_id, ts) WHERE session_id IS NOT NULL;

COMMENT ON TABLE charging_telemetry IS
  'Phase-42 SI-canonical charging hypertable (per-tick readings, ~1 Hz when charging). Power in Watts, energy in Watt-hours, voltage in Volts, current in Amperes.';
COMMENT ON COLUMN charging_telemetry.session_id IS
  'Foreign key value (no constraint) into charging_sessions(id). Nullable while a tick is unattributed.';
COMMENT ON COLUMN charging_telemetry.ac_charging_power_w IS
  'Instantaneous AC charging power in Watts (SI). Sourced from ACChargingPower.';
COMMENT ON COLUMN charging_telemetry.dc_charging_power_w IS
  'Instantaneous DC charging power in Watts (SI). Sourced from DCChargingPower.';
COMMENT ON COLUMN charging_telemetry.ac_charging_energy_in_wh IS
  'Cumulative AC energy delivered this session in Watt-hours (SI). Sourced from ACChargingEnergyIn.';
COMMENT ON COLUMN charging_telemetry.dc_charging_energy_in_wh IS
  'Cumulative DC energy delivered this session in Watt-hours (SI). Sourced from DCChargingEnergyIn.';
COMMENT ON COLUMN charging_telemetry.charger_voltage_v IS
  'Charger voltage in Volts (SI). Sourced from ChargerVoltage.';
COMMENT ON COLUMN charging_telemetry.charger_actual_current_a IS
  'Charger actual current draw in Amperes (SI). Sourced from ChargerActualCurrent.';
COMMENT ON COLUMN charging_telemetry.charger_pilot_current_a IS
  'Charger pilot signal current in Amperes (SI). Sourced from ChargerPilotCurrent.';
COMMENT ON COLUMN charging_telemetry.charger_phases IS
  'Number of AC phases used by the charger (1 or 3). Integer count, no SI conversion.';
COMMENT ON COLUMN charging_telemetry.battery_heater_on IS
  'True when the battery heater is currently drawing power.';
COMMENT ON COLUMN charging_telemetry.battery_heater_power_w IS
  'Battery heater power draw in Watts (SI). Sourced from BatteryHeaterPower.';
COMMENT ON COLUMN charging_telemetry.charge_limit_soc_pct IS
  'User-configured charge limit as a percent of pack capacity, 0-100. Sourced from ChargeLimitSoc.';
COMMENT ON COLUMN charging_telemetry.charge_request IS
  'Charge-request enum from Fleet Telemetry (e.g. "ChargeRequest_None"). Free-text, no closed enum.';
COMMENT ON COLUMN charging_telemetry.fast_charger_type IS
  'Fast-charger type token from Fleet Telemetry (e.g. "Tesla", "CCS"). Sourced from FastChargerType.';
COMMENT ON COLUMN charging_telemetry.charging_cable_type IS
  'Cable type token from Fleet Telemetry. Sourced from ChargingCableType.';
COMMENT ON COLUMN charging_telemetry.charge_port_door_open IS
  'True when the charge port door is open. Sourced from ChargePortDoorOpen.';
COMMENT ON COLUMN charging_telemetry.charge_port_latch IS
  'Charge-port latch state from Fleet Telemetry (e.g. "Engaged"). Sourced from ChargePortLatch.';

-- =========================================================================
-- charging_sessions — one row per charging session (start/end summary).
-- Regular (non-hypertable) table keyed by `id`. Built by the session-
-- completion writer at session-end time from the per-tick rows in
-- charging_telemetry plus the latest signal_log values for SoC /
-- odometer / position. Energy in Wh, power in W, distance in m — all SI.
-- cost_decimal / cost_currency are preserved verbatim (cost-tracking
-- analytics depend on them; the cost is in cost_currency, NUMERIC for
-- monetary precision).
-- =========================================================================
CREATE TABLE charging_sessions (
  id                     BIGSERIAL    PRIMARY KEY,
  vehicle_id             BIGINT       NOT NULL,
  started_at             TIMESTAMPTZ  NOT NULL,
  ended_at               TIMESTAMPTZ,
  start_soc_pct          DOUBLE PRECISION,
  end_soc_pct            DOUBLE PRECISION,
  delta_soc_pct          DOUBLE PRECISION,
  start_odometer_m       DOUBLE PRECISION,
  end_odometer_m         DOUBLE PRECISION,
  start_lat              DOUBLE PRECISION,
  start_lng              DOUBLE PRECISION,
  start_place            TEXT,
  total_energy_added_wh  DOUBLE PRECISION,
  peak_power_w           DOUBLE PRECISION,
  avg_power_w            DOUBLE PRECISION,
  cost_decimal           NUMERIC(12, 4),
  cost_currency          CHAR(3),
  charger_type           TEXT,
  cable_type             TEXT
);

CREATE INDEX charging_sessions_vehicle_started ON charging_sessions (vehicle_id, started_at DESC);

COMMENT ON TABLE charging_sessions IS
  'Phase-42 SI-canonical charging-session summary table. One row per session, built at session-end time from charging_telemetry. Regular table (not a hypertable).';
COMMENT ON COLUMN charging_sessions.id IS
  'Surrogate primary key (BIGSERIAL). charging_telemetry.session_id refers to this value (no DB-level FK; see charging_telemetry comment).';
COMMENT ON COLUMN charging_sessions.started_at IS
  'Wall-clock timestamp at which the session began (first ChargeState=Charging tick).';
COMMENT ON COLUMN charging_sessions.ended_at IS
  'Wall-clock timestamp at which the session ended. NULL while in progress.';
COMMENT ON COLUMN charging_sessions.start_soc_pct IS
  'Battery SoC at session start, percent of pack capacity (0-100). Sourced from BatteryLevel at started_at.';
COMMENT ON COLUMN charging_sessions.end_soc_pct IS
  'Battery SoC at session end, percent of pack capacity (0-100). Sourced from BatteryLevel at ended_at.';
COMMENT ON COLUMN charging_sessions.delta_soc_pct IS
  'Computed SoC delta over the session (end_soc_pct - start_soc_pct). Stored to avoid recomputation in analytics.';
COMMENT ON COLUMN charging_sessions.start_odometer_m IS
  'Odometer reading in meters at session start (SI).';
COMMENT ON COLUMN charging_sessions.end_odometer_m IS
  'Odometer reading in meters at session end (SI).';
COMMENT ON COLUMN charging_sessions.start_lat IS
  'WGS84 latitude in decimal degrees at session start (angular, no SI conversion).';
COMMENT ON COLUMN charging_sessions.start_lng IS
  'WGS84 longitude in decimal degrees at session start (angular, no SI conversion).';
COMMENT ON COLUMN charging_sessions.start_place IS
  'Geocoded place name at session start. Free-text label.';
COMMENT ON COLUMN charging_sessions.total_energy_added_wh IS
  'Total energy delivered to the pack during this session in Watt-hours (SI). Sum of AC + DC.';
COMMENT ON COLUMN charging_sessions.peak_power_w IS
  'Peak instantaneous charging power observed during the session in Watts (SI).';
COMMENT ON COLUMN charging_sessions.avg_power_w IS
  'Mean charging power during the active portion of the session in Watts (SI).';
COMMENT ON COLUMN charging_sessions.cost_decimal IS
  'Computed monetary cost of the session in cost_currency. NUMERIC for precision; preserved for cost-tracking analytics.';
COMMENT ON COLUMN charging_sessions.cost_currency IS
  'ISO 4217 currency code for cost_decimal (e.g. "USD", "EUR", "GBP").';
COMMENT ON COLUMN charging_sessions.charger_type IS
  'Charger family token (e.g. "Supercharger", "Wall_Connector"). Free-text, no closed enum.';
COMMENT ON COLUMN charging_sessions.cable_type IS
  'Cable type token from Fleet Telemetry. Sourced from ChargingCableType at session start.';
