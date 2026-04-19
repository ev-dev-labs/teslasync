---
description: "REST Webhooks: outbound event notifications to external systems via HTTP POST"
---

# REST Webhooks — Outbound Event Notifications

## Problem

External systems (Node-RED, Zapier, Apple Shortcuts, custom scripts) can call the
TeslaSync API using the existing API Key auth, but have no way to **receive events**
without polling. Users want push notifications when:
- Charge completes
- Drive ends
- Alert triggers
- Vehicle state changes (lock/unlock, sleep/wake)
- Automation runs

The existing notification system (Discord, Slack, etc.) handles this for chat platforms,
but there's no generic HTTP webhook for arbitrary integrations.

## Current State

```
internal/api/apikey_middleware.go    — API Key auth already exists ✅
internal/api/apikey_handler.go      — CRUD for API keys (create, list, delete, revoke) ✅
internal/notification/              — 7-channel dispatcher (could add webhook as 8th) ✅
internal/events/                    — Domain event bus backed by MQTT ✅
```

API keys already support permissions — webhooks can be scoped to specific event types.

## Task

### Step 1: Webhook Registration Model

Create the database schema for webhook subscriptions.

**Migration: `000XXX_add_webhooks.up.sql`** (use the next available migration number):

```sql
CREATE TABLE IF NOT EXISTS webhooks (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    url             TEXT NOT NULL,                      -- target URL (HTTPS required in production)
    secret          TEXT NOT NULL DEFAULT '',            -- HMAC signing secret
    events          TEXT[] NOT NULL DEFAULT '{}',        -- subscribed event types
    vehicle_id      BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,  -- NULL = all vehicles
    enabled         BOOLEAN NOT NULL DEFAULT true,
    headers         JSONB NOT NULL DEFAULT '{}',        -- custom HTTP headers
    retry_count     INTEGER NOT NULL DEFAULT 3,         -- retries on failure
    timeout_seconds INTEGER NOT NULL DEFAULT 10,        -- HTTP timeout
    
    -- State
    last_triggered_at   TIMESTAMPTZ,
    last_success_at     TIMESTAMPTZ,
    last_failure_at     TIMESTAMPTZ,
    failure_count       BIGINT NOT NULL DEFAULT 0,
    success_count       BIGINT NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    auto_disabled       BOOLEAN NOT NULL DEFAULT false,  -- disabled after 50 consecutive failures
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhooks_enabled ON webhooks (enabled) WHERE enabled = true;

-- Webhook delivery log (last 1000 deliveries per webhook)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              BIGSERIAL PRIMARY KEY,
    webhook_id      BIGINT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    response_status INTEGER,
    response_body   TEXT,
    duration_ms     INTEGER,
    success         BOOLEAN NOT NULL DEFAULT false,
    error           TEXT,
    attempt         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_deliveries_webhook ON webhook_deliveries (webhook_id, created_at DESC);
```

### Step 2: Event Types

```go
// Supported webhook event types
var WebhookEventTypes = []string{
    // Vehicle state
    "vehicle.online",
    "vehicle.offline",
    "vehicle.asleep",

    // Driving
    "drive.start",
    "drive.end",

    // Charging
    "charge.start",
    "charge.complete",
    "charge.interrupted",

    // Alerts
    "alert.triggered",

    // Commands
    "command.executed",
    "command.failed",

    // Security
    "vehicle.locked",
    "vehicle.unlocked",
    "sentry.activated",
    "sentry.deactivated",

    // Software
    "software.update_available",
    "software.update_installed",

    // Automations
    "automation.executed",
    "automation.failed",

    // System
    "system.health_degraded",
    "system.health_recovered",
}
```

### Step 3: Webhook Payload Format

```go
type WebhookPayload struct {
    ID        string                 `json:"id"`         // unique delivery ID (UUID)
    Event     string                 `json:"event"`      // event type
    Timestamp string                 `json:"timestamp"`  // ISO 8601
    Vehicle   *WebhookVehicle        `json:"vehicle,omitempty"`
    Data      map[string]interface{} `json:"data"`       // event-specific data
}

type WebhookVehicle struct {
    ID          int64  `json:"id"`
    VIN         string `json:"vin"`
    DisplayName string `json:"display_name"`
    Model       string `json:"model"`
}
```

**Example payloads:**

