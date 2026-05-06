-- Phase-42 / Prompt 0030: Recreate `positions` with SI-canonical columns.
--
-- ADR-004 #4: every unit-bearing column lives in canonical SI and the
-- unit suffix is part of the column name (speed_mps, altitude_m,
-- odometer_m, est_range_m, rated_range_m, ideal_range_m). The contract
-- is self-documenting and audit-grep-able — a future reader (or a
-- linter) cannot mistake an SI value for a wire-format value.
--
-- Forward-only rewrite: the pre-phase-42 `positions` table created in
-- migration 000142_baseline_typed used wire-format columns (latitude,
-- longitude, heading, elevation_m, plus a non-SI speed column whose
-- audit found mph values). Phase-42 is forward-only with no legacy
-- retention (see .github/ARCHITECTURE.md ADR-004), so the legacy table
-- is dropped wholesale here. Existing rows are not migrated; clients
-- backfill from MQTT replay if needed (see prompt 0090 runbook).
--
-- Slot variance: prompt 0030 hardcodes slot 000162, but that slot is
-- already occupied by 000162_pinned_items (a pre-phase-42 migration
-- committed long before this phase began). Slot 000182 is the next
-- free slot after the trailing edge of existing migrations
-- (000181_vehicle_unit_history is the prior phase-42 migration). This
-- mirrors the slot-variance the predecessor phase-42 prompt 0022
-- applied (000160 -> 000181). The schema, semantics, and gate intent
-- are otherwise exactly as the prompt specifies.

DROP TABLE IF EXISTS positions CASCADE;

CREATE TABLE positions (
  vehicle_id    BIGINT NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  altitude_m    DOUBLE PRECISION,
  speed_mps     DOUBLE PRECISION,
  heading_deg   DOUBLE PRECISION,
  gps_state     TEXT,
  odometer_m    DOUBLE PRECISION,
  est_range_m   DOUBLE PRECISION,
  rated_range_m DOUBLE PRECISION,
  ideal_range_m DOUBLE PRECISION,
  PRIMARY KEY (vehicle_id, ts)
);

SELECT create_hypertable('positions', 'ts', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

CREATE INDEX positions_vehicle_ts ON positions (vehicle_id, ts DESC);
CREATE INDEX positions_ts ON positions (ts DESC);

COMMENT ON TABLE positions IS
  'Phase-42 SI-canonical position hypertable. ADR-004 #4: every unit-bearing column is in canonical SI and the unit suffix is in the column name.';

COMMENT ON COLUMN positions.lat IS
  'WGS84 latitude in decimal degrees (angular, no SI conversion).';
COMMENT ON COLUMN positions.lng IS
  'WGS84 longitude in decimal degrees (angular, no SI conversion).';
COMMENT ON COLUMN positions.altitude_m IS
  'Altitude above the WGS84 ellipsoid in meters (SI).';
COMMENT ON COLUMN positions.speed_mps IS
  'Vehicle speed in meters/second (SI). Converted from wire-format by normalize.toSI using vehicle_unit_history.';
COMMENT ON COLUMN positions.heading_deg IS
  'Compass heading in degrees, [0, 360) (angular, no SI conversion).';
COMMENT ON COLUMN positions.gps_state IS
  'GPS lock state token from Fleet Telemetry (e.g. "fix"). Free-text, no closed enum.';
COMMENT ON COLUMN positions.odometer_m IS
  'Cumulative odometer in meters (SI).';
COMMENT ON COLUMN positions.est_range_m IS
  'Estimated remaining driving range in meters (SI).';
COMMENT ON COLUMN positions.rated_range_m IS
  'Rated remaining driving range in meters (SI).';
COMMENT ON COLUMN positions.ideal_range_m IS
  'Ideal remaining driving range in meters (SI).';
