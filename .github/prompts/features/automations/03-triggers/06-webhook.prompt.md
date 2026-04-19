---
description: "Automation trigger: webhook — fires when an external HTTP request hits the automation webhook endpoint"
---

# Trigger: Webhook (Incoming)

## Overview

Fires when an external system sends an HTTP POST to the automation's unique webhook URL.
Each webhook-triggered automation gets a unique token/URL for security.

## Trigger Config Schema

```json
{
  "trigger_type": "webhook",
  "trigger_config": {
    "webhook_token": "auto-generated-uuid",  // unique per automation, generated on create
    "secret": "optional-hmac-secret",         // optional: validate X-Webhook-Signature header
    "payload_filter": null                    // optional: JSON path condition to filter
  }
}
```

## Webhook URL Format

```
POST /api/v1/automations/webhook/{webhook_token}
Content-Type: application/json

{ "event": "door_opened", "value": true }
```

## Implementation

Create `internal/automation/trigger/webhook.go`:

```go
type WebhookTrigger struct {
    repo   *database.AutomationRepo
    engine AutomationEngine
}

// HandleWebhook processes an incoming webhook request.
// Called by the API handler when POST /automations/webhook/{token} is hit.
func (t *WebhookTrigger) HandleWebhook(ctx context.Context, token string, payload []byte) error
```

**Logic:**
1. Look up automation by webhook_token
2. Validate HMAC signature if secret is set
3. Apply payload_filter if configured
4. Fire evaluation with payload as trigger snapshot

Auto-generate `webhook_token` (UUID v4) when creating automation with webhook trigger.

## Trigger Snapshot

```json
{"webhook_token": "abc-123", "payload": {"event": "door_opened", "value": true}, "remote_ip": "192.168.1.100"}
```

## Tests

- Test valid webhook fires automation
- Test invalid token returns 404
- Test HMAC signature validation
- Test payload filter

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v -run Webhook
```
