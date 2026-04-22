-- Auto-assembled by phase-4-migration/01. Do not edit by hand.
-- Source snapshots: migrations/_baseline_source/
--
-- Forward-only baseline migration (ADR-008): drops all legacy objects the
-- new schema replaces, then installs the validated phase-3 schema in binding
-- dependency order (extensions -> trigger fn + entities -> signal_catalog ->
-- hot snapshot hypertables -> drives/sessions/trips -> automations tree ->
-- alerts/notifications -> tesla integration -> system tables -> CAGGs).

-- =========================================================================
-- Legacy DROP block
-- =========================================================================
-- Tables: replaced by phase-3 typed schema (CASCADE drops dependent FKs,
-- views, indexes, and policies).
-- =========================================================================

DROP TABLE IF EXISTS climate_snapshots                CASCADE;
DROP TABLE IF EXISTS motor_snapshots                  CASCADE;
DROP TABLE IF EXISTS security_events                  CASCADE;
DROP TABLE IF EXISTS positions                        CASCADE;
DROP TABLE IF EXISTS charging_telemetry               CASCADE;
DROP TABLE IF EXISTS signal_observations              CASCADE;
DROP TABLE IF EXISTS signal_catalog                   CASCADE;
DROP TABLE IF EXISTS vehicle_live_state               CASCADE;
DROP TABLE IF EXISTS tire_pressure_snapshots          CASCADE;
DROP TABLE IF EXISTS media_snapshots                  CASCADE;
DROP TABLE IF EXISTS safety_snapshots                 CASCADE;
DROP TABLE IF EXISTS vehicle_config_snapshots         CASCADE;
DROP TABLE IF EXISTS user_preference_snapshots        CASCADE;
DROP TABLE IF EXISTS automations                      CASCADE;
DROP TABLE IF EXISTS alert_rules                      CASCADE;
DROP TABLE IF EXISTS notification_channels            CASCADE;
DROP TABLE IF EXISTS notifications                    CASCADE;
DROP TABLE IF EXISTS tesla_tokens                     CASCADE;
DROP TABLE IF EXISTS api_call_logs                    CASCADE;
DROP TABLE IF EXISTS vehicles                         CASCADE;
DROP TABLE IF EXISTS drives                           CASCADE;
DROP TABLE IF EXISTS charging_sessions                CASCADE;
DROP TABLE IF EXISTS trips                            CASCADE;
DROP TABLE IF EXISTS trip_drives                      CASCADE;
DROP TABLE IF EXISTS places                           CASCADE;
DROP TABLE IF EXISTS geofences                        CASCADE;
DROP TABLE IF EXISTS electricity_cost                 CASCADE;
DROP TABLE IF EXISTS gas_prices                       CASCADE;
DROP TABLE IF EXISTS settings                         CASCADE;
DROP TABLE IF EXISTS polling_config                   CASCADE;
DROP TABLE IF EXISTS audit_logs                       CASCADE;
DROP TABLE IF EXISTS command_executions               CASCADE;
DROP TABLE IF EXISTS fsm_transitions                  CASCADE;
DROP TABLE IF EXISTS embeddings                       CASCADE;

-- =========================================================================
-- Legacy function drops (per ADR-006: analytics moved into Go).
-- Signatures match production (\df fn_*). DROP ... IF EXISTS is signature-
-- aware; tolerate signature drift by also dropping unqualified variants
-- inside a DO block so apply does not break on drift.
-- =========================================================================

DROP FUNCTION IF EXISTS fn_drive_score_breakdown(bigint)                              CASCADE;
DROP FUNCTION IF EXISTS fn_drive_efficiency(bigint)                                   CASCADE;
DROP FUNCTION IF EXISTS fn_drive_segment_summary(bigint)                              CASCADE;
DROP FUNCTION IF EXISTS fn_charging_session_total(bigint)                             CASCADE;
DROP FUNCTION IF EXISTS fn_charging_session_efficiency(bigint)                        CASCADE;
DROP FUNCTION IF EXISTS fn_battery_degradation_estimate(bigint)                       CASCADE;
DROP FUNCTION IF EXISTS fn_tco_summary(bigint, timestamptz, timestamptz)              CASCADE;
DROP FUNCTION IF EXISTS fn_speed_profile(bigint, timestamptz, timestamptz)            CASCADE;
DROP FUNCTION IF EXISTS fn_route_efficiency(bigint, timestamptz, timestamptz)         CASCADE;
DROP FUNCTION IF EXISTS fn_temperature_impact(bigint, timestamptz, timestamptz)       CASCADE;
DROP FUNCTION IF EXISTS fn_charging_calendar_heatmap(bigint)                          CASCADE;
DROP FUNCTION IF EXISTS fn_charging_hourly_distribution(bigint)                       CASCADE;
DROP FUNCTION IF EXISTS fn_charging_power_timeline(bigint)                            CASCADE;

DO $$
DECLARE
    fn_name text;
    fn_sig  text;
BEGIN
    FOR fn_name, fn_sig IN
        SELECT p.proname,
               pg_get_function_identity_arguments(p.oid)
        FROM   pg_proc p
        JOIN   pg_namespace n ON n.oid = p.pronamespace
        WHERE  n.nspname = 'public'
          AND  p.proname LIKE 'fn_%'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', fn_name, fn_sig);
    END LOOP;
END
$$;

-- =========================================================================
-- Legacy materialized view drops (per ADR-006: replaced by CAGGs).
-- =========================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_position_hourly  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_energy_daily     CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_signal_stats     CASCADE;

-- ===== source: 00-extensions.sql =====
-- =========================================================================
-- 00 — Extensions
-- ADR-007: timescale/timescaledb-ha:pg17 image bakes these in. CREATE
-- EXTENSION is still required to register them inside the database.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;


-- ===== source: 01-vehicles.sql =====
-- =========================================================================
-- 01 — vehicles + shared set_updated_at() trigger fn
-- ADR-001: typed-by-default. The set_updated_at fn is the ONE shared
-- pl/pgsql artifact this schema keeps; every other table installs a
-- BEFORE UPDATE trigger that calls it.
-- =========================================================================

-- Shared trigger fn — used by every non-append-only table
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION set_updated_at() IS
  'Shared BEFORE UPDATE trigger function. Maintains updated_at on every '
  'non-append-only table. Defined once in 01-vehicles.sql.';

