-- Places cache: stores resolved location names to reduce geocoding API calls.
-- Resolution priority: geofence → places_cache → Google/Nominatim API.
CREATE TABLE IF NOT EXISTS places_cache (
    id            BIGSERIAL PRIMARY KEY,
    latitude      DOUBLE PRECISION NOT NULL,
    longitude     DOUBLE PRECISION NOT NULL,
    display_name  TEXT NOT NULL,
    source        VARCHAR(20) NOT NULL DEFAULT 'nominatim',
    place_id      TEXT,
    business_name TEXT,
    category      TEXT,
    city          TEXT,
    state         TEXT,
    country       TEXT,
    postcode      TEXT,
    hit_count     INTEGER NOT NULL DEFAULT 1,
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_places_cache_coords ON places_cache(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_places_cache_hits ON places_cache(hit_count DESC);
