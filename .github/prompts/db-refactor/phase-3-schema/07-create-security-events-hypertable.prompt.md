---
description: "Phase 3 — Create security_events hypertable (door/lock/sentry events)"
---

# 🔵 Schema 07 — `security_events` Hypertable

> **Severity:** Audit-grade hot path (5-year retention for compliance)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (hypertable)
> **Prompt #:** 8 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/07-security-events.sql` |
| Depends on | `00-extensions`, `01-create-vehicles` |
| Blocks | (none directly) |
| ADR refs | ADR-003 (kept separate due to 5-year audit retention) |
| Estimated effort | small (~20 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/07-security-events.sql`: event-driven hypertable for door/window/lock/sentry-mode changes. 7-day chunks (events are sparse), 30-day compression delay, **5-year retention** (audit).

## What's Being Established

ADR-003 keeps `security_events` separate from the consolidated low-freq snapshot table because of its uniquely long retention (5 years vs ≤730 days everywhere else). Mixing it in would force the consolidated table to inherit that retention, wasting storage.

## Recommendation

- PK = `(vehicle_id, ts)` plus `event_type` to allow simultaneous events
- 7-day chunks (events are infrequent → fewer, larger chunks)
- Compression after 30 days, retention 1825 days (5y)
- `event_type` is text + CHECK (closed enum, can grow)
- `doors_open`, `windows_open` are normalized JSON-strings per repo memory (compound TypeDoors flattening)

## Output (full file contents)

```sql
-- =========================================================================
-- 07 — security_events (hot hypertable; event-driven, audit-grade)
-- ADR-003: 5-year retention. Kept separate so other low-freq tables
-- aren't forced to inherit it.
-- =========================================================================

CREATE TABLE security_events (
  vehicle_id    bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts            timestamptz      NOT NULL,
  event_type    text             NOT NULL
                                 CHECK (event_type IN (
                                   'door_open','door_closed','window_open','window_closed',
                                   'lock','unlock','sentry_on','sentry_off',
                                   'user_present','user_absent','trunk_open','trunk_closed',
                                   'frunk_open','frunk_closed','sentry_alert','tonneau_change'
                                 )),
  doors_open    text,
  windows_open  text,
  locked        boolean,
  sentry_mode   boolean,
  user_present  boolean,
  detail        text,
  source        text             NOT NULL DEFAULT 'fleet_telemetry'
                                 CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts, event_type)
);

COMMENT ON TABLE  security_events IS
  'Event-driven door/lock/sentry history. 5-year audit retention per ADR-003.';
COMMENT ON COLUMN security_events.doors_open IS
  'Normalized JSON-string from compound TypeDoors signal (repo memory: signal_types normalization).';
COMMENT ON COLUMN security_events.windows_open IS
  'Normalized JSON-string from compound WindowState signal (migration 000132 normalization).';

SELECT create_hypertable('security_events', 'ts', chunk_time_interval => interval '7 days');

ALTER TABLE security_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id, event_type',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('security_events', interval '30 days');
SELECT add_retention_policy ('security_events', interval '1825 days');

CREATE INDEX idx_security_vehicle_ts   ON security_events (vehicle_id, ts DESC);
CREATE INDEX idx_security_event_type   ON security_events (event_type, ts DESC);
```

## Suggested Fix

1. Confirm `vehicles` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists, matches output
- [ ] `psql -f` succeeds
- [ ] Hypertable registered with **7-day** chunks (NOT 1-day)
- [ ] Compression policy = 30 days; retention = 1825 days
- [ ] Both indexes present
- [ ] `event_type` CHECK applied with all 16 enum values
- [ ] `doors_open` and `windows_open` are `text` (NOT jsonb)
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\07-security-events.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

# 7-day chunk interval
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT integer_interval, time_interval FROM timescaledb_information.dimensions WHERE hypertable_name='security_events';"
# Expected: time_interval = 7 days

# 5y retention
docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT config FROM timescaledb_information.jobs WHERE hypertable_name='security_events' AND proc_name='policy_retention';"
# Expected: drop_after = 1825 days (or 5 years)
```

## Out of Scope

- Don't fold this into `vehicle_meta_snapshots` — retention is incompatible (ADR-003 keeps it separate).
- Don't add geofence enter/exit — those are derived events, computed from positions in Go.
- Don't add an `acknowledged_by_user` column — that's a future feature, not Phase 3.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/07-security-events.sql
git commit -m "schema(db-refactor): add security_events hypertable

Event-driven door/lock/sentry history. 7-day chunks, compression after 30d,
1825d (5y) retention for audit.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-003-snapshot-table-strategy.md`
- Repo memory: TypeDoors compound flattening, migration 000132 normalization
