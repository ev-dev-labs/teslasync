---
description: "Automation safety: priority queue — execute higher-priority automations first when multiple trigger simultaneously"
---

# Safety: Priority Queue

## Implementation
Create `internal/automation/safety/priority.go`. When multiple automations trigger at the same time, sort by `priority` field (1=highest, 100=lowest). Default priorities: security=10, charging=30, climate=50, comfort=70, media=90. Execute sequentially by priority to prevent conflicting commands. If two automations have the same priority, execute in creation order.
