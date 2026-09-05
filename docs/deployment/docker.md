# Docker Compose deployment

Compose is the container installation path. `docker-compose.yml` describes the
application, data services, and optional profiles. Start with
[Getting Started](/guide/getting-started) for the complete installation-to-vehicle journey.

This is the right deployment when you're:

- **Trying TeslaSync for the first time.** Build time depends on your host and network.
- **Running on a single host.** Size resources for your vehicles, signal frequency, retention, and enabled services; monitor growth.
- **Building or debugging locally.** Compose is the dev-loop topology — bring up the data plane in containers, run the API or web from source.

When you outgrow it — multiple replicas, separate observability stack, hardened secrets, ingress with rate limiting at the edge — graduate to [Kubernetes](/deployment/kubernetes). The Helm chart targets the same architecture; the migration is mostly mechanical.

## Installation walkthrough

```bash
git clone https://github.com/ev-dev-labs/teslasync.git
cd teslasync
cp .env.example .env
# edit .env: set TESLA_CLIENT_ID, TESLA_CLIENT_SECRET, TESLA_REDIRECT_URI, TESLA_API_BASE_URL
docker compose up -d --build
docker compose ps
```

On PowerShell use `Copy-Item .env.example .env`. Open `http://localhost:3000`
(or `WEB_PORT`) and use **Settings → Fleet Setup** (`/settings/fleet-setup`).
Configure encryption with the override below **before** authorizing Tesla.

The rest of this page is the longer story — what each service does, when to enable the profiles, how to operate the stack after first boot.

## What's in `docker-compose.yml`

The Compose file defines the core application and data services plus optional profile-gated sidecars.

### Core services

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
| `profiling` | `pyroscope`              | Continuous profiling backend |
| `chaos`     | `toxiproxy`              | Fault injection for development; not needed for onboarding |
| `ocpp`      | `ocpp-server`            | Optional charger integration |

You can stack profiles: `docker compose --profile telemetry --profile commands up -d`.
The current Compose file does not define an `ai` profile or Ollama service;
configure an independently deployed provider using the [Helix guide](/guide/helix-ai).
The command proxy listens on HTTPS port `4443` **inside** the Compose network,
not a published host port. Telemetry publishes its receiver port separately.

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
| You want local Helix inference                                    | Deploy Ollama separately; no bundled `ai` profile |
| You're debugging request paths or latency                          | `tracing`      |
| You're running on a single laptop just to try it out               | None of the above — the default stack is enough |

Each profile has runtime cost. Fleet Telemetry needs a public receiver and TLS;
the command proxy needs signing and TLS configuration but should remain private.
Starting profiles does not register the application or subscribe a vehicle.

## First-boot sequence

When you run `docker compose up -d --build`, this is what happens in order:

1. **Image pulls** — the base images (`timescale/timescaledb-ha:pg17`, `redis:7`, `eclipse-mosquitto:2`, `grafana/grafana:11`, `prom/prometheus:v2.55`) pull if not cached.
2. **Local builds** — `teslasync-api` and `web` build from the Dockerfiles in the repo. First build is a few minutes; subsequent builds are near-instant thanks to layer caching.
3. **Data services start** — postgres, redis, mosquitto come up. Compose's health checks gate dependent services.
4. **Migrations run** — the API applies pending migrations for this version. Inspect startup logs for failures and back up before upgrading.
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

Use PostgreSQL/TimescaleDB-supported backup tooling or a coordinated, consistent
snapshot. Copying a live database volume with `tar` is not a reliable backup.
Back up application configuration and encryption/signing keys securely as well.
Test restoration into an isolated environment before relying on the backup.

Full recovery procedure: [Backup & Restore](/features/backup-restore).

## Configuration

Runtime variables must reach the appropriate service environment.
See [Configuration](/guide/configuration) and the override below; `.env` alone
does not forward undeclared variables.

The minimum to set on first run:

```dotenv
TESLA_CLIENT_ID=…
TESLA_CLIENT_SECRET=…
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback
TESLA_API_BASE_URL=https://fleet-api.prd.na.vn.cloud.tesla.com
```

Review defaults before going beyond a firewalled trial:

