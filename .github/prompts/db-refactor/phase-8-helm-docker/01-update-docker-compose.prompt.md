---
description: "Phase 8 — Switch docker-compose postgres to timescale/timescaledb-ha:pg17 + init script"
---

# 🔵 Helm-Docker 01 — docker-compose Cutover

> **Severity:** Architectural | **Priority:** Critical | **Prompt #:** 1 of 3

## Artifact Metadata

| Field | Value |
|-------|-------|
| Affected files | `docker-compose.yml`, `docker-compose.dev.yml`, `scripts/init-timescaledb.sql` (new) |
| Depends on | Phase 4 complete (migration 142 exists) |
| Blocks | `02-update-helm-chart`, `03-validate-fresh-deploy` |
| ADR refs | ADR-007 |

## Single Goal

Replace the current postgres image with `timescale/timescaledb-ha:pg17` in both compose files, fix `PGDATA` to TS-HA's path (`/home/postgres/pgdata/data`), mount a one-shot init script that runs `CREATE EXTENSION IF NOT EXISTS timescaledb; CREATE EXTENSION IF NOT EXISTS vector; CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` on first boot.

## What's Being Established

ADR-007: TS-HA bundles all extensions we need (timescaledb, pgvector). Switching the image means a one-time `docker volume rm` is required for existing local environments — call this out loudly.

## Recommendation

### `scripts/init-timescaledb.sql` (new)

```sql
-- Runs once on fresh PGDATA via /docker-entrypoint-initdb.d/
-- Idempotent — IF NOT EXISTS guards everything.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Optional but recommended for migration 142 idempotency:
ALTER DATABASE teslasync SET timescaledb.telemetry_level = 'off';
```

### `docker-compose.yml` postgres service diff

```yaml
  postgres:
-   image: postgres:17-alpine
+   image: timescale/timescaledb-ha:pg17
    container_name: teslasync-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-teslasync}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-changeme}
      POSTGRES_DB: ${POSTGRES_DB:-teslasync}
-     PGDATA: /var/lib/postgresql/data/pgdata
+     PGDATA: /home/postgres/pgdata/data
    volumes:
-     - postgres_data:/var/lib/postgresql/data
+     - postgres_data:/home/postgres/pgdata
+     - ./scripts/init-timescaledb.sql:/docker-entrypoint-initdb.d/00-init-timescaledb.sql:ro
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-teslasync}"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 512M
```

Apply the same diff to `docker-compose.dev.yml`.

### Top-of-file warning comment

```yaml
# ⚠️  TimescaleDB-HA migration (ADR-007):
#   This compose file was migrated to timescale/timescaledb-ha:pg17 in commit <hash>.
#   If upgrading from a postgres:17-alpine deployment, you MUST wipe the volume:
#       docker compose down
#       docker volume rm teslasync_postgres_data
#       docker compose up -d
#   Existing data is replaced; staging losses accepted per ADR-009.
```

## Suggested Fix

1. Create `scripts/init-timescaledb.sql`
2. Edit both compose files (image, PGDATA, volume mount path, init script mount)
3. Add the warning comment to both files
4. Run validation (prompt 03 will repeat exhaustively — here just verify lint)
5. Commit

## Acceptance Criteria

- [ ] `scripts/init-timescaledb.sql` exists with 3 `CREATE EXTENSION IF NOT EXISTS`
- [ ] Both `docker-compose.yml` and `docker-compose.dev.yml` use `timescale/timescaledb-ha:pg17`
- [ ] PGDATA points to `/home/postgres/pgdata/data` in both
- [ ] Init script mounted to `/docker-entrypoint-initdb.d/00-init-timescaledb.sql:ro` in both
- [ ] Warning comment present in both
- [ ] `docker compose config` (lint) exits 0 for both files
- [ ] Committed

## Verification

```powershell
cd D:\repos\teslasync

# Lint both compose files
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.dev.yml config --quiet

# Verify image string
Select-String -Path docker-compose.yml,docker-compose.dev.yml -Pattern "timescale/timescaledb-ha:pg17"
# Expected: 2 hits (one per file)

# Verify init script exists
Test-Path scripts\init-timescaledb.sql
# Expected: True
```

## Out of Scope

- Don't run `docker compose up` here (prompt 03)
- Don't update Helm (prompt 02)
- Don't change other services (web, redis, mosquitto, grafana untouched)

## Commit When Done

```powershell
cd D:\repos\teslasync
git add docker-compose.yml docker-compose.dev.yml scripts/init-timescaledb.sql
git commit -m "infra(db-refactor): switch docker-compose postgres to timescale/timescaledb-ha:pg17

ADR-007: TS-HA bundles timescaledb + pgvector + pg_stat_statements.
PGDATA path updated to /home/postgres/pgdata/data. Init script
ensures extensions exist on fresh volume. Existing volumes must be
wiped (loud warning comment added; ADR-009 accepts staging loss).

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Reference

- ADR-007, ADR-009
- TS-HA image docs: https://hub.docker.com/r/timescale/timescaledb-ha
