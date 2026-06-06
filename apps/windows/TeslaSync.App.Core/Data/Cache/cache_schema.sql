-- P2/W5-0001 — TeslaSync Windows offline cache schema (ADR-013 cache-then-network).
--
-- A single durable table backs every repository's cache-then-network reads. Each row
-- is one serialized API response keyed by a stable request key. `fetched_at` stamps the
-- wall-clock time (Unix milliseconds, UTC) the payload was retrieved so the freshness
-- layer can apply the two-minute live-state contract and bounded eviction can drop the
-- oldest rows first.
--
-- NOTE: no OAuth token, bearer, or credential material is ever persisted here — tokens
-- live only in the OS secure store (W4). This file documents the schema that
-- SqliteCacheStore creates via Microsoft.Data.Sqlite; the C# store keeps it in sync.

CREATE TABLE IF NOT EXISTS cache_entries (
    cache_key  TEXT    NOT NULL PRIMARY KEY,
    payload    TEXT    NOT NULL,
    fetched_at INTEGER NOT NULL
) WITHOUT ROWID;

-- Oldest-first eviction and freshness scans walk fetched_at.
CREATE INDEX IF NOT EXISTS idx_cache_entries_fetched_at
    ON cache_entries (fetched_at);
