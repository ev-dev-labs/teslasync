---
description: "Automation API: incoming webhook receiver endpoint"
---

# API: Webhook Receiver

## Endpoint
```
POST /api/v1/automations/webhook/{token}     — Receive incoming webhook
```

## Implementation
This endpoint is publicly accessible (no auth required — the token IS the auth). Look up automation by `webhook_token` in trigger_config. Validate HMAC if configured. Pass payload to the webhook trigger handler. Rate limit: 60 req/min per token. Return `200 OK` with `{accepted: true}` or `429` if rate limited.

Wire in `router.go` OUTSIDE the auth middleware group so external systems can call it.
