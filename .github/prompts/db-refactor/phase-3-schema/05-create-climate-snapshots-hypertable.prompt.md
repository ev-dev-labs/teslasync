---
description: "Phase 3 — Create climate_snapshots hypertable (HVAC + temps)"
---

# 🔵 Schema 05 — `climate_snapshots` Hypertable

> **Severity:** Hot path (0.1-1 Hz when climate active)
> **Priority:** Medium-High
> **Category:** Phase 3 — Schema (hypertable)
> **Prompt #:** 6 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/05-climate-snapshots.sql` |
| Depends on | `00-extensions`, `01-create-vehicles` |
| Blocks | (no direct blocks; CAGGs may aggregate later) |
| ADR refs | ADR-003 (180d retention — climate isn't valuable past one season) |
| Estimated effort | small (~20 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/05-climate-snapshots.sql`: hot hypertable for HVAC + temperature signals. 14-day compression delay (climate often re-queried within recent weeks), 180-day retention.

## What's Being Established

ADR-003 carves climate into its own hypertable rather than rolling it into a generic snapshots table — climate writes are bursty (off entirely while parked), and 180-day retention is ample because climate analytics are seasonal not historical.

## Recommendation

- PK = `(vehicle_id, ts)`
- Hypertable, 1-day chunks
- Compression after 14 days (longer delay than positions — climate dashboards often look back 2 weeks)
- Retention 180 days
- `hvac_state` and `defrost_mode` as `text` with values matching `vehicle_live_state` CHECK lists (per repo memory: hvac auto mode normalized in migration 000139)

## Output (full file contents)

```sql
-- =========================================================================
-- 05 — climate_snapshots (hot hypertable; bursty 0.1-1 Hz)
-- ADR-003: separate hypertable, 14d compression delay, 180d retention.
-- =========================================================================

CREATE TABLE climate_snapshots (
  vehicle_id              bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts                      timestamptz      NOT NULL,
  inside_temp_c           double precision,
  outside_temp_c          double precision,
  driver_setpoint_c       double precision,
  passenger_setpoint_c    double precision,
  hvac_state              text,
  defrost_mode            text,
  is_climate_on           boolean,
  is_preconditioning      boolean,
  fan_status              smallint,
  seat_heater_left        smallint,
  seat_heater_right       smallint,
  seat_heater_rear_left   smallint,
  seat_heater_rear_right  smallint,
  steering_wheel_heater   boolean,
  cabin_overheat_protection boolean,
  source                  text             NOT NULL DEFAULT 'fleet_telemetry'
                                           CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts)
);

COMMENT ON TABLE  climate_snapshots IS
  'HVAC + temperature history. 14d compression delay accommodates 2-week dashboard look-backs.';
COMMENT ON COLUMN climate_snapshots.defrost_mode IS
  'Per migration 000138 widening — text with normalized values from compound DefrostMode signal.';
COMMENT ON COLUMN climate_snapshots.fan_status IS
  '0-7 fan speed level from Fleet Telemetry FanStatus signal.';

SELECT create_hypertable('climate_snapshots', 'ts', chunk_time_interval => interval '1 day');

ALTER TABLE climate_snapshots SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('climate_snapshots', interval '14 days');
SELECT add_retention_policy ('climate_snapshots', interval '180 days');

CREATE INDEX idx_climate_vehicle_ts ON climate_snapshots (vehicle_id, ts DESC);
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
- [ ] Hypertable registered with 1-day chunks
- [ ] Compression policy = 14 days, retention = 180 days
- [ ] Index `idx_climate_vehicle_ts` exists
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\05-climate-snapshots.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT config FROM timescaledb_information.jobs WHERE hypertable_name='climate_snapshots' AND proc_name='policy_compression';"
# Expected: config contains compress_after = 14 days

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT column_name FROM information_schema.columns WHERE table_name='climate_snapshots' AND data_type IN ('jsonb','json');"
# Expected: 0 rows
```

## Out of Scope

- Don't add window/door state — that's `security_events` and compound flattening (see repo memory).
- Don't add tire pressure — that's `vehicle_meta_snapshots` (low-freq, event-driven).
- Don't compute "comfort index" or other derived metrics here — analytics layer.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/05-climate-snapshots.sql
git commit -m "schema(db-refactor): add climate_snapshots hypertable

HVAC + temperature history. 1-day chunks, compression after 14d,
180d retention (climate is seasonal, not historical).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-003-snapshot-table-strategy.md`
- Repo memory: HVAC auto mode normalization (migration 000139)
- Repo memory: defrost_mode widening (migration 000138)
