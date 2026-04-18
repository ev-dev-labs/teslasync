---
description: "Automation API: execution history endpoints"
---

# API: Execution History

## Endpoints
```
GET /api/v1/automations/history                   — Recent executions across all automations
GET /api/v1/automations/{id}/history              — History for a specific automation
GET /api/v1/automations/history/{historyId}       — Single execution detail (with action results)
```

Query params: `?limit=50&offset=0&status=failed&since=2026-04-01`

## Implementation
Add methods to `automation_handler.go`. Return `automation_history` rows with full action results. Include computed fields: duration, success rate. For the detail view, include the FSM transition log for that execution.
