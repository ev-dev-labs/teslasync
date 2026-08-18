# Docker Compose deployment

Compose is the fastest path from "git clone" to a running TeslaSync. One file (`docker-compose.yml`) describes the full topology: the API, the workers, the data plane, the observability stack, and four optional profile sidecars. One command brings it up.

This is the right deployment when you're:

- **Trying TeslaSync for the first time.** Compose's startup-to-running time is under 5 minutes on a warm machine.
- **Running a small fleet on a single host.** A 2-vCPU / 4-GB VPS handles a few vehicles indefinitely.
- **Building or debugging locally.** Compose is the dev-loop topology — bring up the data plane in containers, run the API or web from source.

When you outgrow it — multiple replicas, separate observability stack, hardened secrets, ingress with rate limiting at the edge — graduate to [Kubernetes](/deployment/kubernetes). The Helm chart targets the same architecture; the migration is mostly mechanical.

## The 30-second walkthrough

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env
# edit .env: set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET, TESLA_REDIRECT_URI, TESLA_API_BASE_URL
docker compose up -d --build
docker compose ps
```

Then open `http://localhost:3000` and complete the Tesla OAuth flow.

The rest of this page is the longer story — what each service does, when to enable the profiles, how to operate the stack after first boot.

## What's in `docker-compose.yml`

The Compose file defines the core application and data services plus optional profile-gated sidecars.

### Always-on (10 services)

| Service                | Purpose                                          | Default port |
| ---------------------- | ------------------------------------------------ | -----------: |
| `teslasync-api`        | Go API, SSE hub, telemetry ingest, AI dispatch   | 8080         |
| `web`                  | Nginx + React SPA                                | 3000 → 80    |
| `notification-worker`  | Async notification fanout                        | 8081 health  |
| `export-worker`        | Async data export jobs                           | 8082 health  |
| `automation-worker`    | Automation scheduling + execution                | 8083 health  |
| `postgres`             | TimescaleDB + pgvector on PostgreSQL 17          | 5432         |
| `redis`                | L2 live cache + Pub/Sub                          | 6379         |
| `mosquitto`            | MQTT broker for telemetry routing                | 1883, 9001   |
| `grafana`              | Provisioned dashboards (admin/admin default)     | 3001         |
| `prometheus`           | Metrics scrape + retention                       | 9099         |

### Profile-gated services

Profiles let you opt into heavier sidecars only when you need them. Bring a profile up alongside the default stack:

```bash
docker compose --profile <name> up -d
```

| Profile     | Service                  | What it adds                                                     |
| ----------- | ------------------------ | ---------------------------------------------------------------- |
| `tracing`   | `otel-collector`, `tempo`, `jaeger` | OTLP ingest, TraceQL storage/span metrics, and Jaeger UI on `:16686` |
| `telemetry` | `fleet-telemetry`        | Tesla Fleet Telemetry server on `:4443`; HTTPS endpoint required |
| `commands`  | `vehicle-command-proxy`  | Signs commands for vehicles that require it; on `:4443`          |
| `ai`        | `ollama`                 | Local LLM inference for Helix AI on `:11434`                     |

You can stack profiles: `docker compose --profile telemetry --profile commands --profile ai up -d`.

The tracing dashboards also require the application processes to emit spans. Set
`OTEL_ENABLED=true` in `.env` before starting the profile, then run:

```bash
docker compose --profile tracing up -d --build
```

Changing `OTEL_ENABLED` causes Compose to recreate the API and workers with
tracing enabled. Starting the profile without that setting only starts the
backends; it cannot create application traces or span-derived metrics.

## When to use which profile

| Situation                                                          | Profile to add |
| ------------------------------------------------------------------ | -------------- |
| You want low-latency live data instead of polling                  | `telemetry`    |
| You own a Model 3/Y from 2021+, Model S/X refresh, or Cybertruck   | `commands`     |
| You want to run Helix without sending data to a cloud provider     | `ai`           |
| You're debugging request paths or latency                          | `tracing`      |
| You're running on a single laptop just to try it out               | None of the above — the default stack is enough |

Each profile has runtime cost. `fleet-telemetry` and `vehicle-command-proxy` need open ports and certificate config. `ollama` wants a GPU (CPU works but is slow). `jaeger` adds a bit of memory pressure. Only opt in to what you use.

## First-boot sequence

When you run `docker compose up -d --build`, this is what happens in order:

1. **Image pulls** — the base images (`timescale/timescaledb-ha:pg17`, `redis:7`, `eclipse-mosquitto:2`, `grafana/grafana:11`, `prom/prometheus:v2.55`) pull if not cached.
2. **Local builds** — `teslasync-api` and `web` build from the Dockerfiles in the repo. First build is a few minutes; subsequent builds are near-instant thanks to layer caching.
3. **Data services start** — postgres, redis, mosquitto come up. Compose's health checks gate dependent services.
4. **Migrations run** — `teslasync-api` waits for postgres, then runs all 197 numbered migrations in order. Watch for `migrations applied` in the log.
5. **Workers attach** — the three worker binaries come up, register with the scheduler, and start draining their queues.
6. **Web serves** — Nginx in the `web` container starts serving the React bundle and proxying `/api/*` to `teslasync-api:8080` over the Compose network.

If anything fails to come up, `docker compose ps` shows the per-service status and `docker compose logs <service>` shows the cause.

## Day-to-day operations

### Health checks

```bash
docker compose ps
curl http://localhost:8080/healthz   # liveness
curl http://localhost:8080/readyz    # readiness (deps reachable, schema current)
curl http://localhost:3000           # web UI bundle
```

