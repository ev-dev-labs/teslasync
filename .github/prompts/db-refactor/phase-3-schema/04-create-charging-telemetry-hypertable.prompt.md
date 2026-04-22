---
description: "Phase 3 — Create charging_telemetry hypertable (1Hz charging session metrics)"
---

# 🔵 Schema 04 — `charging_telemetry` Hypertable

> **Severity:** Hot path (1 Hz when charging; required by every charging dashboard)
> **Priority:** High
> **Category:** Phase 3 — Schema (hypertable)
> **Prompt #:** 5 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/04-charging-telemetry.sql` |
| Depends on | `00-extensions`, `01-create-vehicles` |
| Blocks | `12-create-charging-sessions` (FK to session_id), `25-create-caggs-charging-summary` |
| ADR refs | ADR-002 (hot signals), ADR-003 (730d retention — longer than positions for charging history) |
| Estimated effort | small (~30 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/04-charging-telemetry.sql` containing the `charging_telemetry` hypertable. One CREATE TABLE, one hypertable, one compression policy, one retention policy, one explicit index.

## What's Being Established

`charging_telemetry` records sub-session metrics (1 Hz). The summarized session lives in `charging_sessions` (prompt 12) which references this for detail rows. Retention is 730 days (2 years) vs positions' 365 — charging history is more valuable for battery health analytics.

## Recommendation

- PK = `(vehicle_id, ts)`
- Optional `session_id bigint NULL` — populated when a session is correlated; FK is added as ALTER in prompt 12 (deferred to avoid forward FK)
- Hypertable, 1-day chunks
- Compression segmentby `vehicle_id`, after 7 days
- Retention 730 days

## Output (full file contents)

```sql
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
```

## Suggested Fix

1. Confirm `vehicles` exists.
2. Write file.
3. Apply.
4. Verify.
5. Commit.

## Acceptance Criteria

- [ ] File exists matching output
- [ ] `psql -f` succeeds
- [ ] Hypertable registered, compression on, 1-day chunks
- [ ] Two policies: compression (7d), retention (730d)
- [ ] Both indexes present
- [ ] FK to vehicles is CASCADE; `session_id` is currently FK-less (added in prompt 12)
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\04-charging-telemetry.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT hypertable_name, compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name='charging_telemetry';"

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT schedule_interval, proc_name FROM timescaledb_information.jobs WHERE hypertable_name='charging_telemetry' ORDER BY proc_name;"

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT indexname FROM pg_indexes WHERE tablename='charging_telemetry' ORDER BY indexname;"
# Expected: idx_chg_telem_session, idx_chg_telem_vehicle_ts (+ PK index)
```

## Out of Scope

- Don't add `charging_sessions` here — that's prompt 12.
- Don't add `cost_*` columns — cost is computed by `internal/analytics/tco.go` joining electricity_cost.
- Don't add the FK from `session_id` here — added by ALTER in prompt 12 (avoids forward reference).

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/04-charging-telemetry.sql
git commit -m "schema(db-refactor): add charging_telemetry hypertable

1 Hz per-charging-session metrics. 1-day chunks, compression after 7d,
730d retention. session_id FK deferred to prompt 12 (forward dep).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-003-snapshot-table-strategy.md`
- Repo memory: TypeTime compound flattening for scheduled_charging_at
