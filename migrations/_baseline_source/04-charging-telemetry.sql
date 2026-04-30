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
