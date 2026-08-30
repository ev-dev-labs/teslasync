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

- Uses TeslaSync's pinned `ghcr.io/ev-dev-labs/teslasync-fleet-telemetry`
  image, which preserves the upstream `Payload.CreatedAt` timestamp in every
  MQTT field envelope
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

## Rollout controls (OPS-05)

Staged/canary rollout lives under `.Values.rollout.*` and is defined in
`ops/rollout/stages.yaml`. `go run ./cmd/ops-gate -check rollout` fails
if the manifest and the chart drift apart, and
`helm template … | go run ./cmd/ops-gate -verify-helm-render -` asserts
the post-template invariants.

```yaml
terminationGracePeriodSeconds: 90   # must hold the 80s shutdown budget
drain:
  port: 8090                        # isolated preStop listener; no Service targets it
rollout:
  paused: false                     # → Deployment.spec.paused
  selectorMode: legacy              # legacy | disjoint (canary requires disjoint)
  api:
    strategy: {type: RollingUpdate, maxSurge: 1, maxUnavailable: 0}
    canary:  {enabled: false, replicaCount: 1, image: {tag: ""}}
  web: { … same shape … }
  notificationWorker: {strategy: {type: ""}}   # "" = render nothing, K8s default applies
  exportWorker:       {strategy: {type: ""}}
  automationWorker:   {strategy: {type: ""}}
  highRiskFlags: []
```

```
❌ DO NOT change a rollout default — the defaults reproduce the
   pre-existing manifests exactly (no canary, not paused, api/web on
   RollingUpdate 1/0, workers with no strategy block at all).
❌ DO NOT enable canary without rollout.selectorMode=disjoint. A
   Deployment selector is a SUPERSET match, so a canary pod carrying the
   common selector labels is adopted by the stable Deployment — and by
   its HPA (which reads pod metrics through that selector) and its PDB.
   The chart refuses to render rather than producing that silently.
❌ DO NOT publish the drain port through a Service or Ingress. The
   preStop endpoint is one-way and pod-fatal; kubelet reaches it by
   dialling the pod IP, which needs no Service.
❌ DO NOT enable canary for a worker. Workers share one MQTT
   subscription; two revisions would double-deliver.
✅ DO use replica-share canary: the canary Deployment carries the same
   Service selector labels (minus the rollout discriminator), so 1
   canary alongside N stable replicas takes ~1/(N+1) of traffic.
✅ DO follow the documented one-time migration when switching an
   existing release from legacy to disjoint selectors —
   `spec.selector` is immutable, so it needs
   `kubectl delete deployment <release>-api --cascade=orphan` first.
   The steps are in values.yaml under `rollout.selectorMode`.
✅ DO keep terminationGracePeriodSeconds >= the budget in
   `ops/rollout/stages.yaml` `shutdown`. Kubernetes' 30s default cannot
   hold an 80s drain, and the kubelet SIGKILLs mid-drain if it is short.
```

## Configuration parity (OPS-06)

Adding, renaming, or removing an environment variable requires all three
targets in the same commit — `internal/config/config.go`,
`docker-compose.yml`, and `helm/teslasync/templates/`. This is enforced:

```bash
go run ./cmd/ops-gate -check config-parity
```

Credentials go in `templates/secret.yaml` **only**. A secret-classified
variable rendered into `templates/configmap.yaml` fails the gate
unconditionally — a ConfigMap is readable by anything with
`get configmaps` and appears in plaintext `helm get manifest` output.

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
