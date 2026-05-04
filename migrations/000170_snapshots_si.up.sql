-- Phase-42 / Prompt 0031: Recreate the 7 snapshot hypertables with
-- SI-canonical columns.
--
-- ADR-004 #4: every unit-bearing column lives in canonical SI and the
-- unit suffix is part of the column name (temperature_c, pressure_pa,
-- power_w, torque_nm, current_a, voltage_v, range_m, ...). The contract
-- is self-documenting and audit-grep-able — a future reader (or a
-- linter) cannot mistake an SI value for a wire-format value.
--
-- Forward-only rewrite: the pre-phase-42 snapshot tables created in
-- migration 000142_baseline_typed (and predecessors) were dropped by
-- migration 000146_drop_snapshot_tables. Phase-42 is forward-only with
-- no legacy retention (.github/ARCHITECTURE.md ADR-004), so this
-- migration recreates the snapshot hypertables with SI-canonical
-- columns. Existing rows are not migrated; clients backfill from MQTT
-- replay if needed (see prompt 0090 runbook).
--
-- Slot variance: prompt 0031 hardcodes slot 000163, but that slot is
-- already occupied by 000163_audit_logs_actor_metadata (a pre-phase-42
-- migration committed before this phase began). Slot 000170 is the
-- next free slot after the trailing edge of existing migrations
-- (000169_positions_si is the immediately prior phase-42 migration,
-- created by prompt 0030). This mirrors the slot-variance the
-- predecessor phase-42 prompts 0022 and 0030 applied. The schema,
-- semantics, and gate intent are otherwise exactly as the prompt
-- specifies.
--
-- Tables created (all hypertables on `ts`, chunk = 7 days):
--   climate_snapshots         — HVAC, cabin, seat heaters/coolers
--   motor_snapshots           — drive inverter, stator, axle, torque
--   security_events           — append-only state-change event log
--   tire_pressure_snapshots   — TPMS, per-corner pressures + status
--   media_snapshots           — current media playback state
--   safety_snapshots          — service mode, wiper, crash flags
--   location_snapshots        — geocoded labels (raw lat/lng -> positions)
--
-- Routing rule (prompts 0042-0047 wire these in routing.yaml):
--   continuous-value telemetry -> *_snapshots
--   state-change events        -> security_events
--   raw geo coordinates        -> positions (prompt 0030)
--   battery / SoC / range      -> signal_log only (no hot table)
--
-- Compression and retention policies are intentionally NOT applied
-- here; phase-42 defers those policy decisions to a later operational
-- prompt, the same way prompt 0030 omitted them for `positions`.

DROP TABLE IF EXISTS climate_snapshots        CASCADE;
DROP TABLE IF EXISTS motor_snapshots          CASCADE;
DROP TABLE IF EXISTS security_events          CASCADE;
DROP TABLE IF EXISTS tire_pressure_snapshots  CASCADE;
DROP TABLE IF EXISTS media_snapshots          CASCADE;
DROP TABLE IF EXISTS safety_snapshots         CASCADE;
DROP TABLE IF EXISTS location_snapshots       CASCADE;

