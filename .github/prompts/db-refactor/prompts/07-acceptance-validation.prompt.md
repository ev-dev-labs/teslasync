# 07 — Acceptance Validation

**Phase:** 5 (final gate before merging this branch to `main`)
**Branch:** `db-refactor/timescaledb-migration-mo-jsonb-at-all`
**Pre-req:** Prompts 02-06 complete
**Estimated effort:** half day

---

## Goal

Prove the refactor is ready to merge. Every check below must pass. If any fails, do NOT merge — go back and fix.

This is the **gate**. No "we'll fix it in staging" exceptions.

## Check 1 — Build and lint (Go)

```powershell
cd D:\repos\teslasync
go build ./...
go vet ./...
go test -race -count=1 ./...
golangci-lint run ./...
```

**Expected:** all 4 commands exit 0.

## Check 2 — Build and lint (Frontend)

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
npm run lint
npm run build
npm test
```

**Expected:** all 4 commands exit 0. Build output produced in `dist/`.

## Check 3 — Migration applies cleanly on fresh DB

```powershell
docker compose down
docker volume rm teslasync_postgres_data
docker compose up -d postgres
# wait for healthy
$env:MIGRATE_ONLY = "true"; .\teslasync.exe; Remove-Item env:MIGRATE_ONLY
```

**Expected:** exit 0; `schema_migrations` table contains version 142.

## Check 4 — Zero JSONB invariant

```sql
-- Run against fresh DB after migration
SELECT table_name, column_name
FROM information_schema.columns
WHERE data_type IN ('jsonb','json')
  AND table_schema = 'public'
ORDER BY table_name, column_name;
```

**Expected:** Exactly **1 row**:
```
automation_actions | command_params
```

If more than 1 row → FAIL. The carve-out list lives in ADR-001/004; only `automation_actions.command_params` is permitted.

## Check 5 — Every JSONB column has the carve-out comment

```sql
SELECT
  c.table_name,
  c.column_name,
  pgd.description
FROM information_schema.columns c
LEFT JOIN pg_catalog.pg_statio_all_tables st ON c.table_schema = st.schemaname AND c.table_name = st.relname
LEFT JOIN pg_catalog.pg_description pgd ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position
WHERE c.data_type = 'jsonb' AND c.table_schema = 'public';
```

**Expected:** the `description` column references "ADR-" for every row.

## Check 6 — All hypertables exist with compression and retention

```sql
SELECT
  h.hypertable_name,
  c.compression_enabled,
  (SELECT count(*) FROM timescaledb_information.jobs j
   WHERE j.hypertable_name = h.hypertable_name AND j.proc_name = 'policy_compression') AS has_compression_policy,
  (SELECT count(*) FROM timescaledb_information.jobs j
   WHERE j.hypertable_name = h.hypertable_name AND j.proc_name = 'policy_retention') AS has_retention_policy
FROM timescaledb_information.hypertables h
LEFT JOIN timescaledb_information.compression_settings c ON c.hypertable_name = h.hypertable_name
ORDER BY h.hypertable_name;
```

**Expected:** every hypertable shows `compression_enabled = true`, `has_compression_policy = 1`, `has_retention_policy = 1`.

The expected hypertable list:
- positions
- charging_telemetry
- climate_snapshots
- motor_snapshots
- security_events
- vehicle_meta_snapshots
- signal_observations

## Check 7 — All CAGGs exist with refresh policies

```sql
SELECT
  view_name,
  (SELECT count(*) FROM timescaledb_information.jobs j
   WHERE j.hypertable_name = view_name AND j.proc_name = 'policy_refresh_continuous_aggregate') AS has_refresh_policy
FROM timescaledb_information.continuous_aggregates;
```

**Expected:** every CAGG defined in `schema/12-caggs.sql` is listed and has `has_refresh_policy = 1`.

## Check 8 — Replay smoke test

Replay a chunk of real telemetry from the local backup:
```powershell
# Restore one vehicle's worth of data into the new schema (using the data preserved in backups/data.dump)
go run .\cmd\replay-backup --source backups\data.dump --vehicle-id 1 --duration 1h
```

Then:
```sql
-- All hot tables should have rows
SELECT 'positions' AS t, count(*) FROM positions
UNION ALL SELECT 'charging_telemetry', count(*) FROM charging_telemetry
UNION ALL SELECT 'climate_snapshots', count(*) FROM climate_snapshots
UNION ALL SELECT 'motor_snapshots', count(*) FROM motor_snapshots
UNION ALL SELECT 'security_events', count(*) FROM security_events
UNION ALL SELECT 'signal_observations', count(*) FROM signal_observations
UNION ALL SELECT 'signal_catalog', count(*) FROM signal_catalog;
```

**Expected:** every row has a non-zero count. `signal_observations` and `signal_catalog` MUST be non-zero (proves cold path works).

## Check 9 — End-to-end API smoke test

Bring up the full stack and hit the top 10 endpoints:

```powershell
docker compose up -d
Start-Sleep 30
@(
  '/api/v1/healthz',
  '/api/v1/vehicles',
  '/api/v1/vehicles/1/state',
  '/api/v1/vehicles/1/energy',
  '/api/v1/drives',
  '/api/v1/charging',
  '/api/v1/analytics/fleet',
  '/api/v1/automations',
  '/api/v1/notifications',
  '/api/v1/system/status'
) | ForEach-Object {
  $r = Invoke-WebRequest -Uri "http://localhost:8080$_" -UseBasicParsing
  "{0,-50} {1}" -f $_, $r.StatusCode
}
```

**Expected:** all 10 return 200.

## Check 10 — No regressions in existing test fixtures

```powershell
go test -race -count=1 -tags=integration ./tests/...
```

**Expected:** all integration tests pass.

## Check 11 — Storage and performance baseline (informational, not gating)

Capture and document:
- Total DB size after replay
- Compressed vs uncompressed ratio for `signal_observations`
- p95 latency for `/api/v1/vehicles/1/state` (run 100 requests, measure)
- p95 latency for `/api/v1/analytics/fleet` (same)

These numbers go into the staging soak comparison (prompt 08).

## Sign-off

If all checks 1-10 pass, this branch is ready to merge to `main`. Open the PR with the validation output pasted in the description.

If any check fails, fix and re-run. Do not merge with known failures.

## Exit gate

- [ ] Check 1 (Go build/test/lint) ✅
- [ ] Check 2 (Frontend build/test/lint) ✅
- [ ] Check 3 (Fresh migration) ✅
- [ ] Check 4 (Zero JSONB except 1 carve-out) ✅
- [ ] Check 5 (Carve-out documented) ✅
- [ ] Check 6 (All hypertables compressed + retention) ✅
- [ ] Check 7 (All CAGGs have refresh policies) ✅
- [ ] Check 8 (Replay populates hot + cold tables) ✅
- [ ] Check 9 (10 endpoints return 200) ✅
- [ ] Check 10 (Integration tests pass) ✅
- [ ] Check 11 (Baseline metrics captured) ℹ️ informational
