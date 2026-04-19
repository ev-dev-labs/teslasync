---
description: "Extract automation engine from teslasync-api into a dedicated automation-worker service"
---

# Phase 2: Extract Automation Worker Service

## Overview

The automation engine was initially built inside `teslasync-api` as goroutines for
simplicity. This prompt extracts it into a dedicated `automation-worker` service,
following the same pattern as `notification-worker` and `export-worker`.

**This is a refactor — no logic changes.** Just moving where the code runs.

## Why Extract

- API restarts won't interrupt running automations
- Independent scaling (worker can run on a different machine)
- Consistent with existing worker architecture
- Cleaner separation: API = CRUD, Worker = runtime engine

## Current State (before extraction)

```
teslasync-api process:
  ├── HTTP handlers (automation CRUD, history, test-run, webhook receiver)
  ├── Cron scheduler goroutine
  ├── MQTT trigger listener goroutine
  ├── FSM transition watcher goroutine
  ├── Condition evaluator
  ├── Action executor (sends commands via Tesla client)
  └── Safety guards (rate limit, loop detection, retry)
```

## Target State (after extraction)

```
teslasync-api process:
  ├── HTTP handlers (automation CRUD, history, test-run)
  ├── Webhook receiver (POST /automations/webhook/{token})
  ├── SSE event feed (GET /automations/events)
  └── Publishes automation config changes to MQTT: teslasync/automations/reload

automation-worker process:
  ├── Cron scheduler
  ├── MQTT trigger listener
  ├── FSM transition watcher (subscribes to teslasync/fsm/transitions)
  ├── Geofence position watcher
  ├── Battery/energy level watcher
  ├── Sunrise/sunset calculator
  ├── Calendar poller
  ├── Condition evaluator
  ├── Action executor (sends commands via Tesla client)
  ├── Safety guards
  └── Subscribes to teslasync/automations/reload for config changes
```

## Step 1 — Create `cmd/automation-worker/main.go`

Follow the pattern of `cmd/notification-worker/main.go`:

```go
package main

import (
    "context"
    "os"
    "os/signal"
    "syscall"

    "github.com/rs/zerolog/log"
    "github.com/ev-dev-labs/teslasync/internal/config"
    "github.com/ev-dev-labs/teslasync/internal/database"
    "github.com/ev-dev-labs/teslasync/internal/mqtt"
    "github.com/ev-dev-labs/teslasync/internal/tesla"
    "github.com/ev-dev-labs/teslasync/internal/automation"
)

var version = "dev"

func main() {
    cfg := config.Load()
    setupLogging(cfg)

    log.Info().Str("version", version).Msg("automation-worker starting")

    // Connect to shared infrastructure
    db, err := database.New(cfg)
    // ... redis, mqtt, tesla client

    // Create automation engine
    engine := automation.NewEngine(db, mqttClient, teslaClient, cfg)

    // Start all trigger watchers
    engine.Start(ctx)

    // Listen for config reload signals via MQTT
    mqttClient.Subscribe("teslasync/automations/reload", func(payload []byte) {
        log.Info().Msg("reloading automation configs")
        engine.Reload(ctx)
    })

    // Health check endpoint
    go serveHealth(cfg.AutomationWorkerPort)  // :8083

    // Graceful shutdown
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
    <-sigCh
    log.Info().Msg("shutting down automation-worker")
    engine.Stop()
}
```

## Step 2 — Create `Dockerfile.automation`

Copy pattern from `Dockerfile.notification`:

```dockerfile
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w -X main.version=${VERSION}" -o /automation-worker ./cmd/automation-worker

FROM scratch
COPY --from=builder /automation-worker /automation-worker
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
ENTRYPOINT ["/automation-worker"]
```

## Step 3 — Add to `docker-compose.yml`

