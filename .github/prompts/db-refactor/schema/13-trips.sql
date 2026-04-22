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
