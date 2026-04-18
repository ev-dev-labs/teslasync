---
description: "Automation condition: day filter — only fire on specific days of the week"
---

# Condition: Day Filter

## Config
```json
{"type": "day_filter", "days": [1,2,3,4,5], "timezone": "America/Los_Angeles"}
```
Days: 0=Sunday, 1=Monday, ..., 6=Saturday.

## Implementation
Create `internal/automation/condition/day_filter.go`. Check if today (in configured timezone) is in the allowed days list. Return `{met: bool, reason: "Tuesday is in allowed days [Mon-Fri]"}`.
