-- Convert time-series tables to TimescaleDB hypertables.
--
-- migrate_data => true moves existing rows into chunks (if any pre-hypertable
-- rows exist; on a fresh baseline DB the tables start empty so this is cheap).
-- if_not_exists => true makes this safe to re-run and safe on databases where
-- the squashed baseline (000000) already created the hypertables.
-- chunk_time_interval = 7 days matches our ~2,880 rows/day per vehicle write rate.

SET statement_timeout = 0;  -- migration may take a few minutes on large legacy tables

SELECT public.create_hypertable('public.charging_telemetry', 'created_at',
    migrate_data       => true,
    if_not_exists      => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT public.create_hypertable('public.climate_snapshots', 'created_at',
    migrate_data       => true,
    if_not_exists      => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT public.create_hypertable('public.security_events', 'created_at',
    migrate_data       => true,
    if_not_exists      => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT public.create_hypertable('public.positions', 'created_at',
    migrate_data       => true,
    if_not_exists      => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT public.create_hypertable('public.motor_snapshots', 'created_at',
    migrate_data       => true,
    if_not_exists      => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT public.create_hypertable('public.tire_pressure_snapshots', 'created_at',
    migrate_data       => true,
    if_not_exists      => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT public.create_hypertable('public.media_snapshots', 'created_at',
    migrate_data       => true,
    if_not_exists      => true,
    chunk_time_interval => INTERVAL '7 days'
);

SELECT public.create_hypertable('public.safety_snapshots', 'created_at',
    migrate_data       => true,
    if_not_exists      => true,
    chunk_time_interval => INTERVAL '7 days'
);
