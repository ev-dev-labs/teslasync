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