-- Root entity
CREATE TABLE vehicles (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  tesla_id        bigint      NOT NULL UNIQUE,
  vin             text        NOT NULL UNIQUE,
  display_name    text        NOT NULL,
  model           text,
  option_codes    text,
  color           text,
  trim_level      text,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  vehicles                 IS 'Root entity. Every FK in the schema chains back here.';
COMMENT ON COLUMN vehicles.tesla_id        IS 'Tesla Fleet API vehicle id. Distinct from our surrogate id.';
COMMENT ON COLUMN vehicles.vin             IS 'Vehicle Identification Number — 17 chars, but stored as text to tolerate Tesla format changes.';
COMMENT ON COLUMN vehicles.option_codes    IS 'Comma-separated option codes from Fleet API; opaque, never parsed in queries.';
COMMENT ON COLUMN vehicles.archived_at     IS 'Soft-delete marker. Active queries should add WHERE archived_at IS NULL.';

CREATE TRIGGER vehicles_set_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_vehicles_active ON vehicles (id) WHERE archived_at IS NULL;


-- ===== source: 09-signal-catalog.sql =====
-- =========================================================================
-- 09 — signal_catalog (registry of every signal name ever seen)
-- ADR-009: backs the onboarding runbook. signal_observations FKs here.
-- =========================================================================

CREATE TABLE signal_catalog (
  name              text PRIMARY KEY,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  observation_count bigint      NOT NULL DEFAULT 0,
  storage_tier      text        NOT NULL DEFAULT 'cold'
                                CHECK (storage_tier IN ('hot','cold','dropped')),
  typed_table       text,
  typed_column      text,
  data_kind         text        CHECK (data_kind IN ('numeric','text','boolean','compound')),
  unit              text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  signal_catalog IS
  'Registry of every signal name ever seen. ADR-009 onboarding source of truth.';
COMMENT ON COLUMN signal_catalog.storage_tier IS
  'hot = promoted to a typed column; cold = stored in signal_observations; dropped = silently skipped at ingest.';
COMMENT ON COLUMN signal_catalog.typed_table IS
  'Populated when storage_tier=hot. NULL otherwise.';
COMMENT ON COLUMN signal_catalog.typed_column IS
  'Populated when storage_tier=hot. NULL otherwise.';
COMMENT ON COLUMN signal_catalog.data_kind IS
  'Hint for which value_* column in signal_observations is populated.';

CREATE TRIGGER signal_catalog_set_updated_at
  BEFORE UPDATE ON signal_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_signal_catalog_tier_count
  ON signal_catalog (storage_tier, observation_count DESC);


-- ===== source: 02-vehicle-live-state.sql =====
-- =========================================================================
-- 02 — vehicle_live_state
-- ADR-002 / ADR-003: single-row-per-vehicle current state. Write-through
-- from the in-memory SignalStore on every telemetry batch. Reads from this
-- table back the /vehicles/{id}/state endpoint and every Grafana 'now'
-- panel. Never query snapshot tables for current state.
-- =========================================================================

CREATE TABLE vehicle_live_state (
  vehicle_id              bigint PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Battery / charge
  battery_level           smallint,
  battery_range_mi        double precision,
  charging_state          text CHECK (charging_state IN ('Disconnected','Connected','Charging','Stopped','Complete','NoPower','Starting')),
  charge_limit_soc        smallint,
  charger_voltage         double precision,
  charger_actual_current  double precision,
  charger_power_kw        double precision,
  battery_last_updated_at timestamptz,

  -- Position
  latitude                double precision,
  longitude               double precision,
  heading                 smallint,
  speed_mph               double precision,
  elevation_m             double precision,
  gps_state               text,
  position_last_updated_at timestamptz,

  -- Climate
  inside_temp_c           double precision,
  outside_temp_c          double precision,
  hvac_state              text CHECK (hvac_state IN ('Off','On','Auto','Heating','Cooling','Defrost','Preconditioning')),
  is_climate_on           boolean,
  defrost_mode            text,
  climate_last_updated_at timestamptz,

  -- Drive / motor
  shift_state             text CHECK (shift_state IN ('P','R','N','D')),
  drive_state             text,
  power_kw                double precision,
  motor_rpm               integer,
  drive_last_updated_at   timestamptz,

  -- Security
  locked                  boolean,
  sentry_mode             boolean,
  user_present            boolean,
  doors_open              text,        -- normalized JSON-string from compound DoorState
  windows_open            text,        -- normalized JSON-string from compound WindowState
  security_last_updated_at timestamptz,

  -- Software / firmware
  software_version        text,

  -- Bookkeeping
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  vehicle_live_state IS
  'Single source of truth for current vehicle state. Write-through from in-memory SignalStore on every telemetry batch. NEVER query snapshot tables for current state — read here instead.';
COMMENT ON COLUMN vehicle_live_state.battery_last_updated_at IS 'Wall-clock when battery_* columns last advanced. Use for staleness checks.';
COMMENT ON COLUMN vehicle_live_state.doors_open IS 'Normalized JSON-string from compound DoorState signal (per repo memory: TypeDoors compound flattening).';
COMMENT ON COLUMN vehicle_live_state.windows_open IS 'Normalized JSON-string from compound WindowState signal (per repo memory: window state normalization migration 000132).';
COMMENT ON COLUMN vehicle_live_state.shift_state IS 'P/R/N/D from Tesla. NULL when vehicle asleep.';

CREATE TRIGGER vehicle_live_state_set_updated_at
  BEFORE UPDATE ON vehicle_live_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ===== source: 03-positions.sql =====
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


-- ===== source: 04-charging-telemetry.sql =====
-- =========================================================================
-- 04 — charging_telemetry (hot hypertable; 1 Hz when charging)
-- ADR-003: separate hypertable, 730d retention (longer than positions
-- because charging history feeds battery-health analytics).
-- =========================================================================

CREATE TABLE charging_telemetry (
  vehicle_id              bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts                      timestamptz      NOT NULL,
  session_id              bigint,                          -- FK added in prompt 12 (forward dependency)
  battery_level           smallint,
  battery_range_mi        double precision,
  charging_state          text,
  charger_voltage         double precision,
  charger_actual_current  double precision,
  charger_power_kw        double precision,
  charger_phases          smallint,
  charge_energy_added_kwh double precision,
  charge_miles_added      double precision,
  charge_rate_mph         double precision,
  charger_pilot_current   double precision,
  scheduled_charging_at   timestamptz,
  source                  text             NOT NULL DEFAULT 'fleet_telemetry'
                                           CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts)
);

COMMENT ON TABLE  charging_telemetry IS
  '1 Hz per-charging-session metrics. ADR-003 hot tier; 730d retention.';
COMMENT ON COLUMN charging_telemetry.session_id IS
  'Nullable until a charging_session is correlated. FK added in prompt 12 to avoid forward dependency.';
COMMENT ON COLUMN charging_telemetry.scheduled_charging_at IS
  'Normalized timestamptz from compound TypeTime ScheduledChargingStartTime signal (per repo memory).';

SELECT create_hypertable('charging_telemetry', 'ts', chunk_time_interval => interval '1 day');

ALTER TABLE charging_telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('charging_telemetry', interval '7 days');
SELECT add_retention_policy ('charging_telemetry', interval '730 days');

CREATE INDEX idx_chg_telem_session ON charging_telemetry (session_id, ts) WHERE session_id IS NOT NULL;
CREATE INDEX idx_chg_telem_vehicle_ts ON charging_telemetry (vehicle_id, ts DESC);


-- ===== source: 05-climate-snapshots.sql =====
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


-- ===== source: 06-motor-snapshots.sql =====
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


-- ===== source: 07-security-events.sql =====
-- =========================================================================
-- 07 — security_events (hot hypertable; event-driven, audit-grade)
-- ADR-003: 5-year retention. Kept separate so other low-freq tables
-- aren't forced to inherit it.
-- =========================================================================

CREATE TABLE security_events (
  vehicle_id    bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts            timestamptz      NOT NULL,
  event_type    text             NOT NULL
                                 CHECK (event_type IN (
                                   'door_open','door_closed','window_open','window_closed',
                                   'lock','unlock','sentry_on','sentry_off',
                                   'user_present','user_absent','trunk_open','trunk_closed',
                                   'frunk_open','frunk_closed','sentry_alert','tonneau_change'
                                 )),
  doors_open    text,
  windows_open  text,
  locked        boolean,
  sentry_mode   boolean,
  user_present  boolean,
  detail        text,
  source        text             NOT NULL DEFAULT 'fleet_telemetry'
                                 CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts, event_type)
);

COMMENT ON TABLE  security_events IS
  'Event-driven door/lock/sentry history. 5-year audit retention per ADR-003.';
COMMENT ON COLUMN security_events.doors_open IS
  'Normalized JSON-string from compound TypeDoors signal (repo memory: signal_types normalization).';
COMMENT ON COLUMN security_events.windows_open IS
  'Normalized JSON-string from compound WindowState signal (migration 000132 normalization).';

SELECT create_hypertable('security_events', 'ts', chunk_time_interval => interval '7 days');

ALTER TABLE security_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id, event_type',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('security_events', interval '30 days');
SELECT add_retention_policy ('security_events', interval '1825 days');

CREATE INDEX idx_security_vehicle_ts   ON security_events (vehicle_id, ts DESC);
CREATE INDEX idx_security_event_type   ON security_events (event_type, ts DESC);


-- ===== source: 08-signal-observations.sql =====
-- =========================================================================
-- 08 — signal_observations (cold-path tall hypertable)
-- ADR-002: hot/cold split. ~200 signals not promoted to typed columns
-- land here. Per-row overhead is dominated by signal_name; segmentby
-- compression collapses adjacent rows of the same (vehicle, signal) into
-- columnar batches. Spike-validated 2026-04-22:
--   - Insert: 107,196 rows/sec
--   - Hot query (24h window): 2.86 ms
--   - Compressed query (15-day-old window): 1.32 ms
--   - Compression ratio: 29.34× (8 GB → 273 MB)
-- =========================================================================

CREATE TABLE signal_observations (
  vehicle_id    bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts            timestamptz      NOT NULL,
  signal_name   text             NOT NULL REFERENCES signal_catalog(name) ON DELETE RESTRICT,
  value_numeric double precision,
  value_text    text,
  value_bool    boolean,
  source        text             NOT NULL DEFAULT 'fleet_telemetry'
                                 CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts, signal_name)
);

