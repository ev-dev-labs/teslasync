# ADR-005: Tesla raw_json Columns — Delete

**Status:** Accepted (2026-04-22)
**Date:** 2026-04-22
**Owner:** Backend
**Depends on:** ADR-001

---

## Context

Several `tesla_*` tables carry a `raw_json` column storing the full Tesla Fleet API response that produced the row:

- `tesla_charging_history.raw_json`
- `tesla_charging_sessions.raw_json`
- `tesla_energy_history.raw_json`
- `tesla_energy_live_status.raw_json`
- `tesla_energy_sites.raw_json`
- `tesla_energy_sites.site_info_json`
- `tesla_user_config.data` (JSONB)
- `tesla_user_orders.raw_json`
- `tesla_user_profile.raw_json`
- `tesla_vehicle_drivers.raw_json`
- `tesla_vehicle_drivers.invitations` (JSONB)
- `tesla_fleet_telemetry_errors.raw_json`

Total: ~12 JSONB columns whose stated purpose is "preserve the Tesla response for debugging".

A search of the codebase confirms:
- **Zero production read paths** consume these columns (`grep "raw_json" internal/`)
- **Zero exports** include them
- **Zero dashboards** query them
- They exist purely "in case we need them"

Storage cost (estimated from local backup): ~30% of `tesla_*` table sizes is the raw_json columns. At fleet scale this is meaningful.

The *real* requirement behind "preserve the Tesla response" is **replay capability** — the ability to reconstruct what Tesla told us if a downstream computation looks wrong. That requirement is legitimate but is being satisfied in the wrong place.

## Decision

**Delete all `raw_json`, `data` (when JSONB on tesla_*), `site_info_json`, and `invitations` (JSONB) columns. Replace with a single dedicated event log if/when replay capability is actually requested.**

### Step 1 (this branch): Delete the columns
- Schema design phase (Phase 3) drops these columns
- Repos and models are updated to ignore them
- No replacement table is created in this branch

### Step 2 (deferred — only if requested): Append-only event log
If a future ticket establishes a real need for replay:
```sql
CREATE TABLE tesla_api_events (
  id          bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz NOT NULL,
  endpoint    text NOT NULL,           -- e.g. /api/1/vehicles/{id}/charge_history
  http_status integer NOT NULL,
  request_id  text,                    -- Tesla's request ID header for support
  response_body bytea NOT NULL         -- gzip-compressed raw bytes
);
SELECT create_hypertable('tesla_api_events', 'occurred_at', chunk_time_interval => interval '7 days');
ALTER TABLE tesla_api_events SET (timescaledb.compress);
SELECT add_compression_policy('tesla_api_events', interval '14 days');
SELECT add_retention_policy('tesla_api_events', interval '90 days');
```
Even this future table uses `bytea` (compressed bytes), not jsonb — replay needs the *exact* bytes Tesla sent, including whitespace and key order, which JSONB normalization destroys.

This step is **not** done in this branch.

## Consequences

**Positive:**
- ~12 JSONB columns eliminated immediately
- Storage savings (~30% of `tesla_*` tables, exact figure measured during Phase 5)
- Cleaner models and repos
- No "schrodinger's column" — every column has a real consumer

**Negative:**
- If a bug requires replaying a Tesla response from before this change, we can't (the data is gone after migration)
- Mitigation: the local backup (`backups/data.dump`) preserves the current raw_json data; if replay is ever needed for historical incidents, restore that backup to a sandbox

**Neutral:**
- The deferred event log decision is a future ADR; not pre-committed here

**Risks:**
- Someone may quietly add code that depends on raw_json before this lands. Mitigation: grep + lint + reviewer awareness.
