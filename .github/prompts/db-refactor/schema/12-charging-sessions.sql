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
