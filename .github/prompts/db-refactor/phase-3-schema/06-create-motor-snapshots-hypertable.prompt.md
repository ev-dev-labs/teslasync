---
description: "Phase 3 — Create motor_snapshots hypertable (drivetrain telemetry)"
---

# 🔵 Schema 06 — `motor_snapshots` Hypertable

> **Severity:** Hot path (1-10 Hz when driving)
> **Priority:** Medium
> **Category:** Phase 3 — Schema (hypertable)
> **Prompt #:** 7 of 28

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output file | `.github/prompts/db-refactor/schema/06-motor-snapshots.sql` |
| Depends on | `00-extensions`, `01-create-vehicles` |
| Blocks | (none — feeds analytics layer only) |
| ADR refs | ADR-003 (90d retention — only used by perf analytics) |
| Estimated effort | small (~20 min) |
| Throwaway DB role | applies to running `ts-schema-validate` container |

## Single Goal

Write `schema/06-motor-snapshots.sql`: hot hypertable for motor RPM/torque/power/temp signals. 7-day compression delay, 90-day retention (shortest of the hot tier — perf analytics work on recent windows).

## What's Being Established

Motor data is firehose-rate during driving, expensive to keep, and only consumed by performance analytics dashboards that look at the last few weeks. ADR-003 sets retention to 90 days deliberately; longer is wasteful.

## Recommendation

- PK = `(vehicle_id, ts)`
- Hypertable, 1-day chunks
- Compression after 7 days; retention 90 days
- Includes both front and rear motor metrics (model variant determines which are populated; nullable)
- `power_kw` may be negative (regen) — `double precision` handles signed

## Output (full file contents)

```sql
-- =========================================================================
-- 06 — motor_snapshots (hot hypertable; 1-10 Hz when driving)
-- ADR-003: 90d retention — perf analytics only, no long-term value.
-- =========================================================================

CREATE TABLE motor_snapshots (
  vehicle_id        bigint           NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts                timestamptz      NOT NULL,
  power_kw          double precision,
  motor_rpm_front   integer,
  motor_rpm_rear    integer,
  torque_nm_front   double precision,
  torque_nm_rear    double precision,
  motor_temp_c_front double precision,
  motor_temp_c_rear double precision,
  inverter_temp_c   double precision,
  battery_temp_c    double precision,
  regen_kw          double precision,
  shift_state       text             CHECK (shift_state IN ('P','R','N','D')),
  source            text             NOT NULL DEFAULT 'fleet_telemetry'
                                     CHECK (source IN ('fleet_telemetry','fleet_api','manual','backfill')),
  PRIMARY KEY (vehicle_id, ts)
);

COMMENT ON TABLE  motor_snapshots IS
  'High-frequency drivetrain telemetry. 90d retention; only fed to perf analytics.';
COMMENT ON COLUMN motor_snapshots.power_kw IS 'Signed: positive when consuming, negative when regenerating.';
COMMENT ON COLUMN motor_snapshots.regen_kw IS 'Magnitude of regen (always positive). Redundant with negative power_kw but useful for filtering.';

SELECT create_hypertable('motor_snapshots', 'ts', chunk_time_interval => interval '1 day');

ALTER TABLE motor_snapshots SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'vehicle_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('motor_snapshots', interval '7 days');
SELECT add_retention_policy ('motor_snapshots', interval '90 days');

CREATE INDEX idx_motor_vehicle_ts ON motor_snapshots (vehicle_id, ts DESC);
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
- [ ] Hypertable registered, 1-day chunks
- [ ] Retention = 90 days, compression delay = 7 days
- [ ] Index `idx_motor_vehicle_ts` exists
- [ ] `shift_state` CHECK constraint applied
- [ ] **Zero** JSONB
- [ ] Committed

## Verification

```powershell
Get-Content D:\repos\teslasync\.github\prompts\db-refactor\schema\06-motor-snapshots.sql -Raw |
  docker exec -i ts-schema-validate psql -U postgres -d v -v ON_ERROR_STOP=1

docker exec ts-schema-validate psql -U postgres -d v -c `
  "SELECT proc_name FROM timescaledb_information.jobs WHERE hypertable_name='motor_snapshots' ORDER BY proc_name;"
# Expected: policy_compression, policy_retention
```

## Out of Scope

- Don't add aggregate "average power per drive" — that goes in `drives` (prompt 11) or a CAGG.
- Don't add accelerometer/g-force columns — those are cold signals (signal_observations).
- Don't extend retention past 90 days — ADR-003 explicitly capped it.

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/schema/06-motor-snapshots.sql
git commit -m "schema(db-refactor): add motor_snapshots hypertable

Drivetrain telemetry. 1-day chunks, compression after 7d,
90d retention (perf analytics only — no long-term value).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `.github/prompts/db-refactor/adrs/ADR-003-snapshot-table-strategy.md`