-- =========================================================================
-- climate_snapshots — HVAC + cabin + seat climate state.
-- One row per (vehicle_id, ts) carrying the latest known value of every
-- climate-category atomic. Temperature columns are Celsius (canonical SI
-- form for this codebase: see internal/tesla/units/conversions.go).
-- =========================================================================
CREATE TABLE climate_snapshots (
  vehicle_id                                     BIGINT      NOT NULL,
  ts                                             TIMESTAMPTZ NOT NULL,
  inside_temp_c                                  DOUBLE PRECISION,
  outside_temp_c                                 DOUBLE PRECISION,
  hvac_left_request_c                            DOUBLE PRECISION,
  hvac_right_request_c                           DOUBLE PRECISION,
  hvac_ac_enabled                                BOOLEAN,
  hvac_auto_mode                                 BOOLEAN,
  hvac_power                                     BOOLEAN,
  hvac_fan_speed                                 INTEGER,
  hvac_fan_status                                TEXT,
  hvac_steering_wheel_heat_auto                  BOOLEAN,
  hvac_steering_wheel_heat_level                 INTEGER,
  defrost_mode                                   TEXT,
  defrost_for_preconditioning                    BOOLEAN,
  preconditioning_enabled                        BOOLEAN,
  climate_keeper_mode                            TEXT,
  cabin_overheat_protection_mode                 TEXT,
  cabin_overheat_protection_temperature_limit_c  DOUBLE PRECISION,
  seat_heater_left                               INTEGER,
  seat_heater_right                              INTEGER,
  seat_heater_rear_left                          INTEGER,
  seat_heater_rear_right                         INTEGER,
  seat_heater_rear_center                        INTEGER,
  rear_seat_heaters                              TEXT,
  auto_seat_climate_left                         BOOLEAN,
  auto_seat_climate_right                        BOOLEAN,
  seat_vent_enabled                              BOOLEAN,
  climate_seat_cooling_front_left                INTEGER,
  climate_seat_cooling_front_right               INTEGER,
  wiper_heat_enabled                             BOOLEAN,
  driver_seat_belt                               BOOLEAN,
  passenger_seat_belt                            BOOLEAN,
  driver_seat_occupied                           BOOLEAN,
  PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('climate_snapshots', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX climate_snapshots_vehicle_ts ON climate_snapshots (vehicle_id, ts DESC);

COMMENT ON TABLE climate_snapshots IS
  'Phase-42 SI-canonical climate hypertable. Temperatures in Celsius.';
COMMENT ON COLUMN climate_snapshots.inside_temp_c IS
  'Cabin interior temperature in Celsius (SI canonical for temperature). Sourced from InsideTemp.';
COMMENT ON COLUMN climate_snapshots.outside_temp_c IS
  'Ambient outside temperature in Celsius. Sourced from OutsideTemp.';
COMMENT ON COLUMN climate_snapshots.hvac_left_request_c IS
  'Driver-side HVAC setpoint in Celsius. Sourced from HvacLeftTemperatureRequest.';
COMMENT ON COLUMN climate_snapshots.hvac_right_request_c IS
  'Passenger-side HVAC setpoint in Celsius. Sourced from HvacRightTemperatureRequest.';
COMMENT ON COLUMN climate_snapshots.cabin_overheat_protection_temperature_limit_c IS
  'Cabin overheat protection cap in Celsius.';

-- =========================================================================
-- motor_snapshots — drive inverter / stator / axle telemetry.
-- Covers all powertrain Di* atomics (DiTorqueActual, DiStatorTemp,
-- DiInverterT, DiHeatsinkT, DiAxleSpeed, DiVBat, DiMotorCurrent, DiState).
-- Per-corner positions are exposed as front / rear / rear_left / rear_right
-- to support tri-motor (Plaid) and quad-motor (Cybertruck) layouts.
-- =========================================================================
CREATE TABLE motor_snapshots (
  vehicle_id                BIGINT      NOT NULL,
  ts                        TIMESTAMPTZ NOT NULL,
  power_w                   DOUBLE PRECISION,
  front_torque_nm           DOUBLE PRECISION,
  rear_torque_nm            DOUBLE PRECISION,
  rear_left_torque_nm       DOUBLE PRECISION,
  rear_right_torque_nm      DOUBLE PRECISION,
  torque_motor_nm           DOUBLE PRECISION,
  torque_command_nm         DOUBLE PRECISION,
  front_stator_c            DOUBLE PRECISION,
  rear_stator_c             DOUBLE PRECISION,
  rear_left_stator_c        DOUBLE PRECISION,
  rear_right_stator_c       DOUBLE PRECISION,
  front_inverter_c          DOUBLE PRECISION,
  rear_inverter_c           DOUBLE PRECISION,
  rear_left_inverter_c      DOUBLE PRECISION,
  rear_right_inverter_c     DOUBLE PRECISION,
  front_heatsink_c          DOUBLE PRECISION,
  rear_heatsink_c           DOUBLE PRECISION,
  rear_left_heatsink_c      DOUBLE PRECISION,
  rear_right_heatsink_c     DOUBLE PRECISION,
  front_axle_speed_rpm      DOUBLE PRECISION,
  rear_axle_speed_rpm       DOUBLE PRECISION,
  rear_left_axle_speed_rpm  DOUBLE PRECISION,
  rear_right_axle_speed_rpm DOUBLE PRECISION,
  front_motor_current_a     DOUBLE PRECISION,
  rear_motor_current_a      DOUBLE PRECISION,
  rear_left_motor_current_a DOUBLE PRECISION,
  rear_right_motor_current_a DOUBLE PRECISION,
  front_vbat_v              DOUBLE PRECISION,
  rear_vbat_v               DOUBLE PRECISION,
  rear_left_vbat_v          DOUBLE PRECISION,
  rear_right_vbat_v         DOUBLE PRECISION,
  front_state               TEXT,
  rear_state                TEXT,
  rear_left_state           TEXT,
  rear_right_state          TEXT,
  hvil_state                TEXT,
  isolation_resistance_ohm  DOUBLE PRECISION,
  PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('motor_snapshots', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX motor_snapshots_vehicle_ts ON motor_snapshots (vehicle_id, ts DESC);

COMMENT ON TABLE motor_snapshots IS
  'Phase-42 SI-canonical motor / drive-inverter hypertable. Power in Watts, torque in Newton-meters, temperatures in Celsius, current in Amperes, voltage in Volts.';
COMMENT ON COLUMN motor_snapshots.power_w IS
  'Net drive power in Watts (SI). Sourced from the powertrain Power field once routed.';
COMMENT ON COLUMN motor_snapshots.front_torque_nm IS
  'Front-axle motor torque in Newton-meters (SI). Sourced from DiTorqueActualF.';
COMMENT ON COLUMN motor_snapshots.front_stator_c IS
  'Front-axle stator winding temperature in Celsius. Sourced from DiStatorTempF.';
COMMENT ON COLUMN motor_snapshots.front_axle_speed_rpm IS
  'Front-axle rotational speed in RPM. Not converted by units.ToSI (RPM is the field-natural unit; UnitKindNone in protomodel).';
COMMENT ON COLUMN motor_snapshots.isolation_resistance_ohm IS
  'High-voltage isolation resistance in Ohms (SI).';

-- =========================================================================
-- security_events — append-only state-change event log.
-- One row per discrete transition (lock/unlock, sentry on/off, door
-- open/close, airbag deployed, crash state changed, ...). Source of
-- truth for downstream alerts and the security timeline UI.
--
-- The composite PK includes event_type so two distinct event kinds at
-- the same instant remain insertable (e.g. AirbagDeployed and
-- CrashState changing in the same payload).
-- =========================================================================
CREATE TABLE security_events (
  vehicle_id BIGINT      NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  event_type TEXT        NOT NULL,
  from_state TEXT,
  to_state   TEXT,
  details    JSONB,
  PRIMARY KEY (vehicle_id, ts, event_type)
);

SELECT create_hypertable('security_events', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX security_events_vehicle_ts ON security_events (vehicle_id, ts DESC);
CREATE INDEX security_events_event_type ON security_events (event_type, ts DESC);

COMMENT ON TABLE security_events IS
  'Phase-42 append-only state-change log for security/safety transitions. No UPDATE — every change is a new row.';
COMMENT ON COLUMN security_events.event_type IS
  'Token identifying the transitioning field (e.g. sentry_mode, locked, airbag_deployed, crash_state).';
COMMENT ON COLUMN security_events.from_state IS
  'Previous value as a textual token. NULL for the first observation after process start.';
COMMENT ON COLUMN security_events.to_state IS
  'New value as a textual token. NOT NULL once a prior observation exists, but the column itself is nullable to allow first-observation rows.';
COMMENT ON COLUMN security_events.details IS
  'Optional structured context (door bitmap, sentry trigger reason, ...). Schema is event_type-specific.';

-- =========================================================================
-- tire_pressure_snapshots — TPMS per-corner readings + warning bits.
-- Pressures are stored in Pascals (canonical SI for pressure; see
-- internal/tesla/units/conversions.go which converts psi/bar to Pa).
-- Per-corner *_status columns surface TPMS warning bits (e.g. low, flat,
-- service-required) without parsing the bitmap downstream.
-- =========================================================================
CREATE TABLE tire_pressure_snapshots (
  vehicle_id              BIGINT      NOT NULL,
  ts                      TIMESTAMPTZ NOT NULL,
  front_left_pa           DOUBLE PRECISION,
  front_right_pa          DOUBLE PRECISION,
  rear_left_pa            DOUBLE PRECISION,
  rear_right_pa           DOUBLE PRECISION,
  front_left_status       TEXT,
  front_right_status      TEXT,
  rear_left_status        TEXT,
  rear_right_status       TEXT,
  front_left_last_seen_at  TIMESTAMPTZ,
  front_right_last_seen_at TIMESTAMPTZ,
  rear_left_last_seen_at   TIMESTAMPTZ,
  rear_right_last_seen_at  TIMESTAMPTZ,
  hard_warnings           TEXT,
  soft_warnings           TEXT,
  PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('tire_pressure_snapshots', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX tire_pressure_snapshots_vehicle_ts ON tire_pressure_snapshots (vehicle_id, ts DESC);

COMMENT ON TABLE tire_pressure_snapshots IS
  'Phase-42 SI-canonical TPMS hypertable. Pressures in Pascals.';
COMMENT ON COLUMN tire_pressure_snapshots.front_left_pa IS
  'Front-left tire pressure in Pascals (SI). Sourced from TpmsPressureFl after units.ToSI.';
COMMENT ON COLUMN tire_pressure_snapshots.front_left_status IS
  'TPMS status token for the front-left tire (ok / soft / hard / service).';
COMMENT ON COLUMN tire_pressure_snapshots.front_left_last_seen_at IS
  'Wall-clock instant the front-left TPMS last reported (TpmsLastSeenPressureTimeFl).';

-- =========================================================================
-- media_snapshots — current infotainment playback state.
-- volume_pct is stored as the integer percent the head unit reports
-- (0..100); volume_max documents the head unit's full-scale value when
-- non-default. Durations/positions are stored in seconds (SI).
-- =========================================================================
CREATE TABLE media_snapshots (
  vehicle_id       BIGINT      NOT NULL,
  ts               TIMESTAMPTZ NOT NULL,
  track_name       TEXT,
  artist           TEXT,
  album            TEXT,
  station          TEXT,
  source           TEXT,
  play_status      TEXT,
  volume_pct       INTEGER,
  volume_max       INTEGER,
  volume_increment INTEGER,
  duration_s       INTEGER,
  elapsed_s        INTEGER,
  PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('media_snapshots', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX media_snapshots_vehicle_ts ON media_snapshots (vehicle_id, ts DESC);

COMMENT ON TABLE media_snapshots IS
  'Phase-42 media playback hypertable. Durations in seconds (SI).';
COMMENT ON COLUMN media_snapshots.duration_s IS
  'Total length of the now-playing track in seconds. Sourced from MediaNowPlayingDuration.';
COMMENT ON COLUMN media_snapshots.elapsed_s IS
  'Playback position within the now-playing track in seconds. Sourced from MediaNowPlayingElapsed.';

-- =========================================================================
-- safety_snapshots — driver-assist + service mode flags.
-- Routing target for safety_security continuous-value flags (see
-- prompt 0046). State-change events (sentry, valet, locked, airbag,
-- crash) flow to security_events instead, not here.
-- =========================================================================
CREATE TABLE safety_snapshots (
  vehicle_id        BIGINT      NOT NULL,
  ts                TIMESTAMPTZ NOT NULL,
  service_mode      BOOLEAN,
  service_mode_plus BOOLEAN,
  wiper_state       TEXT,
  crash_state       TEXT,
  PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('safety_snapshots', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX safety_snapshots_vehicle_ts ON safety_snapshots (vehicle_id, ts DESC);

COMMENT ON TABLE safety_snapshots IS
  'Phase-42 service / safety flag hypertable.';
COMMENT ON COLUMN safety_snapshots.service_mode IS
  'Boolean: true while the vehicle is in service mode.';
COMMENT ON COLUMN safety_snapshots.service_mode_plus IS
  'Boolean: true while the vehicle is in service mode plus (technician unlock).';
COMMENT ON COLUMN safety_snapshots.wiper_state IS
  'Wiper-state token (off / intermittent / low / high / auto).';
COMMENT ON COLUMN safety_snapshots.crash_state IS
  'Crash-state token. Distinct from the security_events transition — this column carries the latest read, while every change is also appended to security_events.';

-- =========================================================================
-- location_snapshots — geocoded place labels.
-- Raw lat/lng/altitude/heading land in `positions` (prompt 0030). This
-- table holds the human-readable labels resolved from the geocoder
-- (Place / Country / Region) plus the wall-clock at which the lookup
-- was performed, so a stale row is detectable without re-geocoding.
-- =========================================================================
CREATE TABLE location_snapshots (
  vehicle_id  BIGINT      NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  place       TEXT,
  country     TEXT,
  region      TEXT,
  geocoded_at TIMESTAMPTZ,
  PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('location_snapshots', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX location_snapshots_vehicle_ts ON location_snapshots (vehicle_id, ts DESC);

COMMENT ON TABLE location_snapshots IS
  'Phase-42 geocoded location hypertable. Holds human-readable labels only — raw coordinates live in `positions`.';
COMMENT ON COLUMN location_snapshots.place IS
  'Geocoded place label (e.g. "Home", "Work", "Trader Joes Mountain View").';
COMMENT ON COLUMN location_snapshots.country IS
  'ISO 3166-1 alpha-2 country code resolved by the geocoder.';
COMMENT ON COLUMN location_snapshots.region IS
  'Geocoded administrative region (state / province / prefecture).';
COMMENT ON COLUMN location_snapshots.geocoded_at IS
  'Wall-clock instant at which the geocoder produced these labels. Used to detect stale rows without re-geocoding.';
