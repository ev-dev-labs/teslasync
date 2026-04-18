---
description: "Automation condition: vehicle state check — only fire if vehicle is in a specific state"
---

# Condition: State Check

## Config
```json
{"type": "state_check", "field": "is_locked", "operator": "eq", "value": true}
```

Supported fields: `is_locked`, `is_charging`, `is_climate_on`, `sentry_mode`, `battery_level`, `inside_temp`, `outside_temp`, `speed`, `state` (vehicle state string).

Operators: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`.

## Implementation
Create `internal/automation/condition/state_check.go`. Fetch current vehicle state from DB/cache, evaluate the field against the operator+value. Return `{met: bool, reason: "battery_level 45 > 20"}`.
