---
description: "Automation action: delays — wait N seconds/minutes between chained actions"
---

# Action: Wait / Delay

## Config
```json
{"type": "wait", "duration_seconds": 10}
```

## Implementation
Create `internal/automation/action/wait.go`. Simply `time.Sleep` or use `context.WithTimeout` for the specified duration. Respect context cancellation. Log the wait in action results. Max delay: 3600 seconds (1 hour) to prevent runaway waits.