COMMENT ON TABLE signal_observations IS
  'Cold-path tall table for low-frequency signals. ADR-002 hot/cold split. '
  'Hot signals live in typed columns on positions/charging_telemetry/etc.';

COMMENT ON COLUMN signal_observations.signal_name IS
  'Must exist in signal_catalog. FK is RESTRICT so an unknown signal blocks ingest '
  'until catalog is updated (ADR-009 onboarding ritual).';
COMMENT ON COLUMN signal_observations.value_numeric IS
  'Populated for numeric signals. Mutually exclusive with value_text/value_bool.';
COMMENT ON COLUMN signal_observations.value_text IS
  'Populated for string/enum signals (e.g. shift_state). Compound signals are '
  'normalized to JSON-strings upstream in normalizeFleetUnits before insert.';
COMMENT ON COLUMN signal_observations.value_bool IS
  'Populated for boolean signals (e.g. defrost_active).';

-- Promote to hypertable
SELECT create_hypertable('signal_observations', 'ts', chunk_time_interval => interval '1 day');

-- Compression: spike-validated 29.34× ratio with this segmentby
ALTER TABLE signal_observations SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id, signal_name',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('signal_observations', interval '7 days');

-- Retention: keep 2 years
SELECT add_retention_policy('signal_observations', interval '2 years');

-- Explicit query index — spike measured 2.86 ms with this exact index
CREATE INDEX idx_signal_obs_vehicle_signal_ts
  ON signal_observations (vehicle_id, signal_name, ts DESC);


-- ===== source: 10-vehicle-meta-snapshots.sql =====
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


-- ===== source: 11-drives.sql =====
-- =========================================================================
-- 11 — drives (one row per completed drive)
-- ADR-001: fully typed; no jsonb metadata column.
-- =========================================================================

CREATE TABLE drives (
  id                   bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vehicle_id           bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  start_ts             timestamptz      NOT NULL,
  end_ts               timestamptz      NOT NULL,
  duration_min         double precision NOT NULL,
  distance_mi          double precision NOT NULL,        -- miles per repo memory
  start_address        text,
  end_address          text,
  start_lat            double precision,
  start_lon            double precision,
  end_lat              double precision,
  end_lon              double precision,
  start_battery_pct    smallint,
  end_battery_pct      smallint,
  energy_used_kwh      double precision,
  regen_kwh            double precision,
  avg_speed_mph        double precision,
  max_speed_mph        double precision,
  avg_power_kw         double precision,
  outside_temp_avg_c   double precision,
  inside_temp_avg_c    double precision,
  score                numeric(5, 2),
  ended_status         text             CHECK (ended_status IN ('completed','aborted','interrupted','unknown')),
  created_at           timestamptz      NOT NULL DEFAULT now(),
  updated_at           timestamptz      NOT NULL DEFAULT now(),
  CHECK (end_ts >= start_ts)
);

COMMENT ON TABLE  drives IS 'One row per completed drive. Mutable (re-scoring updates score column).';
COMMENT ON COLUMN drives.distance_mi IS 'Stored in miles. UI converts via useSettings.convertDistance.';
COMMENT ON COLUMN drives.energy_used_kwh IS 'Net energy used; regen subtracted into regen_kwh column separately.';

CREATE TRIGGER drives_set_updated_at
  BEFORE UPDATE ON drives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_drives_vehicle_start  ON drives (vehicle_id, start_ts DESC);
CREATE INDEX idx_drives_start_ts       ON drives (start_ts DESC);


-- ===== source: 12-charging-sessions.sql =====
-- =========================================================================
-- 12 — charging_sessions (one row per charging session)
-- Also closes the forward FK from charging_telemetry.session_id (deferred
-- in prompt 04 to avoid forward dependency).
-- =========================================================================

CREATE TABLE charging_sessions (
  id                  bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vehicle_id          bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  start_ts            timestamptz      NOT NULL,
  end_ts              timestamptz,
  duration_min        double precision,
  start_battery_pct   smallint,
  end_battery_pct     smallint,
  energy_added_kwh    double precision,
  miles_added         double precision,
  charger_type        text             CHECK (charger_type IN ('AC','DC','Supercharger','Wall_Connector','Mobile','Destination','Unknown')),
  charger_location    text,
  charger_power_kw_max double precision,
  charger_power_kw_avg double precision,
  cost                numeric(10, 4),
  cost_currency       text,
  ended_status        text             CHECK (ended_status IN ('completed','interrupted','user_stopped','full','unknown')),
  created_at          timestamptz      NOT NULL DEFAULT now(),
  updated_at          timestamptz      NOT NULL DEFAULT now(),
  CHECK (end_ts IS NULL OR end_ts >= start_ts)
);

COMMENT ON TABLE  charging_sessions IS 'One row per charging session. end_ts NULL while session in progress.';
COMMENT ON COLUMN charging_sessions.cost IS 'Computed cost in cost_currency. NULL when electricity_cost row lookup fails.';
COMMENT ON COLUMN charging_sessions.miles_added IS 'Range gained in miles per useSettings.convertDistance convention.';

CREATE TRIGGER charging_sessions_set_updated_at
  BEFORE UPDATE ON charging_sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_chg_sessions_vehicle_start ON charging_sessions (vehicle_id, start_ts DESC);
CREATE INDEX idx_chg_sessions_open
  ON charging_sessions (vehicle_id) WHERE end_ts IS NULL;

-- Close the deferred FK from prompt 04 (charging_telemetry.session_id)
ALTER TABLE charging_telemetry
  ADD CONSTRAINT chg_telem_session_fk
  FOREIGN KEY (session_id) REFERENCES charging_sessions(id) ON DELETE SET NULL;