```json
// charge.complete
{
  "id": "wh_abc123",
  "event": "charge.complete",
  "timestamp": "2026-04-19T15:30:00Z",
  "vehicle": {"id": 1, "vin": "5YJ3E1...", "display_name": "Model Y", "model": "Model Y"},
  "data": {
    "battery_level": 90,
    "energy_added_kwh": 42.3,
    "duration_minutes": 180,
    "charge_cost": 5.08,
    "charger_type": "home"
  }
}

// drive.end
{
  "id": "wh_def456",
  "event": "drive.end",
  "timestamp": "2026-04-19T15:30:00Z",
  "vehicle": {"id": 1, "vin": "5YJ3E1...", "display_name": "Model Y"},
  "data": {
    "distance_miles": 23.4,
    "duration_minutes": 32,
    "energy_used_kwh": 6.2,
    "efficiency_wh_mi": 265,
    "start_location": "Home",
    "end_location": "Office"
  }
}

// alert.triggered
{
  "id": "wh_ghi789",
  "event": "alert.triggered",
  "timestamp": "2026-04-19T15:30:00Z",
  "vehicle": {"id": 1, "vin": "5YJ3E1...", "display_name": "Model Y"},
  "data": {
    "alert_name": "Low Battery",
    "severity": "warning",
    "message": "Battery level dropped below 20%",
    "battery_level": 18
  }
}
```

### Step 4: Webhook Dispatcher

Create `internal/webhook/dispatcher.go`:

```go
type Dispatcher struct {
    db          *database.DB
    httpClient  *http.Client
    webhookRepo *WebhookRepo
    deliveryRepo *DeliveryRepo
    queue       chan deliveryJob
}

type deliveryJob struct {
    webhook WebhookConfig
    payload WebhookPayload
}

// Dispatch finds all webhooks subscribed to this event and enqueues deliveries.
func (d *Dispatcher) Dispatch(ctx context.Context, event string, vehicleID int64, data map[string]interface{}) {
    webhooks, err := d.webhookRepo.FindByEvent(ctx, event, vehicleID)
    if err != nil {
        log.Warn().Err(err).Str("event", event).Msg("webhook: failed to find subscribers")
        return
    }

    payload := WebhookPayload{
        ID:        generateDeliveryID(),
        Event:     event,
        Timestamp: time.Now().UTC().Format(time.RFC3339),
        Data:      data,
    }

    // Add vehicle info if available
    if vehicleID > 0 {
        payload.Vehicle = d.lookupVehicle(ctx, vehicleID)
    }

    for _, wh := range webhooks {
        d.queue <- deliveryJob{webhook: wh, payload: payload}
    }
}
```

### Step 5: HTTP Delivery with Signing

```go
func (d *Dispatcher) deliver(job deliveryJob) {
    body, _ := json.Marshal(job.payload)

    req, _ := http.NewRequest("POST", job.webhook.URL, bytes.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("User-Agent", "TeslaSync-Webhook/1.0")
    req.Header.Set("X-Webhook-ID", job.payload.ID)
    req.Header.Set("X-Webhook-Event", job.payload.Event)

    // HMAC signature for payload verification
    if job.webhook.Secret != "" {
        mac := hmac.New(sha256.New, []byte(job.webhook.Secret))
        mac.Write(body)
        sig := hex.EncodeToString(mac.Sum(nil))
        req.Header.Set("X-Webhook-Signature", "sha256="+sig)
    }

    // Custom headers
    for k, v := range job.webhook.Headers {
        req.Header.Set(k, v)
    }

    // Execute with timeout
    ctx, cancel := context.WithTimeout(context.Background(),
        time.Duration(job.webhook.TimeoutSeconds)*time.Second)
    defer cancel()
    req = req.WithContext(ctx)

    start := time.Now()
    resp, err := d.httpClient.Do(req)
    duration := time.Since(start).Milliseconds()

    // Log delivery
    delivery := DeliveryRecord{
        WebhookID:  job.webhook.ID,
        EventType:  job.payload.Event,
        Payload:    body,
        DurationMs: int(duration),
        Attempt:    1,
    }

    if err != nil {
        delivery.Error = err.Error()
        delivery.Success = false
    } else {
        delivery.ResponseStatus = resp.StatusCode
        delivery.Success = resp.StatusCode >= 200 && resp.StatusCode < 300
        if !delivery.Success {
            bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
            delivery.ResponseBody = string(bodyBytes)
        }
        resp.Body.Close()
    }

    d.deliveryRepo.Insert(context.Background(), &delivery)

    // Update webhook state
    if delivery.Success {
        d.webhookRepo.RecordSuccess(context.Background(), job.webhook.ID)
    } else {
        d.webhookRepo.RecordFailure(context.Background(), job.webhook.ID)
        // Retry if configured
        if delivery.Attempt < job.webhook.RetryCount {
            go func() {
                time.Sleep(time.Duration(delivery.Attempt*5) * time.Second)
                job.payload.ID = generateDeliveryID() // new ID for retry
                d.queue <- job // re-enqueue
            }()
        }
    }
}
```

