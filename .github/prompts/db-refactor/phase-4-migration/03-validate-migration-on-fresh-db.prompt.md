---
description: "Phase 4 — Validate 000142 against fresh PG (standalone) AND against the full 1->142 chain"
---

# 🔴 Migration 03 — Validate Baseline on Fresh DB

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 4 of 4

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | Verification report (run-log) |
| Depends on | `01-assemble-up-migration`, `02-write-down-migration` |
| Blocks | Phase 5 start |
| ADR refs | ADR-001, ADR-002, ADR-003, ADR-006, ADR-008 |
| Estimated effort | small (~30 min) |

## Single Goal

Run two end-to-end migration cycles against fresh DBs:
1. **Standalone:** apply only 142 — confirm zero-jsonb invariant + hypertables + CAGGs
2. **Full chain:** apply 1 through 142 — confirm 142 plays nicely on top of the 141 prior migrations (the configuration runtime sees on first deploy)

## What's Being Established

Phase 3 only proved each schema file applies in isolation. Phase 4 added the legacy DROP block — that block has never been tested against a DB that actually has the 141 prior migrations on it. This prompt is the first integration test.

## Recommendation

### Test 1 — Standalone

```powershell
docker rm -f ts-test-standalone 2>$null
docker run -d --name ts-test-standalone -e POSTGRES_PASSWORD=p `
  -p 5498:5432 timescale/timescaledb-ha:pg17
Start-Sleep 8
docker exec ts-test-standalone psql -U postgres -c "CREATE DATABASE v;"

Get-Content D:\repos\teslasync\migrations\000142_baseline_typed.up.sql -Raw |
  docker exec -i ts-test-standalone psql -U postgres -d v -v ON_ERROR_STOP=1
```

### Test 2 — Full chain

```powershell
docker rm -f ts-test-fullchain 2>$null
docker run -d --name ts-test-fullchain -e POSTGRES_PASSWORD=p `
  -p 5497:5432 timescale/timescaledb-ha:pg17
Start-Sleep 8
docker exec ts-test-fullchain psql -U postgres -c "CREATE DATABASE v;"

migrate -path D:\repos\teslasync\migrations -database `
  "postgres://postgres:p@localhost:5497/v?sslmode=disable" up 141

# Sanity check legacy tables exist
docker exec ts-test-fullchain psql -U postgres -d v -c `
  "SELECT 'climate_snapshots' AS t, count(*) FROM climate_snapshots;"

# Apply 142
migrate -path D:\repos\teslasync\migrations -database `
  "postgres://postgres:p@localhost:5497/v?sslmode=disable" up

docker exec ts-test-fullchain psql -U postgres -d v -c `
  "SELECT version FROM schema_migrations;"
# Expected: 142
```

## Suggested Fix (failure modes)

| Failure | Fix |
|---------|-----|
| Standalone fails on `CREATE TABLE` clash | Legacy DROP block is missing an entry — add and re-run prompt 01 |
| Full chain fails on `DROP TABLE … CASCADE` due to FK from a forgotten table | Add the missed table to the legacy DROP block |
| Hypertable count != 7 | A `create_hypertable(...)` line was lost during concat — diff vs `_baseline_source/` |
| CAGG count != 3 | Same diff approach |
| Zero-jsonb has > 1 row | Trace offending column to schema file; fix at source, re-snapshot+reassemble |

## Acceptance Criteria

- [ ] Test 1 (standalone) passes all 4 invariant checks
- [ ] Test 2 (full chain) reaches `schema_migrations.version = 142`
- [ ] Test 2 also passes all 4 invariant checks
- [ ] `migrate down 1` then `migrate up 1` cycle works on Test 2
- [ ] Run-log saved under `.github/prompts/db-refactor/logs/phase-4-validation-YYYYMMDD-HHMMSS.log`

## Verification — 4 invariants (both tests)

```powershell
function Check($container) {
  Write-Host "==== $container ===="
  docker exec $container psql -U postgres -d v -c `
    "SELECT 'jsonb' AS k, count(*) FROM information_schema.columns WHERE data_type='jsonb' AND table_schema='public'
     UNION ALL SELECT 'hypertables', count(*) FROM timescaledb_information.hypertables
     UNION ALL SELECT 'caggs', count(*) FROM timescaledb_information.continuous_aggregates
     UNION ALL SELECT 'compression_jobs', count(*) FROM timescaledb_information.jobs WHERE proc_name='policy_compression'
     UNION ALL SELECT 'retention_jobs', count(*) FROM timescaledb_information.jobs WHERE proc_name='policy_retention';"
  # Expected: jsonb=1, hypertables=7, caggs=3, compression_jobs=7, retention_jobs=7
}

Check 'ts-test-standalone'
Check 'ts-test-fullchain'
```

## Out of Scope

- Don't run with real data here.
- Don't keep test containers around after validation.
- Don't compare query plans against prod here (Phase 10).

## Cleanup

```powershell
docker rm -f ts-test-standalone ts-test-fullchain ts-schema-validate 2>$null
```

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/phase-4-migration/README.md
git add -f .github/prompts/db-refactor/logs/phase-4-validation-*.log
git commit -m "docs(db-refactor): record Phase 4 migration validation pass

Standalone + full-chain tests both pass: zero-jsonb except
automation_actions.command_params, 7 hypertables, 3 CAGGs,
14 retention/compression policies. up/down/up cycle validated.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- `phase-3-schema/99-validate-zero-jsonb-invariant.prompt.md`
- ADR-008
