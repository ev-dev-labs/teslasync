---
applyTo: "helm/**,docker-compose.yml,Dockerfile*,*.Dockerfile,.env*,mosquitto.conf,fleet-telemetry-config.json"
---

# Infrastructure & Deployment Instructions

## Docker Compose Architecture

The project runs 8 services (+ 1 optional) via Docker Compose:

```yaml
services:
  teslasync:            # Go API server (:8080) — main backend
  web:                  # React SPA via Nginx (:80 → host :3000)
  notification-worker:  # Async MQTT notification processor (:8081)
  export-worker:        # Data export job processor (:8082)
  postgres:             # PostgreSQL 17 Alpine (:5432)
  redis:                # Redis 7 Alpine (:6379) — append-only, 128MB max
  mosquitto:            # Eclipse Mosquitto 2 MQTT (:1883, :9001 websocket)
  grafana:              # Grafana 10.4 (:3000 → host :3001)
  fleet-telemetry:      # (optional profile: telemetry) Tesla Fleet Telemetry server (:4443)
```

### Service Dependencies
- `teslasync` depends on: postgres (healthy), mosquitto (started), redis (healthy)
- `web` depends on: teslasync (healthy)
- `notification-worker` depends on: postgres (healthy), mosquitto (started)
- `export-worker` depends on: postgres (healthy), mosquitto (started)
- `grafana` depends on: postgres (healthy)
- `fleet-telemetry` depends on: teslasync (healthy)

### Health Checks
Every service has a health check:
- Go services: `wget -qO- http://localhost:{port}/healthz`
- PostgreSQL: `pg_isready -U teslasync`
- Redis: `redis-cli ping`
- Mosquitto: `mosquitto_sub -t '$$SYS/#' -C 1 -i healthcheck -W 3`

### Resource Limits
All services have memory limits and reservations defined in `deploy.resources`.

## Dockerfiles

| File | Purpose | Base |
|------|---------|------|
| `Dockerfile` | Main Go API server | golang → scratch (multi-stage, CGO_ENABLED=0) |
| `Dockerfile.web` | React SPA build + Nginx serve | node → nginx:alpine |
| `Dockerfile.notification` | Notification worker binary | golang → scratch |
| `Dockerfile.export-worker` | Export worker binary | golang → scratch |

Build args: `VERSION` (git tag/commit)
LDFLAGS: `-s -w -X main.version=... -X main.commit=... -X main.buildTime=...`

## Environment Variables

All configuration via `.env` file (see `.env.example`):

```bash
# Required
TESLA_CLIENT_ID=          # Tesla Developer API client ID
TESLA_CLIENT_SECRET=      # Tesla Developer API client secret
TESLA_REDIRECT_URI=http://localhost:8080/api/v1/auth/callback
TESLA_API_BASE_URL=https://fleet-api.prd.na.vn.cloud.tesla.com

# Database
POSTGRES_USER=teslasync
POSTGRES_PASSWORD=changeme
POSTGRES_DB=teslasync

# Application
TESLASYNC_PORT=8080
WEB_PORT=3000
POLL_INTERVAL=30s
LOG_LEVEL=info

# Optional: Fleet Telemetry
FLEET_TELEMETRY_ENABLED=false
FLEET_TELEMETRY_PORT=4443
FLEET_TELEMETRY_HOST=
# FLEET_TELEMETRY_TLS_CERT=./certs/server.crt
# FLEET_TELEMETRY_TLS_KEY=./certs/server.key
```

## Fleet Telemetry (Optional Profile)

Enable with: `docker compose --profile telemetry up -d`

- Uses official `tesla/fleet-telemetry:latest` image
- Config mounted from `fleet-telemetry-config.json`
- TLS cert/key mounted from paths in `.env`
- Dispatches vehicle data to `http://teslasync:8080/api/v1/telemetry`

### fleet-telemetry-config.json
```json
{
  "host": "0.0.0.0",
  "port": 4443,
  "tls": {
    "server_cert": "/certs/server.crt",
    "server_key": "/certs/server.key"
  },
  "records": {
    "V": {
      "dispatcher": {
        "type": "http",
        "url": "http://teslasync-api:8080/api/v1/telemetry"
      }
    }
  }
}
```

## Helm Chart

Located in `helm/teslasync/`:

```
helm/teslasync/
  Chart.yaml
  values.yaml           # All configurable values
  templates/
    deployment.yaml     # Main TeslaSync deployment
    deployment-fleet-telemetry.yaml  # Optional Fleet Telemetry
    service.yaml
    configmap.yaml
    configmap-nginx.yaml
    ingress.yaml
    NOTES.txt
    _helpers.tpl
```

### Key Helm Values
- `fleetTelemetry.enabled` — Toggle Fleet Telemetry sidecar
- `fleetTelemetry.image` — Docker image for fleet-telemetry
- `fleetTelemetry.tls.secretName` — Kubernetes TLS secret
- `externalPostgresql.*` — External DB connection (for managed databases)
- `externalRedis.*` — External Redis connection

### Install/Upgrade
```bash
helm upgrade --install teslasync helm/teslasync
```

## Volumes

Persistent volumes:
- `postgres_data` — PostgreSQL data directory
- `grafana_data` — Grafana dashboards and state
- `mosquitto_data` — MQTT message persistence
- `redis_data` — Redis AOF persistence

## Nginx Configuration

The web container serves static files and reverse-proxies API traffic:
- `/api/*` → `teslasync:8080`
- `/.well-known/*` → `teslasync:8080` (Tesla public key)
- `/healthz`, `/readyz`, `/metrics` → `teslasync:8080`
- Everything else → `index.html` (SPA fallback)
