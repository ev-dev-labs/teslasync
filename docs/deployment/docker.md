# Docker Deployment

Docker Compose is the fastest way to run TeslaSync on one host.

## Default services

`docker compose up -d --build` starts the core app, data stores, and observability services:

| Service | Purpose | Default port |
|---|---|---:|
| `teslasync-api` | Go API and main workers | 8080 |
| `web` | Nginx + React SPA | 3000 -> 80 |
| `notification-worker` | Async notification delivery | 8081 health |
| `export-worker` | Data export jobs | 8082 health |
| `automation-worker` | Automation execution | 8083 health |
| `postgres` | TimescaleDB/PostgreSQL 17 | 5432 |
| `redis` | Live cache | 6379 |
| `mosquitto` | MQTT broker | 1883, 9001 |
| `grafana` | Dashboards | 3001 |
| `prometheus` | Metrics scraping | 9099 |

## Optional profile services

| Service | Profile | Purpose | Default port |
|---|---|---|---:|
| `jaeger` | `tracing` | OpenTelemetry trace UI/collector | 16686 |
| `fleet-telemetry` | `telemetry` | Tesla Fleet Telemetry server | 4443 |
| `vehicle-command-proxy` | `commands` | Tesla signed command proxy | 4443 |

## Start

```bash
cp .env.example .env
# edit Tesla credentials and URLs
docker compose up -d --build
```

## Optional profiles

```bash
# Distributed tracing UI
docker compose --profile tracing up -d

# Tesla Fleet Telemetry server
docker compose --profile telemetry up -d

# Tesla signed command proxy
docker compose --profile commands up -d
```

## Health checks

```bash
docker compose ps
curl http://localhost:8080/healthz
curl http://localhost:8080/readyz
curl http://localhost:3000
```

## TimescaleDB image note

The Compose database image is `timescale/timescaledb-ha:pg17`. If upgrading an older deployment that used a plain PostgreSQL image, test restore/upgrade in staging. The comments in `docker-compose.yml` call out when a clean volume is required.

## Logs

```bash
docker compose logs -f teslasync-api
docker compose logs -f web
docker compose logs -f postgres
docker compose logs -f mosquitto
```

## Stop

```bash
docker compose down      # keep volumes
docker compose down -v   # delete data volumes
```

Use `down -v` only when you intentionally want to remove database and service data.