### Step 6: Wire into Event Bus

In `cmd/teslasync/main.go`, subscribe the webhook dispatcher to the event bus:

```go
if cfg.Webhooks.Enabled {
    webhookDispatcher := webhook.NewDispatcher(db)
    // Subscribe to all events the webhook system supports
    for _, eventType := range webhook.WebhookEventTypes {
        eventBus.Subscribe(eventType, func(evt events.Event) {
            webhookDispatcher.Dispatch(ctx, evt.Type, evt.VehicleID, evt.Data)
        })
    }
}
```

### Step 7: REST API for Webhook Management

Add to `internal/api/router.go`:

```go
r.Route("/webhooks", func(r chi.Router) {
    r.Get("/", webhookHandler.List)           // list all webhooks
    r.Post("/", webhookHandler.Create)         // create webhook
    r.Get("/events", webhookHandler.ListEvents) // list supported event types
    r.Route("/{webhookID}", func(r chi.Router) {
        r.Get("/", webhookHandler.Get)         // get webhook details
        r.Put("/", webhookHandler.Update)       // update webhook
        r.Delete("/", webhookHandler.Delete)    // delete webhook
        r.Post("/test", webhookHandler.Test)    // send test payload
        r.Get("/deliveries", webhookHandler.Deliveries) // delivery log
    })
})
```

The **Test endpoint** sends a sample payload to the webhook URL so users can verify
it's working before real events fire.

### Step 8: Auto-Disable on Consecutive Failures

If a webhook fails 50 times in a row, auto-disable it to prevent hammering a dead URL:

```go
func (r *WebhookRepo) RecordFailure(ctx context.Context, id int64) {
    r.db.Pool.Exec(ctx, `
        UPDATE webhooks SET
            last_failure_at = NOW(),
            failure_count = failure_count + 1,
            consecutive_failures = consecutive_failures + 1,
            auto_disabled = CASE WHEN consecutive_failures >= 49 THEN true ELSE false END,
            updated_at = NOW()
        WHERE id = $1`, id)
}
```

### Step 9: Configuration

```go
type WebhookConfig struct {
    Enabled         bool // WEBHOOKS_ENABLED (default: false)
    MaxPerUser      int  // WEBHOOKS_MAX_PER_USER (default: 10)
    QueueSize       int  // WEBHOOKS_QUEUE_SIZE (default: 1000)
    WorkerCount     int  // WEBHOOKS_WORKERS (default: 3)
}
```

Update docker-compose.yml, helm configmap, and values.yaml.

### Step 10: Frontend Webhook Management Page

Create `web/src/features/settings/pages/WebhooksPage.tsx`:

- List registered webhooks with status (active/disabled/failing)
- Create new webhook form (URL, events checkboxes, secret)
- Test button per webhook
- Delivery log timeline with success/failure indicators
- Re-enable auto-disabled webhooks

Use the existing API hooks pattern (`useWebhooks` hook in `api/hooks/`).

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Tests
go test -count=1 ./internal/webhook/...

# Manual test:
# 1. Start a test receiver: nc -l 9999
# 2. Create webhook via API:
curl -X POST http://localhost:8080/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -d '{"name":"test","url":"http://localhost:9999","events":["charge.complete"],"secret":"mysecret"}'

# 3. Test endpoint:
curl -X POST http://localhost:8080/api/v1/webhooks/1/test
# Check nc output — should receive JSON payload with X-Webhook-Signature header

# Frontend
cd web && npx tsc --noEmit
```

## Commit

```bash
git add -A
git commit -m "feat(api): add outbound webhook system for event notifications

- Create webhooks and webhook_deliveries tables
- Support 20+ event types (charge, drive, alert, command, automation, system)
- HMAC-SHA256 payload signing with configurable secret per webhook
- Retry with exponential backoff (3 attempts default)
- Auto-disable after 50 consecutive failures
- REST API for webhook CRUD + test endpoint + delivery log
- Wire into domain event bus for automatic dispatch
- Add frontend webhook management page
- Configurable via WEBHOOKS_ENABLED (default: false)"
```

## What NOT To Change

- Do not modify the existing notification dispatcher (Discord, Slack, etc.)
- Do not modify the existing event bus — subscribe to it, don't change it
- Do not require webhooks for core functionality — always optional
- Do not allow webhook URLs to target internal/private IPs (SSRF prevention)
