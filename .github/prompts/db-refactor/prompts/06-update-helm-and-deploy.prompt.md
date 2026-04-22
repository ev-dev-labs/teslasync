# 06 — Update Helm and Local Docker for TimescaleDB-HA

**Phase:** 5
**Branch:** `db-refactor/timescaledb-migration-mo-jsonb-at-all` (Helm changes here);
            actual prod cutover happens via `-k3s-gitops` in Phase 7
**Pre-req:** Prompts 02-05 complete; local stack runs against TimescaleDB
**Estimated effort:** 1 day

---

## Goal

Update local `docker-compose.yml` and `helm/teslasync/` so a fresh deploy uses `timescale/timescaledb-ha:pg17` with the extensions enabled, the correct PGDATA path, and an init script that creates extensions on first boot.

## Background

ADR-007 was validated locally on 2026-04-21. That validation produced the exact configuration changes; this prompt formalizes them.

Key learnings from local validation:
- TS-HA image PGDATA is `/home/postgres/pgdata/data` (NOT vanilla PG `/var/lib/postgresql/data`)
- Extensions: `timescaledb`, `vector`, `pg_stat_statements` are pre-installed in the image but must be `CREATE EXTENSION ...`'d at first boot
- `pg_restore --disable-triggers` does NOT work on compressed hypertables; use `--single-transaction` for restores
- Image is ~1.2GB (vs ~250MB alpine); plan node disk accordingly

## Files to change

### `docker-compose.yml` (and `docker-compose.dev.yml`)

```yaml
postgres:
  image: timescale/timescaledb-ha:pg17  # was postgres:17-alpine
  environment:
    POSTGRES_DB: teslasync
    POSTGRES_USER: teslasync
    POSTGRES_PASSWORD: teslasync
    PGDATA: /home/postgres/pgdata/data   # NEW — TS-HA path
  volumes:
    - postgres_data:/home/postgres/pgdata    # NEW — TS-HA path
    - ./scripts/init-timescaledb.sql:/docker-entrypoint-initdb.d/01-extensions.sql:ro
  # rest unchanged: ports, healthcheck, deploy.resources
```

### New file: `scripts/init-timescaledb.sql`

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### `helm/teslasync/values.yaml`

Add a TimescaleDB section:
```yaml
postgresql:
  image:
    repository: timescale/timescaledb-ha
    tag: pg17.4-ts2.17.2  # pin specific patch (NOT latest)
  extensions:
    - timescaledb
    - vector
    - pg_stat_statements
  pgdata: /home/postgres/pgdata/data
  volumeSubPath: pgdata
```

### `helm/teslasync/templates/postgres-deployment.yaml` (or whatever the existing PG deployment is named)

- Update `image:` to use the templated values
- Update `env: PGDATA`
- Update `volumeMounts.subPath`
- Add an `initContainer` OR a `postStart` lifecycle hook that runs `init-timescaledb.sql` against `localhost` after PG is up:
  ```yaml
  lifecycle:
    postStart:
      exec:
        command:
          - /bin/sh
          - -c
          - |
            until pg_isready -U teslasync; do sleep 1; done
            psql -U teslasync -d teslasync -f /docker-entrypoint-initdb.d/01-extensions.sql
  ```
  (Cleaner alternative: use a Job/InitContainer pattern; pick whichever matches the existing chart conventions)

### `helm/teslasync/templates/configmap.yaml`

Add `init-timescaledb.sql` as a ConfigMap entry mounted into the postgres pod.

### `helm/teslasync/templates/secret.yaml`

No changes — credentials stay the same.

### `Dockerfile` (main API image)

No changes. The Go code's connection to PG is unchanged (still `postgres://...` with pgx).

## Validation locally

```powershell
docker compose down
docker volume rm teslasync_postgres_data
docker compose up -d postgres

# Wait for healthy
docker compose ps postgres

# Verify extensions
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "\dx"
# Expected: timescaledb, vector, pg_stat_statements

# Apply migrations
$env:MIGRATE_ONLY = "true"
.\teslasync.exe
Remove-Item env:MIGRATE_ONLY

# Verify hypertables
docker exec teslasync-postgres psql -U teslasync -d teslasync -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"
# Expected: positions, charging_telemetry, climate_snapshots, motor_snapshots,
#           security_events, vehicle_meta_snapshots, signal_observations,
#           tesla_api_events (if introduced), signal_catalog (NOT a hypertable, just a regular table)

# Bring up app + workers
docker compose up -d
docker compose ps
# All healthy
```

## Validation via Helm template

```powershell
# Render the chart and grep for the new image and PGDATA
helm template teslasync helm\teslasync | Select-String -Pattern "timescaledb-ha|/home/postgres/pgdata|CREATE EXTENSION"
```

Expected: image reference, PGDATA env var, init script ConfigMap content all present.

## Production cutover (Phase 7 — separate repo, separate work)

The prod cutover does NOT happen on this branch. It happens via the prompts in `D:\repos\-k3s-gitops\.github\prompts\teslasync-ts-cutover\` (already written) which:
1. Scale teslasync to zero
2. Run migrations against prod TimescaleDB
3. pg_dump from old PG → pg_restore into TimescaleDB
4. Switch Helm values to point to TimescaleDB
5. Scale teslasync back up
6. Smoke test
7. Decommission old PG

That work runs **after** Phase 6 (staging soak) signs off.

## Exit gate

- [ ] `docker-compose.yml` updated (image, PGDATA, volume path, init script)
- [ ] `scripts/init-timescaledb.sql` exists
- [ ] `helm/teslasync/values.yaml` has the TimescaleDB section
- [ ] `helm/teslasync/templates/` updated for TS image, PGDATA, init mechanism
- [ ] `docker compose up` produces a working stack against TS-HA from a clean volume
- [ ] All 7 hypertables visible via `timescaledb_information.hypertables`
- [ ] `helm template` renders without errors
- [ ] `helm lint` clean