-- ===== source: 13-trips.sql =====
-- =========================================================================
-- 13 — trips + trip_drives join
-- Multi-drive aggregation. Trips are user-defined, optional groupings.
-- =========================================================================

CREATE TABLE trips (
  id                bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  vehicle_id        bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  name              text             NOT NULL,
  description       text,
  start_ts          timestamptz      NOT NULL,
  end_ts            timestamptz,
  total_distance_mi double precision,
  total_energy_kwh  double precision,
  total_duration_min double precision,
  created_at        timestamptz      NOT NULL DEFAULT now(),
  updated_at        timestamptz      NOT NULL DEFAULT now(),
  CHECK (end_ts IS NULL OR end_ts >= start_ts)
);

COMMENT ON TABLE  trips IS 'User-defined multi-drive grouping (e.g., a vacation). Totals are denormalized; can be recomputed from drives.';
COMMENT ON COLUMN trips.total_distance_mi IS 'Sum of constituent drives.distance_mi. Recompute via aggregate query if denormalization drifts.';

CREATE TRIGGER trips_set_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_trips_vehicle_start ON trips (vehicle_id, start_ts DESC);

-- Many-to-many join: a drive can theoretically belong to multiple trips
CREATE TABLE trip_drives (
  trip_id   bigint NOT NULL REFERENCES trips(id)  ON DELETE CASCADE,
  drive_id  bigint NOT NULL REFERENCES drives(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, drive_id)
);

COMMENT ON TABLE trip_drives IS 'Many-to-many join. Append/delete-only; no audit columns.';

CREATE INDEX idx_trip_drives_drive ON trip_drives (drive_id);


-- ===== source: 14-automations.sql =====
-- =========================================================================
-- 14 — automations parent + steps + kind enum + tags
-- ADR-004 class table inheritance. Per-kind child tables follow in 15-17.
-- =========================================================================

CREATE TYPE automation_step_kind AS ENUM (
  'trigger_signal', 'trigger_geofence', 'trigger_schedule', 'trigger_event',
  'condition_signal', 'condition_time_window', 'condition_geofence', 'condition_other_automation',
  'action_command', 'action_notify', 'action_set_setting', 'action_call_automation'
);

COMMENT ON TYPE automation_step_kind IS
  'Closed enum. Adding a new kind requires a coordinated migration: ALTER TYPE … ADD VALUE plus a new child table.';