| Variable                     | When to set                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `FORWARD_AUTH_HEADER`        | When you put TeslaSync behind Authentik / Authelia / oauth2-proxy  |
| `ENCRYPTION_KEY`             | Always, for production — encrypts Tesla tokens at rest             |
| `TESLA_COMMAND_PROXY_URL`    | When you have signed-command-required vehicles                      |
| `OLLAMA_HOST` / `OPENAI_API_KEY` / `AZURE_OPENAI_*` / `ANTHROPIC_API_KEY` | When you enable Helix       |
| `AI_DAILY_BUDGET_USD`        | When you use a cloud Helix provider                                |
| `CORS_ORIGINS`               | When the browser and API live on different origins                 |

## Required environment overrides

The base Compose file currently omits API environment mappings for token
encryption, production mode, and the command proxy. Create
`docker-compose.override.yml` beside it (merge into an existing override rather
than replacing it):

```yaml
services:
  teslasync-api:
    environment:
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:?Set ENCRYPTION_KEY in .env}
      APP_ENV: ${APP_ENV:-production}
      TESLA_COMMAND_PROXY_URL: ${TESLA_COMMAND_PROXY_URL:-}
```

Generate an encryption key with `openssl rand -base64 32`, save it in `.env`,
and keep a secure backup. For signed telemetry configuration or commands, set
`TESLA_COMMAND_PROXY_URL=https://vehicle-command-proxy:4443`.
Provision the files expected under `COMMAND_PROXY_DATA_DIR` (default
`./data/vehicle-command`): `tls-cert.pem`, `tls-key.pem`, and `private-key.pem`.
Use the same application signing key that was registered and paired with Tesla.
The TLS certificate must be trusted by the API and valid for the proxy hostname.

Validate interpolation without printing the resolved secrets:

```bash
docker compose config --quiet
docker compose config --services
docker compose config --profiles
docker compose up -d --build
```

Compose automatically merges the override. Recreate affected services after
configuration changes; a plain restart does not apply new environment values.
Do not paste `.env`, private keys, or full resolved Compose output into issues.

## Before public exposure

- Authenticate through a trusted proxy and set `FORWARD_AUTH_HEADER` to the
  identity header it **overwrites** after authentication.
- Block direct access to the API, databases, MQTT, and management dashboards.
  A forged identity header must not bypass the proxy.
- Configure HTTPS for the web application and exact OAuth callback; route the
  public-key URL anonymously. Keep the telemetry receiver's mTLS termination separate.
- Replace default database/dashboard credentials and enable token encryption
  in the actual container environment, not only `.env`.
- Back up the database, configuration, and encryption/signing keys; test restoration.
- Check Tesla and provider billing, retention, disk alerts, and certificate renewal.

## Networking

Services communicate over the Compose bridge network. Published ports can bind
on all host interfaces; a localhost URL does not imply localhost-only access.
The following are common ports, not an exhaustive firewall inventory; inspect
the `ports` mappings in your checkout and enabled profiles:

| Host port      | Container                            |
| -------------- | ------------------------------------ |
| 3000           | `web` (HTTP)                         |
| 8080           | `teslasync-api`                      |
| 3001           | `grafana`                            |
| 9099           | `prometheus`                         |
| 1883, 9001     | `mosquitto`                          |
| 16686          | `jaeger` (only with `--profile tracing`) |
| 4443           | `fleet-telemetry` (default with `--profile telemetry`) |

For production you typically front this with a reverse proxy (Nginx / Caddy / Traefik) on the host or in a separate container, terminate TLS there, and let it route `/.well-known` without auth while requiring auth for everything else.

## Resource sizing

Measure your own workload before committing to a host size. Signal frequency,
vehicle activity, retention, database indexes, and observability services affect
resource use. Reserve disk headroom for migrations and backups. Local AI models
have separate memory and compute requirements; follow the selected model's guidance.

## Upgrading

```bash
cd teslasync
git pull
docker compose pull                  # for any non-local image updates
docker compose up -d --build         # rebuilds API and web from the new source
```

Before these commands, select the intended release/commit, review its migration
and configuration changes, and take a tested backup. Migrations run automatically
on API startup and may be irreversible or destructive. Do not assume checking
out an older commit rolls the database back. The Compose file includes a historical
database-image transition warning: never follow volume deletion instructions on
valuable data without a deliberate migration and recovery plan.

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
