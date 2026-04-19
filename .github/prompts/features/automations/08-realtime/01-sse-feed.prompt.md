---
description: "Automation realtime: SSE event feed for live automation activity"
---

# Realtime: SSE Activity Feed

## Overview
Add an SSE (Server-Sent Events) endpoint that streams automation execution events in real-time. The automations list page subscribes to this feed to show live "firing now" indicators and a live activity log.

## Endpoint
```
GET /api/v1/automations/events (SSE stream)
```

## Events
```
event: automation.triggered
data: {"automation_id": 1, "name": "Morning Prep", "vehicle": "Falcon", "trigger": "cron", "at": "..."}

event: automation.succeeded
data: {"automation_id": 1, "name": "Morning Prep", "duration_ms": 1200, "actions": 3}

event: automation.failed
data: {"automation_id": 1, "name": "Morning Prep", "error": "vehicle did not wake", "action_index": 1}

event: automation.skipped
data: {"automation_id": 1, "name": "Morning Prep", "reason": "conditions not met: battery > 50%"}
```

## Implementation
Use the existing `internal/api/event_hub.go` SSE infrastructure. Add an `automation` channel. The automation engine publishes events after each FSM transition. Frontend subscribes via `EventSource` and updates the list page in real-time.
