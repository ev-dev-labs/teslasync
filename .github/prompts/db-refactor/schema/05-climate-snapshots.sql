-- =========================================================================
-- 05 — climate_snapshots (hot hypertable; bursty 0.1-1 Hz)
-- ADR-003: separate hypertable, 14d compression delay, 180d retention.
-- =========================================================================

CREATE TABLE climate_snapshots (
  vehicle_id              bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts                      timestamptz      NOT NULL,
  inside_temp_c           double precision,
  outside_temp_c          double precision,
  driver_setpoint_c       double precision,
  passenger_setpoint_c    double precision,
  hvac_state              text,
  defrost_mode            text,
  is_climate_on           boolean,
  is_preconditioning      boolean,
  fan_status              smallint,
  seat_heater_left        smallint,
  seat_heater_right       smallint,
  seat_heater_rear_left   smallint,
  seat_heater_rear_right  smallint,
  steering_wheel_heater   boolean,
  cabin_overheat_protection boolean,
  source                  text             NOT NULL DEFAULT 'fleet_telemetry'
                                           CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts)
);

COMMENT ON TABLE  climate_snapshots IS
  'HVAC + temperature history. 14d compression delay accommodates 2-week dashboard look-backs.';
COMMENT ON COLUMN climate_snapshots.defrost_mode IS
  'Per migration 000138 widening — text with normalized values from compound DefrostMode signal.';
COMMENT ON COLUMN climate_snapshots.fan_status IS
  '0-7 fan speed level from Fleet Telemetry FanStatus signal.';

SELECT create_hypertable('climate_snapshots', 'ts', chunk_time_interval => interval '1 day');

ALTER TABLE climate_snapshots SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('climate_snapshots', interval '14 days');
SELECT add_retention_policy ('climate_snapshots', interval '180 days');

CREATE INDEX idx_climate_vehicle_ts ON climate_snapshots (vehicle_id, ts DESC);
