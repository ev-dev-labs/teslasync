---
description: "Automation condition: cooldown — don't fire again within N minutes of last execution"
---

# Condition: Cooldown

## Config
```json
{"type": "cooldown", "minutes": 30}
```

## Implementation
Create `internal/automation/condition/cooldown.go`. Check `automation.last_triggered_at` — if less than N minutes ago, condition is NOT met. This prevents flapping (e.g., battery oscillating around threshold). Return `{met: bool, reason: "last triggered 5m ago, cooldown is 30m"}`.

Note: This is also enforced at the automation level via `cooldown_minutes` field, but having it as a condition allows per-condition cooldowns in complex automations.
