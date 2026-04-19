---
description: "Automation condition: time window — only fire within a specific time range"
---

# Condition: Time Window

## Config
```json
{"type": "time_window", "start_time": "22:00", "end_time": "06:00", "timezone": "America/Los_Angeles"}
```

## Implementation
Create `internal/automation/condition/time_window.go`. Check if current time is within the window. Handle overnight ranges (22:00–06:00 spans midnight). Return `{met: bool, reason: "current time 23:15 is within 22:00-06:00"}`.
