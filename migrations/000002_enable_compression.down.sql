-- Remove compression policies and disable compression on hypertables.

SELECT remove_compression_policy('charging_telemetry', if_exists => true);
SELECT remove_compression_policy('positions', if_exists => true);
SELECT remove_compression_policy('climate_snapshots', if_exists => true);
SELECT remove_compression_policy('security_events', if_exists => true);
SELECT remove_compression_policy('motor_snapshots', if_exists => true);
SELECT remove_compression_policy('tire_pressure_snapshots', if_exists => true);
SELECT remove_compression_policy('media_snapshots', if_exists => true);
SELECT remove_compression_policy('safety_snapshots', if_exists => true);

-- Decompress all chunks before disabling compression
SELECT decompress_chunk(c.chunk_schema || '.' || c.chunk_name, if_compressed => true)
FROM timescaledb_information.chunks c
WHERE c.hypertable_name IN (
    'charging_telemetry', 'positions', 'climate_snapshots', 'security_events',
    'motor_snapshots', 'tire_pressure_snapshots', 'media_snapshots', 'safety_snapshots'
) AND c.is_compressed;

ALTER TABLE charging_telemetry SET (timescaledb.compress = false);
ALTER TABLE positions SET (timescaledb.compress = false);
ALTER TABLE climate_snapshots SET (timescaledb.compress = false);
ALTER TABLE security_events SET (timescaledb.compress = false);
ALTER TABLE motor_snapshots SET (timescaledb.compress = false);
ALTER TABLE tire_pressure_snapshots SET (timescaledb.compress = false);
ALTER TABLE media_snapshots SET (timescaledb.compress = false);
ALTER TABLE safety_snapshots SET (timescaledb.compress = false);
