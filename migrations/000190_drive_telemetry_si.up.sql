-- Phase-42a / fixup: create drive_telemetry per-tick hypertable.
--
-- ADR-004 #4: every unit-bearing column lives in canonical SI and the
-- unit suffix is part of the column name (speed_mps, *_acceleration_mps2,
-- *_energy_*_wh, *_pos_pct, *_set_speed_mps).
--
-- Phase-42 mig 000185 created the session-aggregate `drives` + `trips`
-- tables but omitted the per-tick `drive_telemetry` table that
-- routing.yaml's 11 `dest: drive_telemetry` entries target. This is
-- the symmetric partner of `charging_telemetry` (mig 000184) for the
-- driving session — per-tick rows on the (vehicle_id, ts) PK with a
-- nullable `drive_id` that the session tracker (phase-42a/0030)
-- backfills after drive boundaries are detected.
--
-- Forward-only per ADR-004; legacy `drive_telemetry_readings`
-- (mig 000021, imperial/non-SI columns) remains untouched and will be
-- dropped by a separate phase-43 wave once all read paths cut over.

CREATE TABLE drive_telemetry (
    vehicle_id                       BIGINT      NOT NULL,
    ts                               TIMESTAMPTZ NOT NULL,
    drive_id                         BIGINT,
    speed_mps                        DOUBLE PRECISION,
    cruise_set_speed_mps             DOUBLE PRECISION,
    pedal_position_pct               DOUBLE PRECISION,
    brake_pedal                      BOOLEAN,
    brake_pedal_pos_pct              DOUBLE PRECISION,
    gear                             TEXT,
    drive_rail                       BOOLEAN,
    lateral_acceleration_mps2        DOUBLE PRECISION,
    longitudinal_acceleration_mps2   DOUBLE PRECISION,
    lifetime_energy_used_drive_wh    DOUBLE PRECISION,
    lifetime_energy_gained_regen_wh  DOUBLE PRECISION,
    PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('drive_telemetry', 'ts',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE);

CREATE INDEX drive_telemetry_vehicle_ts ON drive_telemetry (vehicle_id, ts DESC);
CREATE INDEX drive_telemetry_drive_ts   ON drive_telemetry (drive_id, ts) WHERE drive_id IS NOT NULL;

COMMENT ON TABLE drive_telemetry IS
    'Phase-42 SI-canonical driving hypertable (per-tick readings, ~1 Hz when in motion). Speed in m/s, acceleration in m/s^2, energy counters in Watt-hours, pedal positions as percent. Symmetric partner to charging_telemetry for the drive session.';
COMMENT ON COLUMN drive_telemetry.drive_id IS
    'Foreign key value (no constraint) into drives(id). Nullable while a tick is unattributed; backfilled by the drive session tracker (phase-42a/0030).';
COMMENT ON COLUMN drive_telemetry.speed_mps IS
    'Instantaneous vehicle speed in meters-per-second (SI). Sourced from VehicleSpeed.';
COMMENT ON COLUMN drive_telemetry.cruise_set_speed_mps IS
    'Driver-selected adaptive-cruise speed setpoint in meters-per-second (SI). Sourced from CruiseSetSpeed.';
COMMENT ON COLUMN drive_telemetry.pedal_position_pct IS
    'Accelerator pedal position 0-100 percent. Sourced from PedalPosition.';
COMMENT ON COLUMN drive_telemetry.brake_pedal IS
    'Brake pedal pressed (boolean). Sourced from BrakePedal.';
COMMENT ON COLUMN drive_telemetry.brake_pedal_pos_pct IS
    'Brake pedal travel 0-100 percent. Sourced from BrakePedalPos.';
COMMENT ON COLUMN drive_telemetry.gear IS
    'Selected gear enum (P, R, N, D). Sourced from Gear.';
COMMENT ON COLUMN drive_telemetry.drive_rail IS
    'Drive rail energized (boolean). Sourced from DriveRail.';
COMMENT ON COLUMN drive_telemetry.lateral_acceleration_mps2 IS
    'Lateral acceleration in meters-per-second-squared (SI). Sourced from LateralAcceleration.';
COMMENT ON COLUMN drive_telemetry.longitudinal_acceleration_mps2 IS
    'Longitudinal acceleration in meters-per-second-squared (SI). Sourced from LongitudinalAcceleration.';
COMMENT ON COLUMN drive_telemetry.lifetime_energy_used_drive_wh IS
    'Lifetime cumulative drive energy in Watt-hours (SI). Sourced from LifetimeEnergyUsedDrive.';
COMMENT ON COLUMN drive_telemetry.lifetime_energy_gained_regen_wh IS
    'Lifetime cumulative regen energy in Watt-hours (SI). Sourced from LifetimeEnergyGainedRegen.';
