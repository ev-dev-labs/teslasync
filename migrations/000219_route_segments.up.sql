-- Migration 219: Route segments (Ghost Racing / EV Segments).
--
-- Why this table exists
-- ─────────────────────
-- The Ghost Racing surface (internal/api/segments) turns a driver's own
-- history into Strava-style route "segments": clusters of drives that share
-- (approximately) the SAME start point AND the SAME end point. Once a route has
-- been driven twice or more it becomes a segment you can race against your own
-- personal best — a head-to-head ghost of your fastest / most-efficient run.
--
-- Detection is DERIVED, persistence is a CACHE
-- ────────────────────────────────────────────
-- Segments are DETECTED on the fly from the `drives` table by a pure,
-- table-tested clustering function (haversine start-radius + end-radius). This
-- table is the persistent identity for a detected segment so the leaderboard and
-- ghost endpoints can be addressed by a stable `id` in the URL. The list handler
-- UPSERTs each detected segment best-effort: a write failure is logged + counted
-- but never fails the read (the computed segments are still returned). Because
-- the anchor endpoint tuple is the cluster SEED (the earliest drive's start/end
-- coordinates), re-running detection over the same history is idempotent and
-- lands on the same row via the unique endpoint index.
--
-- Schema notes
-- ────────────
--   * id            — stable surrogate key addressed by /segments/{id}/... .
--   * vehicle_id    — owning vehicle (no FK; the writer stays lock-free, mirroring
--                     the phase-42 drives table convention).
--   * name          — human label, "start_place → end_place" (coord fallback).
--   * start/end lat+lon — the segment anchor (WGS84 decimal degrees). NOTE the
--                     column suffix is `lon` here (route_segments) whereas the
--                     source `drives` table uses `lng`; the handler maps between
--                     them explicitly.
--   * radius_m      — the match radius used to detect membership (default 250 m).
--   * distance_m    — representative (median) segment distance, SI metres.
--   * attempt_count — number of drives detected as members at last UPSERT.
--
-- The UNIQUE index on (vehicle_id, start_lat, start_lon, end_lat, end_lon) is the
-- ON CONFLICT target that makes the UPSERT idempotent per (vehicle, anchor). A
-- second plain index on (vehicle_id) serves the per-vehicle segment list.

CREATE TABLE IF NOT EXISTS route_segments (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    BIGINT NOT NULL,
    name          TEXT NOT NULL,
    start_lat     DOUBLE PRECISION,
    start_lon     DOUBLE PRECISION,
    end_lat       DOUBLE PRECISION,
    end_lon       DOUBLE PRECISION,
    radius_m      DOUBLE PRECISION NOT NULL DEFAULT 250,
    distance_m    DOUBLE PRECISION,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per (vehicle, anchor endpoints): the ON CONFLICT target for the
-- best-effort UPSERT so re-detecting the same segment updates in place instead
-- of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS route_segments_vehicle_endpoints
    ON route_segments (vehicle_id, start_lat, start_lon, end_lat, end_lon);

-- Serves the per-vehicle segment list (GET /vehicles/{id}/segments).
CREATE INDEX IF NOT EXISTS route_segments_vehicle
    ON route_segments (vehicle_id);

COMMENT ON TABLE route_segments IS
    'Ghost Racing / EV Segments identity table. One row per detected route segment (a cluster of drives sharing an approximate start AND end point). Detected on the fly from drives by internal/api/segments and UPSERTed best-effort so the leaderboard/ghost endpoints can be addressed by a stable id.';
COMMENT ON COLUMN route_segments.vehicle_id IS
    'Owning vehicle (no FK constraint to keep the writer hot path lock-free, mirroring the phase-42 drives table).';
COMMENT ON COLUMN route_segments.name IS
    'Human label for the segment, "start_place → end_place" with a lat,lon fallback when reverse geocoding is missing.';
COMMENT ON COLUMN route_segments.start_lon IS
    'WGS84 longitude at the segment anchor start (decimal degrees). Note: the source drives table names the same quantity start_lng; the handler maps between them.';
COMMENT ON COLUMN route_segments.radius_m IS
    'Match radius in metres used to detect segment membership (a drive belongs when its start AND end are each within this radius of the anchor). Defaults to 250 m.';
COMMENT ON COLUMN route_segments.distance_m IS
    'Representative (median) segment distance in SI metres across detected member drives.';
COMMENT ON COLUMN route_segments.attempt_count IS
    'Number of member drives detected at the last UPSERT. Recomputed on every list read.';
