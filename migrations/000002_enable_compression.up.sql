-- Enable TimescaleDB compression on hypertables for ~90% storage savings.
-- segmentby = vehicle_id groups each vehicle's data together for columnar storage.
-- orderby = created_at DESC optimizes "latest data" queries on compressed chunks.
-- Compressed data remains fully queryable via standard SQL.

-- High-volume tables (compress after 7 days)
ALTER TABLE charging_telemetry SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('charging_telemetry', INTERVAL '7 days',
    if_not_exists => true);

ALTER TABLE positions SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('positions', INTERVAL '7 days',
    if_not_exists => true);

ALTER TABLE climate_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('climate_snapshots', INTERVAL '7 days',
    if_not_exists => true);

ALTER TABLE security_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('security_events', INTERVAL '7 days',
    if_not_exists => true);

ALTER TABLE motor_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('motor_snapshots', INTERVAL '7 days',
    if_not_exists => true);

-- Lower-volume tables (compress after 3 days)
ALTER TABLE tire_pressure_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('tire_pressure_snapshots', INTERVAL '3 days',
    if_not_exists => true);

ALTER TABLE media_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('media_snapshots', INTERVAL '3 days',
    if_not_exists => true);

ALTER TABLE safety_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby = 'created_at DESC'
);
SELECT add_compression_policy('safety_snapshots', INTERVAL '3 days',
    if_not_exists => true);
