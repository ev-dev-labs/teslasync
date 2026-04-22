---
description: "Phase 8 — Wipe local volumes, bring up fresh stack, verify migration 142 + CAGGs apply"
---

# 🔴 Helm-Docker 03 — Validate Fresh Deploy

> **Severity:** Merge-gate | **Priority:** Critical | **Prompt #:** 3 of 3

## Artifact Metadata

| Field | Value |
|-------|-------|
| Output | Run logs proving fresh stack converges |
| Depends on | `01-update-docker-compose`, `02-update-helm-chart` |
| Blocks | Phase 9 (acceptance) |
| ADR refs | ADR-007, ADR-009 |

## Single Goal

Wipe local docker-compose volumes, bring everything up from scratch, and prove: (a) postgres starts on TS-HA image, (b) extensions are loaded by init script, (c) migrations apply through 142, (d) all 3 CAGGs are registered, (e) teslasync API container becomes healthy.

## What's Being Established

This is the local-dev equivalent of the staging cutover (Phase 10). If this fails, do NOT advance to Phase 9 — fix forward in this prompt.

## Recommendation

```powershell
cd D:\repos\teslasync

# 1. Tear everything down
docker compose down

# 2. Wipe all volumes (ADR-009: staging data loss accepted)
docker volume rm teslasync_postgres_data -f
docker volume rm teslasync_grafana_data -f
docker volume rm teslasync_mosquitto_data -f
docker volume rm teslasync_redis_data -f

# 3. Bring up only postgres first (so we can watch the init script run)
docker compose up -d postgres
Start-Sleep -Seconds 15

# 4. Verify image
docker inspect teslasync-postgres --format '{{.Config.Image}}'
# Expected: timescale/timescaledb-ha:pg17

# 5. Verify extensions loaded
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "\dx"
# Expected: timescaledb, vector, pg_stat_statements (plus plpgsql)

# 6. Bring up the rest
docker compose up -d
Start-Sleep -Seconds 30

# 7. Verify teslasync container is healthy (it ran migrations)
docker ps --filter name=teslasync --format "table {{.Names}}\t{{.Status}}"
# Expected: teslasync-api shows "healthy"

# 8. Verify migration 142 applied
docker exec teslasync-postgres psql -U teslasync -d teslasync -c `
    "SELECT version, dirty FROM schema_migrations ORDER BY version DESC LIMIT 3;"
# Expected: top row version = 142, dirty = false

# 9. Verify hypertables present (7 expected per Phase 3)
docker exec teslasync-postgres psql -U teslasync -d teslasync -c `
    "SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY hypertable_name;"
# Expected: 7 rows (positions, signal_observations, charging_telemetry,
#   climate_snapshots, motor_snapshots, security_events, vehicle_meta_snapshots)

# 10. Verify CAGGs (3 expected per Phase 3)
docker exec teslasync-postgres psql -U teslasync -d teslasync -c `
    "SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY view_name;"
# Expected: 3 rows

# 11. Verify zero-jsonb invariant (Phase 9 prompt 04 will deep-check; smoke here)
docker exec teslasync-postgres psql -U teslasync -d teslasync -c `
    "SELECT count(*) FROM information_schema.columns WHERE data_type IN ('jsonb','json') AND table_schema='public';"
# Expected: 1 (only automation_step_action_run_command.command_params per ADR-001)

# 12. API smoke
curl -sf http://localhost:8080/healthz
# Expected: {"status":"ok",...}
```

If any step fails, capture the failing command output, fix forward (could be a missing extension, wrong PGDATA path, init-script mount typo), and re-run from step 1.

## Suggested Fix

1. Run the script above end-to-end
2. Tee output to log file
3. On failure, diagnose + fix (likely candidates: PGDATA path mismatch, init-script line endings on Windows, image pull failures)
4. Once green, commit log

## Acceptance Criteria

- [ ] All 12 verification steps pass
- [ ] postgres container is `timescale/timescaledb-ha:pg17`
- [ ] 3 extensions loaded (timescaledb, vector, pg_stat_statements)
- [ ] migrations table top version = 142, dirty = false
- [ ] 7 hypertables registered
- [ ] 3 continuous aggregates registered
- [ ] Exactly 1 jsonb column in public schema
- [ ] `/healthz` returns ok
- [ ] Run log saved
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync\.github\prompts\db-refactor\logs
Get-ChildItem phase-8-03-fresh-deploy-*.log | Select-Object -Last 1 |
    ForEach-Object { Get-Content $_.FullName -Tail 30 }
```

## Out of Scope

- Don't deploy to staging or prod (Phase 10/11)
- Don't run helm install (chart is template-validated in prompt 02; live deploy is Phase 11 gitops)
- Don't seed test data — Phase 6 integration test is the data-shape gate

## Commit When Done

```powershell
cd D:\repos\teslasync
git add -f .github/prompts/db-refactor/logs/phase-8-03-fresh-deploy-*.log
git commit -m "infra(db-refactor): Phase 8 gate — fresh local stack converges on TS-HA pg17

12-step verification log captured. postgres on TS-HA, 3 extensions
loaded, migrations to 142 applied clean, 7 hypertables + 3 CAGGs
registered, zero-jsonb invariant holds (1 carve-out per ADR-001),
API healthy. Ready for Phase 9 acceptance gates.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-007, ADR-009
- Phase 4 prompt 03 (migration validation, narrower scope)