CREATE TABLE automations (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name            text             NOT NULL,
  description     text,
  enabled         boolean          NOT NULL DEFAULT true,
  vehicle_id      bigint           REFERENCES vehicles(id) ON DELETE CASCADE,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE  automations IS 'Class-table-inheritance root per ADR-004. vehicle_id NULL = applies to all vehicles.';
COMMENT ON COLUMN automations.vehicle_id IS 'NULL means the rule applies to every vehicle owned by the user.';

CREATE TRIGGER automations_set_updated_at
  BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_automations_enabled  ON automations (enabled) WHERE enabled = true;
CREATE INDEX idx_automations_vehicle  ON automations (vehicle_id) WHERE vehicle_id IS NOT NULL;

CREATE TABLE automation_steps (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  automation_id bigint               NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  step_order    integer              NOT NULL,
  kind          automation_step_kind NOT NULL,
  UNIQUE (automation_id, step_order)
);

COMMENT ON TABLE  automation_steps IS 'Discriminator. Each step has exactly one matching child row in the kind-specific table.';
COMMENT ON COLUMN automation_steps.kind IS 'ENUM. Determines which child table holds the typed fields for this step.';

CREATE INDEX idx_automation_steps_kind ON automation_steps (kind);

CREATE TABLE automation_tags (
  automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  tag           text   NOT NULL,
  PRIMARY KEY (automation_id, tag)
);

COMMENT ON TABLE automation_tags IS 'Normalized tag list. No text[] shortcut.';

CREATE INDEX idx_automation_tags_tag ON automation_tags (tag);


-- ===== source: 15-automation-conditions.sql =====
-- =========================================================================
-- 15 — automation step condition children (4 tables)
-- ADR-004 CTI children for the 'condition_*' step kinds.
-- =========================================================================

CREATE TABLE automation_step_condition_signal (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  signal     text             NOT NULL,
  op         text             NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','between','in')),
  value_text text,
  value_num  double precision,
  value_bool boolean,
  value_min  double precision,
  value_max  double precision,
  CHECK (op <> 'between' OR (value_min IS NOT NULL AND value_max IS NOT NULL))
);
COMMENT ON TABLE automation_step_condition_signal IS
  'CTI child for condition_signal kind. value_min/value_max only used when op = between.';

CREATE TABLE automation_step_condition_time_window (
  step_id      bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  timezone     text NOT NULL DEFAULT 'UTC',
  days_of_week smallint[] NOT NULL
                CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
);
COMMENT ON TABLE  automation_step_condition_time_window IS
  'CTI child for condition_time_window. days_of_week: 0=Sun..6=Sat. Typed array, NOT jsonb.';
COMMENT ON COLUMN automation_step_condition_time_window.days_of_week IS
  'Subset of {0..6}. Empty array = always (no day filter).';

CREATE TABLE automation_step_condition_geofence (
  step_id  bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  -- FK to places(id) added in prompt 23 (forward dependency)
  place_id bigint NOT NULL,
  state    text   NOT NULL CHECK (state IN ('inside','outside','dwell'))
);
COMMENT ON TABLE  automation_step_condition_geofence IS
  'CTI child for condition_geofence. FK to places(id) deferred to prompt 23.';

CREATE TABLE automation_step_condition_other_automation (
  step_id          bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  other_automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE RESTRICT,
  state            text NOT NULL CHECK (state IN ('enabled','disabled','recently_triggered'))
);
COMMENT ON TABLE automation_step_condition_other_automation IS
  'CTI child for condition_other_automation. RESTRICT delete: cannot delete an automation referenced by another.';

CREATE INDEX idx_cond_signal_signal ON automation_step_condition_signal (signal);
CREATE INDEX idx_cond_geofence_place ON automation_step_condition_geofence (place_id);


-- ===== source: 16-automation-actions.sql =====
-- =========================================================================
-- 16 — automation_actions (only JSONB carve-out in the schema)
-- ADR-001 + ADR-004: command_params is intentionally jsonb because Tesla
-- command parameters vary per command and Tesla revises the contract
-- without coordination. The application is contractually forbidden from
-- using this column in WHERE / GROUP BY / ORDER BY (audit checks this).
-- =========================================================================

CREATE TABLE automation_actions (
  id              bigint           PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  step_id         bigint           NOT NULL REFERENCES automation_steps(id) ON DELETE CASCADE,
  command_name    text             NOT NULL
                                   CHECK (command_name IN (
                                     -- Keep in sync with internal/tesla/client.go `commands` map
                                     -- (the frontend command name keys, not the Fleet API endpoints).
                                     -- Adding a new command requires updating this CHECK in lockstep.
                                     'actuate_frunk',
                                     'actuate_trunk',
                                     'add_charge_schedule',
                                     'add_precondition_schedule',
                                     'adjust_volume',
                                     'auto_seat_climate',
                                     'auto_steering_heat',
                                     'bioweapon_off',
                                     'bioweapon_on',
                                     'boombox_fart',
                                     'boombox_ping',
                                     'camp_mode',
                                     'cancel_software_update',
                                     'charge_max_range',
                                     'charge_port_close',
                                     'charge_port_open',
                                     'charge_standard',
                                     'charge_start',
                                     'charge_stop',
                                     'clear_pin_to_drive_admin',
                                     'climate_keeper_off',
                                     'climate_keeper_on',
                                     'climate_off',
                                     'climate_on',
                                     'close_charge_port',
                                     'close_windows',
                                     'cop_fan_only',
                                     'cop_off',
                                     'cop_on',
                                     'dog_mode',
                                     'erase_user_data',
                                     'flash',
                                     'flash_lights',
                                     'frunk',
                                     'frunk_open',
                                     'guest_mode_off',
                                     'guest_mode_on',
                                     'honk',
                                     'honk_horn',
                                     'lock',
                                     'media_next_fav',
                                     'media_next_track',
                                     'media_prev_fav',
                                     'media_prev_track',
                                     'media_toggle_playback',
                                     'media_volume_down',
                                     'navigation_gps_request',
                                     'navigation_request',
                                     'navigation_sc_request',
                                     'open_charge_port',
                                     'preconditioning_max',
                                     'preconditioning_reset',
                                     'remote_boombox',
                                     'remote_start_drive',
                                     'remove_charge_schedule',
                                     'remove_precondition_schedule',
                                     'reset_pin_to_drive_pin',
                                     'reset_valet_pin',
                                     'schedule_software_update',
                                     'seat_cooler',
                                     'seat_heater',
                                     'sentry_off',
                                     'sentry_on',
                                     'set_charge_limit',
                                     'set_charging_amps',
                                     'set_cop_temp',
                                     'set_pin_to_drive',
                                     'set_scheduled_charging',
                                     'set_scheduled_departure',
                                     'set_sentry_mode',
                                     'set_temps',
                                     'set_valet_mode',
                                     'set_vehicle_name',
                                     'speed_limit_clear_pin',
                                     'speed_limit_clear_pin_admin',
                                     'speed_limit_off',
                                     'speed_limit_on',
                                     'speed_limit_set_limit',
                                     'steering_wheel_heat',
                                     'steering_wheel_level',
                                     'sunroof_close',
                                     'sunroof_stop',
                                     'sunroof_vent',
                                     'trigger_homelink',
                                     'trunk_open',
                                     'unlock',
                                     'valet_off',
                                     'valet_on',
                                     'vent_windows',
                                     'wake',
                                     'wake_up'
                                   )),
  command_params  jsonb            NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz      NOT NULL DEFAULT now(),
  updated_at      timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE automation_actions IS
  'Per-step Tesla command invocation. Parented to automation_steps via step_id. '
  'One automation_steps row may be parent to exactly one of: condition, action, delay (CTI per ADR-004).';

COMMENT ON COLUMN automation_actions.command_name IS
  'Tesla command identifier (frontend name, mapped to a Fleet API endpoint by the client). '
  'Must match a key in internal/tesla/client.go `commands` map. CHECK constraint enforces a closed enumeration.';

COMMENT ON COLUMN automation_actions.command_params IS
  'JSONB carve-out per ADR-001/ADR-004 — never use in WHERE/GROUP BY/ORDER BY in production. '
  'Schema-on-read: parsed by the Tesla client adapter at command-send time. '
  'Audit query SELECT count(*) FROM information_schema.columns WHERE data_type IN (''jsonb'',''json'') '
  'must return exactly 1, and that 1 must be this column.';

-- updated_at maintenance trigger (shared trigger function defined in 01-vehicles.sql)
CREATE TRIGGER trg_automation_actions_set_updated_at
  BEFORE UPDATE ON automation_actions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_automation_actions_step_id ON automation_actions(step_id);


-- ===== source: 17-automation-step-children.sql =====
-- =========================================================================
-- 17 — remaining automation step CTI children
-- ADR-004 — completes the CTI tree for all step kinds except action_command
-- (action_command is prompt 16, the sole JSONB carve-out).
-- =========================================================================

-- ============= TRIGGER children =============

CREATE TABLE automation_step_trigger_signal (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  signal     text NOT NULL,
  op         text NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','changed','crossed_above','crossed_below')),
  value_text text,
  value_num  double precision,
  value_bool boolean
);
COMMENT ON TABLE automation_step_trigger_signal IS 'CTI child for trigger_signal kind.';
CREATE INDEX idx_trig_signal_signal ON automation_step_trigger_signal (signal);

CREATE TABLE automation_step_trigger_geofence (
  step_id  bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  place_id bigint NOT NULL,                   -- FK added in prompt 23 (forward dep)
  event    text NOT NULL CHECK (event IN ('enter','exit','dwell'))
);
COMMENT ON TABLE automation_step_trigger_geofence IS 'CTI child for trigger_geofence. FK to places(id) deferred to prompt 23.';
CREATE INDEX idx_trig_geofence_place ON automation_step_trigger_geofence (place_id);

CREATE TABLE automation_step_trigger_schedule (
  step_id   bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  cron_expr text NOT NULL,
  timezone  text NOT NULL DEFAULT 'UTC'
);
COMMENT ON TABLE automation_step_trigger_schedule IS 'CTI child for trigger_schedule kind. cron_expr validated by Go cron parser at write time.';

CREATE TABLE automation_step_trigger_event (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  event_type text NOT NULL
              CHECK (event_type IN ('drive_start','drive_end','charge_start','charge_end','sleep_start','sleep_end','online','offline','sentry_alert'))
);
COMMENT ON TABLE automation_step_trigger_event IS 'CTI child for trigger_event kind. Closed event vocabulary.';

-- ============= ACTION children (excluding action_command which is prompt 16) =============

CREATE TABLE automation_step_action_notify (
  step_id    bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  channel_id bigint NOT NULL,                 -- FK to notification_channels(id) deferred to prompt 19
  template   text NOT NULL
);
COMMENT ON TABLE automation_step_action_notify IS
  'CTI child for action_notify. template = mustache-style string, NOT json. FK to notification_channels deferred to prompt 19.';

CREATE TABLE automation_step_action_set_setting (
  step_id     bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  value_text  text,
  value_num   double precision,
  value_bool  boolean
);
COMMENT ON TABLE automation_step_action_set_setting IS
  'CTI child for action_set_setting. setting_key matches a row in settings table; runtime validates type matches value_*.';

CREATE TABLE automation_step_action_call_automation (
  step_id            bigint PRIMARY KEY REFERENCES automation_steps(id) ON DELETE CASCADE,
  target_automation_id bigint NOT NULL REFERENCES automations(id) ON DELETE RESTRICT
);
COMMENT ON TABLE automation_step_action_call_automation IS
  'CTI child for action_call_automation. RESTRICT — cannot delete an automation called by another.';


-- ===== source: 18-alert-rules.sql =====
-- =========================================================================
-- 18 — alert_rules
-- ADR-001: typed rule storage (no jsonb rule_def).
-- =========================================================================

CREATE TABLE alert_rules (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name          text             NOT NULL,
  description   text,
  enabled       boolean          NOT NULL DEFAULT true,
  vehicle_id    bigint           REFERENCES vehicles(id) ON DELETE CASCADE,
  signal_name   text             NOT NULL,
  op            text             NOT NULL CHECK (op IN ('=','!=','<','<=','>','>=','changed','between','outside')),
  value_num     double precision,
  value_text    text,
  value_bool    boolean,
  value_min     double precision,
  value_max     double precision,
  severity      text             NOT NULL DEFAULT 'warn'
                                 CHECK (severity IN ('info','warn','critical')),
  cooldown_min  integer          NOT NULL DEFAULT 60 CHECK (cooldown_min >= 0),
  created_at    timestamptz      NOT NULL DEFAULT now(),
  updated_at    timestamptz      NOT NULL DEFAULT now()
);

COMMENT ON TABLE  alert_rules IS 'Typed alert rule storage. ADR-001: no jsonb rule_def column.';
COMMENT ON COLUMN alert_rules.vehicle_id IS 'NULL = applies to all vehicles owned by the user.';
COMMENT ON COLUMN alert_rules.cooldown_min IS 'Minimum minutes between consecutive alerts from this rule, regardless of signal value.';

CREATE TRIGGER alert_rules_set_updated_at
  BEFORE UPDATE ON alert_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_alert_rules_enabled ON alert_rules (enabled) WHERE enabled = true;
CREATE INDEX idx_alert_rules_signal  ON alert_rules (signal_name);


-- ===== source: 19-notification-channels.sql =====
-- =========================================================================
-- 19 — notification_channels + per-kind typed config + close FK from 17
-- ADR-001: per-kind typed config tables, no jsonb config blob.
-- =========================================================================

CREATE TYPE notification_channel_kind AS ENUM (
  'discord','slack','telegram','email','webhook','ntfy','pushover'
);

CREATE TABLE notification_channels (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        text                       NOT NULL,
  kind        notification_channel_kind  NOT NULL,
  enabled     boolean                    NOT NULL DEFAULT true,
  created_at  timestamptz                NOT NULL DEFAULT now(),
  updated_at  timestamptz                NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification_channels IS 'Parent table for typed notification channel config.';

CREATE TRIGGER notification_channels_set_updated_at
  BEFORE UPDATE ON notification_channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notif_channels_enabled ON notification_channels (enabled) WHERE enabled = true;

-- ============= Per-kind typed config children =============

CREATE TABLE notification_channel_discord (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,                -- encrypted at rest by internal/crypto
  username    text,
  avatar_url  text
);

CREATE TABLE notification_channel_slack (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  webhook_url text NOT NULL,                -- encrypted at rest
  channel     text,
  username    text
);

CREATE TABLE notification_channel_telegram (
  channel_id bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  bot_token  text NOT NULL,                 -- encrypted at rest
  chat_id    text NOT NULL
);

CREATE TABLE notification_channel_email (
  channel_id    bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  smtp_host     text NOT NULL,
  smtp_port     integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
  smtp_username text,
  smtp_password text,                       -- encrypted at rest
  from_address  text NOT NULL,
  to_addresses  text NOT NULL,              -- comma-separated; runtime parses
  use_tls       boolean NOT NULL DEFAULT true
);

CREATE TABLE notification_channel_webhook (
  channel_id   bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  url          text NOT NULL,
  http_method  text NOT NULL DEFAULT 'POST' CHECK (http_method IN ('POST','PUT','PATCH')),
  bearer_token text                         -- encrypted at rest
);

CREATE TABLE notification_channel_ntfy (
  channel_id  bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  server_url  text NOT NULL DEFAULT 'https://ntfy.sh',
  topic       text NOT NULL,
  auth_token  text                          -- encrypted at rest
);

CREATE TABLE notification_channel_pushover (
  channel_id bigint PRIMARY KEY REFERENCES notification_channels(id) ON DELETE CASCADE,
  user_key   text NOT NULL,                 -- encrypted at rest
  api_token  text NOT NULL                  -- encrypted at rest
);

-- ============= Close deferred FK from prompt 17 =============

ALTER TABLE automation_step_action_notify
  ADD CONSTRAINT action_notify_channel_fk
  FOREIGN KEY (channel_id) REFERENCES notification_channels(id) ON DELETE RESTRICT;


-- ===== source: 20-notifications.sql =====
-- =========================================================================
-- 20 — notifications + cooldowns + quiet hours + digests
-- All four are about notification delivery control. Grouped in one file.
-- =========================================================================

-- ============= Delivery log (append-only) =============

CREATE TABLE notifications (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ts           timestamptz NOT NULL DEFAULT now(),
  vehicle_id   bigint           REFERENCES vehicles(id)              ON DELETE SET NULL,
  rule_id      bigint           REFERENCES alert_rules(id)           ON DELETE SET NULL,
  channel_id   bigint  NOT NULL REFERENCES notification_channels(id) ON DELETE RESTRICT,
  severity     text    NOT NULL CHECK (severity IN ('info','warn','critical')),
  title        text    NOT NULL,
  body         text    NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending'
                       CHECK (delivery_status IN ('pending','delivered','failed','suppressed')),
  delivered_at timestamptz,
  error_message text,
  attempts     smallint NOT NULL DEFAULT 0
);
COMMENT ON TABLE notifications IS 'Append-only delivery log. No updated_at — status changes are tracked via attempts/delivery_status.';

CREATE INDEX idx_notif_ts          ON notifications (ts DESC);
CREATE INDEX idx_notif_pending     ON notifications (delivery_status, ts) WHERE delivery_status = 'pending';
CREATE INDEX idx_notif_rule_ts     ON notifications (rule_id, ts DESC) WHERE rule_id IS NOT NULL;

-- ============= Cooldowns (mutable) =============

CREATE TABLE notification_cooldowns (
  rule_id        bigint NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  vehicle_id     bigint REFERENCES vehicles(id) ON DELETE CASCADE,
  last_fired_at  timestamptz NOT NULL,
  cooldown_until timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, vehicle_id)
);
COMMENT ON TABLE notification_cooldowns IS 'Per-(rule, vehicle) cooldown state. PK includes nullable vehicle_id — TimescaleDB requires NOT NULL in PK; if vehicle_id is NULL we use an alternate sentinel handling at the app layer.';

CREATE TRIGGER notif_cooldowns_set_updated_at
  BEFORE UPDATE ON notification_cooldowns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= Quiet hours (mutable) =============

CREATE TABLE notification_quiet_hours (
  id            bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  channel_id    bigint NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  timezone      text NOT NULL DEFAULT 'UTC',
  days_of_week  smallint[] NOT NULL CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE notification_quiet_hours IS 'Per-channel scheduled mute windows. days_of_week 0=Sun..6=Sat, typed array (ADR-004 pattern).';

CREATE TRIGGER notif_quiet_hours_set_updated_at
  BEFORE UPDATE ON notification_quiet_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notif_quiet_channel ON notification_quiet_hours (channel_id);

-- ============= Digests (mutable) =============

CREATE TABLE notification_digests (
  id              bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  channel_id      bigint NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  cadence         text   NOT NULL CHECK (cadence IN ('hourly','daily','weekly')),
  delivery_time   time,
  delivery_dow    smallint CHECK (delivery_dow BETWEEN 0 AND 6),
  enabled         boolean NOT NULL DEFAULT true,
  last_sent_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE notification_digests IS 'Periodic batched-summary delivery config. delivery_time relevant for daily/weekly; delivery_dow for weekly only.';

CREATE TRIGGER notif_digests_set_updated_at
  BEFORE UPDATE ON notification_digests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_notif_digests_enabled ON notification_digests (enabled) WHERE enabled = true;


-- ===== source: 21-tesla-tokens.sql =====
-- =========================================================================
-- 21 — tesla_tokens
-- ADR-005: no raw_json column. Tokens stored as ciphertext text;
-- encryption performed by internal/crypto/ before write.
-- =========================================================================

CREATE TABLE tesla_tokens (
  id             bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  account_email  text        NOT NULL UNIQUE,
  access_token   text        NOT NULL,                  -- ciphertext
  refresh_token  text        NOT NULL,                  -- ciphertext
  token_type     text        NOT NULL DEFAULT 'Bearer',
  scopes         text,                                  -- comma-separated scope list
  expires_at     timestamptz NOT NULL,
  obtained_at    timestamptz NOT NULL DEFAULT now(),
  last_refreshed_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  tesla_tokens IS
  'Fleet API OAuth tokens. ADR-005: no raw_json. Tokens stored as ciphertext (encryption in internal/crypto/).';
COMMENT ON COLUMN tesla_tokens.access_token IS 'Encrypted at rest. Decrypt via internal/crypto/Decrypt before use.';
COMMENT ON COLUMN tesla_tokens.refresh_token IS 'Encrypted at rest. Decrypt via internal/crypto/Decrypt before use.';
COMMENT ON COLUMN tesla_tokens.scopes IS 'Comma-separated scope list. Runtime parses; never queried server-side.';

CREATE TRIGGER tesla_tokens_set_updated_at
  BEFORE UPDATE ON tesla_tokens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tesla_tokens_expires ON tesla_tokens (expires_at);


-- ===== source: 22-api-call-logs.sql =====
-- =========================================================================
-- 22 — api_call_logs (append-only hypertable, audit/observability)
-- ADR-005: no raw_json. Bodies excluded by default; only URL/status/duration.
-- =========================================================================

CREATE TABLE api_call_logs (
  id              bigint           GENERATED ALWAYS AS IDENTITY,
  ts              timestamptz      NOT NULL DEFAULT now(),
  vehicle_id      bigint           REFERENCES vehicles(id) ON DELETE SET NULL,
  service         text             NOT NULL DEFAULT 'tesla-fleet'
                                   CHECK (service IN ('tesla-fleet','geocoding','eia','ntfy','webhook')),
  http_method     text             NOT NULL CHECK (http_method IN ('GET','POST','PUT','PATCH','DELETE')),
  endpoint        text             NOT NULL,
  status_code     smallint         NOT NULL,
  duration_ms     integer          NOT NULL CHECK (duration_ms >= 0),
  error_message   text,
  rate_limited    boolean          NOT NULL DEFAULT false,
  PRIMARY KEY (ts, id)
);

COMMENT ON TABLE  api_call_logs IS
  'Append-only outbound API call log. ADR-005: no raw_json bodies; URL+status+duration only.';
COMMENT ON COLUMN api_call_logs.endpoint IS
  'URL path only (no query string). Strip identifiers from path before insert if PII risk.';

SELECT create_hypertable('api_call_logs', 'ts', chunk_time_interval => interval '7 days');

ALTER TABLE api_call_logs SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'service',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('api_call_logs', interval '30 days');
SELECT add_retention_policy ('api_call_logs', interval '365 days');

CREATE INDEX idx_api_logs_service_ts ON api_call_logs (service, ts DESC);
CREATE INDEX idx_api_logs_failures   ON api_call_logs (ts DESC) WHERE status_code >= 400;
CREATE INDEX idx_api_logs_rate_limited ON api_call_logs (ts DESC) WHERE rate_limited = true;


-- ===== source: 23-system-tables.sql =====
-- =========================================================================
-- 23 — system tables (settings / places / electricity / audit / etc.)
-- Closes deferred places FKs from prompts 15 and 17.
-- =========================================================================

-- ============= settings (key-value, typed) =============

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value_text  text,
  value_num   double precision,
  value_bool  boolean,
  data_kind   text NOT NULL CHECK (data_kind IN ('text','number','boolean')),
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE settings IS 'Typed key-value store. data_kind selects which value_* column is meaningful.';
CREATE TRIGGER settings_set_updated_at BEFORE UPDATE ON settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= polling_config (per-vehicle polling tuning) =============

CREATE TABLE polling_config (
  vehicle_id           bigint PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  awake_interval_sec   integer NOT NULL DEFAULT 30  CHECK (awake_interval_sec  >= 5),
  asleep_interval_sec  integer NOT NULL DEFAULT 300 CHECK (asleep_interval_sec >= 60),
  driving_interval_sec integer NOT NULL DEFAULT 5   CHECK (driving_interval_sec >= 1),
  enabled              boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE polling_config IS 'Per-vehicle polling tuning. Defaults match docker-compose POLL_INTERVAL convention.';
CREATE TRIGGER polling_config_set_updated_at BEFORE UPDATE ON polling_config FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= places (named locations) =============

CREATE TABLE places (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name        text             NOT NULL,
  latitude    double precision NOT NULL,
  longitude   double precision NOT NULL,
  radius_m    integer          NOT NULL DEFAULT 100 CHECK (radius_m > 0),
  category    text             CHECK (category IN ('home','work','charging','custom')),
  created_at  timestamptz      NOT NULL DEFAULT now(),
  updated_at  timestamptz      NOT NULL DEFAULT now()
);
COMMENT ON TABLE places IS 'Named locations. radius_m used for "inside place" tests at runtime.';
CREATE TRIGGER places_set_updated_at BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_places_category ON places (category);

-- ============= geofences (multi-point polygons stored as text WKT) =============

CREATE TABLE geofences (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name         text             NOT NULL,
  polygon_wkt  text             NOT NULL,                  -- POLYGON((lon lat, ...)) WKT
  category     text             CHECK (category IN ('home','work','restricted','custom')),
  created_at   timestamptz      NOT NULL DEFAULT now(),
  updated_at   timestamptz      NOT NULL DEFAULT now()
);
COMMENT ON TABLE  geofences IS 'Polygonal geofences. WKT text — no PostGIS dependency in Phase 3.';
COMMENT ON COLUMN geofences.polygon_wkt IS 'Well-Known Text POLYGON((lon lat, ...)). Runtime parses; not queried server-side.';
CREATE TRIGGER geofences_set_updated_at BEFORE UPDATE ON geofences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= electricity_cost (per-region rate schedule) =============

CREATE TABLE electricity_cost (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  region       text           NOT NULL,
  start_time   time           NOT NULL,
  end_time     time           NOT NULL,
  rate_per_kwh numeric(10, 6) NOT NULL CHECK (rate_per_kwh >= 0),
  currency     text           NOT NULL DEFAULT 'USD',
  effective_from timestamptz  NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  created_at   timestamptz    NOT NULL DEFAULT now(),
  updated_at   timestamptz    NOT NULL DEFAULT now()
);
COMMENT ON TABLE electricity_cost IS 'Time-of-use electricity rate schedule. Joined into charging_sessions cost computation.';
CREATE TRIGGER electricity_cost_set_updated_at BEFORE UPDATE ON electricity_cost FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX idx_electricity_region_time ON electricity_cost (region, start_time);

-- ============= gas_prices (regional gas price snapshots, append-only) =============

CREATE TABLE gas_prices (
  id           bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  ts           timestamptz    NOT NULL DEFAULT now(),
  region       text           NOT NULL,
  grade        text           NOT NULL DEFAULT 'regular' CHECK (grade IN ('regular','midgrade','premium','diesel')),
  price_per_gallon numeric(10, 4) NOT NULL CHECK (price_per_gallon >= 0),
  currency     text           NOT NULL DEFAULT 'USD',
  source       text           NOT NULL DEFAULT 'eia'
);
COMMENT ON TABLE gas_prices IS 'Append-only regional gas price snapshots. Source: EIA adapter.';
CREATE INDEX idx_gas_region_ts ON gas_prices (region, ts DESC);

-- ============= audit_logs (append-only) =============

CREATE TABLE audit_logs (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  ts          timestamptz NOT NULL DEFAULT now(),
  actor       text        NOT NULL,
  action      text        NOT NULL,
  entity_type text        NOT NULL,
  entity_id   bigint,
  detail      text,
  PRIMARY KEY (ts, id)
);
COMMENT ON TABLE audit_logs IS 'Append-only audit trail. detail is plain text, not jsonb.';
CREATE INDEX idx_audit_actor_ts  ON audit_logs (actor, ts DESC);
CREATE INDEX idx_audit_entity    ON audit_logs (entity_type, entity_id, ts DESC);

-- ============= command_executions (append-only) =============

CREATE TABLE command_executions (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  ts            timestamptz NOT NULL DEFAULT now(),
  vehicle_id    bigint      NOT NULL REFERENCES vehicles(id) ON DELETE SET NULL,
  command       text        NOT NULL,
  invoked_by    text        NOT NULL,
  status        text        NOT NULL CHECK (status IN ('queued','running','succeeded','failed','timed_out')),
  duration_ms   integer,
  error_message text,
  PRIMARY KEY (ts, id)
);
COMMENT ON TABLE command_executions IS 'Append-only Tesla command invocation log.';
CREATE INDEX idx_command_vehicle_ts ON command_executions (vehicle_id, ts DESC);

-- ============= fsm_transitions (append-only state machine log) =============

CREATE TABLE fsm_transitions (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  ts          timestamptz NOT NULL DEFAULT now(),
  vehicle_id  bigint      NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  from_state  text        NOT NULL,
  to_state    text        NOT NULL,
  trigger     text,
  PRIMARY KEY (ts, id)
);
COMMENT ON TABLE fsm_transitions IS 'Append-only FSM transition log. Used for stuck-state diagnostics.';
CREATE INDEX idx_fsm_vehicle_ts ON fsm_transitions (vehicle_id, ts DESC);

-- ============= embeddings (pgvector) =============

CREATE TABLE embeddings (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  entity_type text        NOT NULL,
  entity_id   bigint      NOT NULL,
  embedding   vector(384) NOT NULL,
  model       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, model)
);
COMMENT ON TABLE embeddings IS 'pgvector-backed embeddings for entity search. Dimension 384 matches default sentence-transformer.';
CREATE TRIGGER embeddings_set_updated_at BEFORE UPDATE ON embeddings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============= Close deferred FKs from prompts 15 and 17 =============

ALTER TABLE automation_step_condition_geofence
  ADD CONSTRAINT cond_geofence_place_fk
  FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE RESTRICT;

ALTER TABLE automation_step_trigger_geofence
  ADD CONSTRAINT trig_geofence_place_fk
  FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE RESTRICT;


-- ===== source: 24-caggs-fleet-stats.sql =====
-- =========================================================================
-- 24 — cagg_fleet_stats (daily per-vehicle drive roll-up)
-- ADR-006: replaces mv_energy_daily MV.
--
-- DEVIATION NOTE:
--   Implemented as a regular MATERIALIZED VIEW (not a TimescaleDB continuous
--   aggregate) because the source table `drives` is intentionally a regular,
--   mutable table (per schema 11 — "Mutable; re-scoring updates score column"),
--   and converting it to a hypertable is blocked by the incoming FK from
--   `trip_drives.drive_id → drives(id)` (TimescaleDB hypertables don't permit
--   FKs onto non-time unique columns). Naming kept as `cagg_*` for callsite
--   stability per ADR-006; refresh is operational (cron / maintenance worker
--   calls REFRESH MATERIALIZED VIEW CONCURRENTLY cagg_fleet_stats).
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_fleet_stats AS
SELECT
  vehicle_id,
  time_bucket('1 day', start_ts) AS day,
  count(*)                         AS drive_count,
  sum(distance_mi)                 AS total_distance_mi,
  sum(energy_used_kwh)             AS total_energy_kwh,
  sum(regen_kwh)                   AS total_regen_kwh,
  sum(duration_min)                AS total_duration_min,
  avg(avg_speed_mph)               AS avg_speed_mph,
  max(max_speed_mph)               AS max_speed_mph,
  avg(score)                       AS avg_score
FROM drives
GROUP BY vehicle_id, day
WITH NO DATA;

COMMENT ON MATERIALIZED VIEW cagg_fleet_stats IS
  'Daily per-vehicle drive roll-up. ADR-006 — replaces mv_energy_daily. '
  'Regular MV (not CAGG) because drives is a mutable non-hypertable; '
  'refresh via maintenance worker.';

-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX cagg_fleet_stats_pk
  ON cagg_fleet_stats (vehicle_id, day);


-- ===== source: 25-caggs-charging-summary.sql =====
-- =========================================================================
-- 25 — cagg_charging_summary (hourly charging telemetry roll-up)
-- ADR-006: replaces fn_charging_calendar_heatmap, fn_charging_hourly_distribution,
-- fn_charging_power_timeline.
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_charging_summary
WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  session_id,
  time_bucket('1 hour', ts)  AS hour,
  count(*)                    AS sample_count,
  avg(charger_power_kw)       AS avg_power_kw,
  max(charger_power_kw)       AS peak_power_kw,
  avg(charger_voltage)        AS avg_voltage,
  avg(charger_actual_current) AS avg_current,
  max(charge_energy_added_kwh) - min(charge_energy_added_kwh) AS energy_added_kwh,
  max(charge_miles_added)     - min(charge_miles_added)        AS miles_added,
  min(battery_level)          AS start_soc,
  max(battery_level)          AS end_soc
FROM charging_telemetry
GROUP BY vehicle_id, session_id, hour
WITH NO DATA;

COMMENT ON VIEW cagg_charging_summary IS
  'Hourly per-session charging roll-up. ADR-006 — replaces 3 fn_charging_* functions.';

SELECT add_continuous_aggregate_policy('cagg_charging_summary',
  start_offset      => interval '14 days',
  end_offset        => interval '1 hour',
  schedule_interval => interval '1 hour');


-- ===== source: 26-caggs-signal-hourly.sql =====
-- =========================================================================
-- 26 — cagg_signal_hourly (cold-signal hourly roll-up)
-- ADR-006: replaces mv_signal_stats. Combined with signal_observations'
-- 2-year retention (ADR-002), gives indefinite long-term signal shape.
-- =========================================================================

CREATE MATERIALIZED VIEW cagg_signal_hourly
WITH (timescaledb.continuous) AS
SELECT
  vehicle_id,
  signal_name,
  time_bucket('1 hour', ts) AS hour,
  count(*)                  AS sample_count,
  avg(value_numeric)        AS avg_value,
  min(value_numeric)        AS min_value,
  max(value_numeric)        AS max_value
FROM signal_observations
WHERE value_numeric IS NOT NULL
GROUP BY vehicle_id, signal_name, hour
WITH NO DATA;

COMMENT ON VIEW cagg_signal_hourly IS
  'Hourly per-(vehicle, signal) numeric roll-up. ADR-006 replaces mv_signal_stats. Excludes text/bool signals.';

SELECT add_continuous_aggregate_policy('cagg_signal_hourly',
  start_offset      => interval '30 days',
  end_offset        => interval '1 hour',
  schedule_interval => interval '1 hour');

