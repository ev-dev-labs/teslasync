-- =========================================================================
-- 03 — positions (hot hypertable, highest write rate in schema)
-- ADR-003: kept separate from low-freq snapshots; 365d retention.
-- =========================================================================

CREATE TABLE positions (
  vehicle_id   bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts           timestamptz      NOT NULL,
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  heading      smallint,
  speed_mph    double precision,
  elevation_m  double precision,
  gps_state    text,
  source       text             NOT NULL DEFAULT 'fleet_telemetry'
                                CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts)
);

COMMENT ON TABLE  positions IS
  'High-frequency GPS + motion. ADR-003 hot tier — kept separate from low-freq snapshots due to write rate.';
COMMENT ON COLUMN positions.speed_mph IS 'Mph from Tesla; conversion to user units happens in API layer.';
COMMENT ON COLUMN positions.elevation_m IS 'Meters above sea level from Fleet Telemetry.';

SELECT create_hypertable('positions', 'ts', chunk_time_interval => interval '1 day');

ALTER TABLE positions SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('positions', interval '7 days');
SELECT add_retention_policy ('positions', interval '365 days');

CREATE INDEX idx_positions_vehicle_ts ON positions (vehicle_id, ts DESC);
