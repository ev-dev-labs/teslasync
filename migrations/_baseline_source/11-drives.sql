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