```yaml
automation-worker:
  build:
    context: .
    dockerfile: Dockerfile.automation
  container_name: teslasync-automation-worker
  restart: unless-stopped
  env_file: .env
  environment:
    - TESLASYNC_PORT=8083
  depends_on:
    postgres:
      condition: service_healthy
    mosquitto:
      condition: service_started
    redis:
      condition: service_healthy
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:8083/healthz"]
    interval: 30s
    timeout: 5s
    retries: 3
  deploy:
    resources:
      limits:
        memory: 256M
      reservations:
        memory: 64M
```

## Step 4 — Add Helm template

Create `helm/teslasync/templates/deployment-automation-worker.yaml` following the
pattern of `deployment-fleet-telemetry.yaml` — optional via `automationWorker.enabled`.

Add to `values.yaml`:
```yaml
automationWorker:
  enabled: true
  image:
    repository: teslasync-automation-worker
    tag: latest
  resources:
    limits:
      memory: 256Mi
    requests:
      memory: 64Mi
```

## Step 5 — Refactor `internal/automation/` package

The `internal/automation/` package should already be self-contained (engine, triggers,
conditions, actions, safety). The extraction involves:

1. **Move engine startup** from `cmd/teslasync/main.go` → `cmd/automation-worker/main.go`
2. **Keep handler registration** in `cmd/teslasync/main.go` (CRUD API stays in API server)
3. **Add MQTT reload channel**: when API creates/updates/deletes an automation, publish
   to `teslasync/automations/reload` so the worker reloads its config
4. **FSM transitions via MQTT**: the API server already publishes transitions to MQTT.
   The worker subscribes to `teslasync/fsm/transitions/#` for state-based triggers
5. **Webhook forwarding**: webhook HTTP receiver stays in API, but forwards the payload
   to MQTT topic `teslasync/automations/webhook/{token}` for the worker to process

## Step 6 — Config sync via MQTT

Add to API's automation CRUD handlers (after create/update/delete/toggle):

```go
// Notify worker to reload
mqttClient.Publish("teslasync/automations/reload", fmt.Sprintf(`{"action":"%s","id":%d}`, action, id))
```

Worker subscribes and calls `engine.Reload()` or `engine.UpdateAutomation(id)` for
incremental updates.

## Step 7 — Update `config.go`

Add `AUTOMATION_WORKER_PORT` env var (default 8083). Add to docker-compose.yml and
helm values.yaml following the Configuration Sync rules.

## Step 8 — Update environment variable documentation

Update `docker-compose.yml`, `helm/teslasync/values.yaml`, and `docs/` with the new
service and its configuration options.

## Verification

```bash
# All services build
go build ./cmd/teslasync/...
go build ./cmd/automation-worker/...
go build ./cmd/notification-worker/...
go build ./cmd/export-worker/...

# Docker builds
docker compose build automation-worker

# All services start
docker compose up -d
docker compose ps  # automation-worker should be healthy

# Automation CRUD still works via API
curl http://localhost:8080/api/v1/automations

# Worker logs show trigger watchers started
docker compose logs automation-worker | grep "started"

# Config reload works
curl -X POST http://localhost:8080/api/v1/automations -d '...'
docker compose logs automation-worker | grep "reloading"
```

## Migration Checklist

- [ ] `cmd/automation-worker/main.go` created
- [ ] `Dockerfile.automation` created
- [ ] `docker-compose.yml` updated with automation-worker service
- [ ] `helm/teslasync/templates/deployment-automation-worker.yaml` created
- [ ] `helm/teslasync/values.yaml` updated with automationWorker section
- [ ] Engine startup removed from `cmd/teslasync/main.go`
- [ ] MQTT reload channel wired in API CRUD handlers
- [ ] FSM transition MQTT subscription in worker
- [ ] Webhook forwarding via MQTT
- [ ] Config env var added to all 3 locations (config.go, docker-compose, helm)
- [ ] Health check endpoint on :8083
- [ ] All services build and start cleanly
