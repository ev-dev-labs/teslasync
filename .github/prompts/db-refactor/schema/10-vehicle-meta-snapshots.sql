-- =========================================================================
-- 10 — vehicle_meta_snapshots (consolidated low-freq hypertable)
-- ADR-003: replaces tire_pressure_snapshots, media_snapshots,
-- safety_snapshots, vehicle_config_snapshots, user_preference_snapshots.
-- One wide table, NULL-heavy, columnstore compresses NULLs to ~zero cost.
-- =========================================================================

CREATE TABLE vehicle_meta_snapshots (
  vehicle_id   bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts           timestamptz      NOT NULL,
  category     text             NOT NULL
                                CHECK (category IN ('tire','media','safety','config','preference')),

  -- Tire (category='tire')
  tire_pressure_fl_psi      double precision,
  tire_pressure_fr_psi      double precision,
  tire_pressure_rl_psi      double precision,
  tire_pressure_rr_psi      double precision,
  tire_temp_fl_c            double precision,
  tire_temp_fr_c            double precision,
  tire_temp_rl_c            double precision,
  tire_temp_rr_c            double precision,

  -- Media (category='media')
  media_source              text,
  media_track_title         text,
  media_track_artist        text,
  media_track_album         text,
  media_volume              double precision,        -- per migration 000140 widened to float
  media_is_playing          boolean,
  media_track_duration_sec  integer,

  -- Safety (category='safety')
  autopilot_state           text,
  fcw_active                boolean,
  blind_spot_active         boolean,
  emergency_lane_assist     boolean,
  abs_active                boolean,
  speed_limit_mode          text,

  -- Config (category='config')
  software_version          text,
  car_type                  text,
  exterior_color            text,
  wheel_type                text,
  spoiler_type              text,
  has_ludicrous_mode        boolean,

  -- Preference (category='preference')
  drive_mode                text,
  regen_level               text,
  steering_mode             text,
  acceleration_mode         text,
  climate_keeper_mode       text,
  pet_mode                  boolean,

  source       text             NOT NULL DEFAULT 'fleet_telemetry'
                                CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts, category)
);

COMMENT ON TABLE  vehicle_meta_snapshots IS
  'ADR-003 consolidated low-freq hypertable. Replaces 5 separate snapshot tables. category discriminator selects active column group; others NULL.';
COMMENT ON COLUMN vehicle_meta_snapshots.category IS
  'One of tire, media, safety, config, preference. Determines which column group is populated.';
COMMENT ON COLUMN vehicle_meta_snapshots.media_volume IS
  'Widened to double precision per migration 000140 (was integer pre-refactor).';

SELECT create_hypertable('vehicle_meta_snapshots', 'ts', chunk_time_interval => interval '7 days');

ALTER TABLE vehicle_meta_snapshots SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id, category',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('vehicle_meta_snapshots', interval '30 days');
SELECT add_retention_policy ('vehicle_meta_snapshots', interval '730 days');

CREATE INDEX idx_vmeta_vehicle_cat_ts
  ON vehicle_meta_snapshots (vehicle_id, category, ts DESC);
