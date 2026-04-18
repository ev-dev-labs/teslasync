---
description: "Automation API: CRUD endpoints for automations"
---

# API: Automations CRUD

## Endpoints
```
GET    /api/v1/automations                    — List all automations (with ?enabled=true filter)
GET    /api/v1/automations/{id}               — Get single automation
POST   /api/v1/automations                    — Create automation (returns conflicts if any)
PUT    /api/v1/automations/{id}               — Update automation
DELETE /api/v1/automations/{id}               — Delete automation
PATCH  /api/v1/automations/{id}/toggle        — Enable/disable toggle
PATCH  /api/v1/automations/{id}/re-enable     — Re-enable auto-disabled automation
```

## Implementation
Create `internal/api/automation_handler.go` with standard handler pattern. Wire in `router.go`. Validate trigger_config schema per trigger_type. Run conflict detection on create/update and return warnings in response. Return automation with computed fields (next_fire_time for cron triggers).