### Logs

```bash
docker compose logs -f teslasync-api
docker compose logs -f web
docker compose logs -f postgres
docker compose logs -f mosquitto
docker compose logs -f notification-worker
docker compose logs -f export-worker
docker compose logs -f automation-worker
docker compose logs -f ollama                # only when --profile ai is up
docker compose logs -f fleet-telemetry       # only when --profile telemetry is up
```

Add `--tail=200` for a recent slice instead of full history. Filter with `| grep -i error` for the obvious triage.

### Restart a single service after a config change

```bash
docker compose up -d --no-deps teslasync-api
```

`--no-deps` avoids restarting the data services unnecessarily. Use this after a `.env` change.

### Rebuild after a code change

```bash
docker compose up -d --build teslasync-api web
```

### Stop without losing data

```bash
docker compose down                  # keeps volumes
```

### Stop and wipe everything

```bash
docker compose down -v               # deletes data volumes (DESTRUCTIVE)
```

Use `down -v` only when you intentionally want to start fresh — wiping the data volumes deletes telemetry, drives, charging history, alerts, automations, and Helix state.

## Volumes and persistence

Compose creates named volumes for the data services. Inspect them:

```bash
docker volume ls | grep teslasync
```

Back them up via filesystem snapshot (`docker run --rm -v <volume>:/data -v $PWD:/backup ubuntu tar czf /backup/<name>.tar.gz /data`) or by stopping the container and copying the underlying directory. Better still, use the in-app backup feature in **Settings → Backup & Restore** for user-facing data and `pg_dump` / TimescaleDB tooling for the database.

Full recovery procedure: [Backup & Restore](/features/backup-restore).

## Configuration

All runtime configuration lives in `.env`. The full reference is [Configuration](/guide/configuration) — every variable, every default, every implication.

The minimum to set on first run:

```dotenv
TESLA_CLIENT_ID=…
TESLA_CLIENT_SECRET=…
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback
TESLA_API_BASE_URL=https://fleet-api.prd.na.vn.cloud.tesla.com
```

Everything else has a sensible default. Notable variables to consider before going beyond localhost:

| Variable                     | When to set                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `FORWARD_AUTH_HEADER`        | When you put TeslaSync behind Authentik / Authelia / oauth2-proxy  |
| `ENCRYPTION_KEY`             | Always, for production — encrypts Tesla tokens at rest             |
| `TESLA_COMMAND_PROXY_URL`    | When you have signed-command-required vehicles                      |
| `OLLAMA_HOST` / `OPENAI_API_KEY` / `AZURE_OPENAI_*` / `ANTHROPIC_API_KEY` | When you enable Helix       |
| `AI_DAILY_BUDGET_USD`        | When you use a cloud Helix provider                                |
| `CORS_ORIGINS`               | When the browser and API live on different origins                 |

## Networking

By default everything talks over the Compose-managed bridge network. Only the documented ports are exposed to the host:

| Host port      | Container                            |
| -------------- | ------------------------------------ |
| 3000           | `web` (HTTP)                         |
| 8080           | `teslasync-api`                      |
| 3001           | `grafana`                            |
| 9099           | `prometheus`                         |
| 1883, 9001     | `mosquitto`                          |
| 16686          | `jaeger` (only with `--profile tracing`) |
| 11434          | `ollama` (only with `--profile ai`)  |

For production you typically front this with a reverse proxy (Nginx / Caddy / Traefik) on the host or in a separate container, terminate TLS there, and let it route `/.well-known` without auth while requiring auth for everything else.

## Resource sizing

Rough guidance for a single-host Compose deployment. Real usage depends on fleet size, telemetry rate, and Helix usage.

| Vehicles | Recommended host                                | Notes                                                          |
| -------: | ----------------------------------------------- | -------------------------------------------------------------- |
| 1–3      | 2 vCPU, 4 GB RAM, 40 GB disk                    | Comfortable; small VPS works fine                              |
| 4–10     | 4 vCPU, 8 GB RAM, 100 GB disk                   | Add SSD for snappy chart loads                                 |
| 10–25    | 8 vCPU, 16 GB RAM, 250 GB disk                  | Consider separate Postgres host                                |
| 25+      | Graduate to [Kubernetes](/deployment/kubernetes) and dedicated data services | Compose is feasible but operationally cramped at this point |

Helix with Ollama adds GPU pressure or a lot of CPU. A small Ollama model (8 B) fits in 8 GB system RAM but inference is slow without a GPU.

## Upgrading

```bash
cd teslasync
git pull
docker compose pull                  # for any non-local image updates
docker compose up -d --build         # rebuilds API and web from the new source
```

Migrations run automatically on the next API start. The platform never drops data on upgrade unless you explicitly run a destructive migration; a clean upgrade is non-destructive by design.

If a release introduces a new env var, the upgrade picks up the default safely. The release notes call out any required configuration changes.

## When something goes wrong

[Troubleshooting](/guide/troubleshooting) has the symptom-driven playbook. The single most useful command is:

```bash
docker compose logs --tail=200 teslasync-api | grep -i error
```

The structured logs surface the wrapped error chain and the request ID, which is enough context for almost every triage.

## Related

- [Kubernetes deployment](/deployment/kubernetes) — for when one host isn't enough
- [Configuration](/guide/configuration) — every env var, every default
- [Backup & Restore](/features/backup-restore) — recovery procedures and drills
- [Helix AI](/guide/helix-ai) — the AI layer, off-by-default
- [Troubleshooting](/guide/troubleshooting) — when the stack misbehaves
