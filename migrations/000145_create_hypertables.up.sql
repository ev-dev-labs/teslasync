-- Convert time-series tables to hypertables.
-- migrate_data => true moves existing rows into chunks.
-- if_not_exists => true makes this safe to re-run.
-- chunk_time_interval defaults to 7 days (good for our write rate).
--
-- Prerequisite: prompt 07-timescale-preflight must have fixed primary keys
-- so that `created_at` is part of every telemetry table's PK.

SET statement_timeout = 0;  -- migration may take a few minutes on large tables

SELECT create_hypertable('charging_telemetry', 'created_at',
    migrate_data => true,
    if_not_exists => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT create_hypertable('climate_snapshots', 'created_at',
    migrate_data => true,
    if_not_exists => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT create_hypertable('security_events', 'created_at',
    migrate_data => true,
    if_not_exists => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT create_hypertable('positions', 'created_at',
    migrate_data => true,
    if_not_exists => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT create_hypertable('motor_snapshots', 'created_at',
    migrate_data => true,
    if_not_exists => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT create_hypertable('tire_pressure_snapshots', 'created_at',
    migrate_data => true,
    if_not_exists => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT create_hypertable('media_snapshots', 'created_at',
    migrate_data => true,
    if_not_exists => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT create_hypertable('safety_snapshots', 'created_at',
    migrate_data => true,
    if_not_exists => true,
    chunk_time_interval => INTERVAL '7 days'
);
