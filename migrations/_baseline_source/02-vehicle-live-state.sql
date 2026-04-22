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
