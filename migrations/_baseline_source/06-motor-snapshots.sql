-- =========================================================================
-- 06 — motor_snapshots (hot hypertable; 1-10 Hz when driving)
-- ADR-003: 90d retention — perf analytics only, no long-term value.
-- =========================================================================

CREATE TABLE motor_snapshots (
  vehicle_id        bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts                timestamptz      NOT NULL,
  power_kw          double precision,
  motor_rpm_front   integer,
  motor_rpm_rear    integer,
  torque_nm_front   double precision,
  torque_nm_rear    double precision,
  motor_temp_c_front double precision,
  motor_temp_c_rear double precision,
  inverter_temp_c   double precision,
  battery_temp_c    double precision,
  regen_kw          double precision,
  shift_state       text             CHECK (shift_state IN ('P','R','N','D')),
  source            text             NOT NULL DEFAULT 'fleet_telemetry'
                                     CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts)
);

COMMENT ON TABLE  motor_snapshots IS
  'High-frequency drivetrain telemetry. 90d retention; only fed to perf analytics.';
COMMENT ON COLUMN motor_snapshots.power_kw IS 'Signed: positive when consuming, negative when regenerating.';
COMMENT ON COLUMN motor_snapshots.regen_kw IS 'Magnitude of regen (always positive). Redundant with negative power_kw but useful for filtering.';

SELECT create_hypertable('motor_snapshots', 'ts', chunk_time_interval => interval '1 day');

ALTER TABLE motor_snapshots SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('motor_snapshots', interval '7 days');
SELECT add_retention_policy ('motor_snapshots', interval '90 days');

CREATE INDEX idx_motor_vehicle_ts ON motor_snapshots (vehicle_id, ts DESC);
