---
description: "Automation API: undo last execution — reverse the most recent automation run"
---

# API: Undo Last

## Endpoint
```
POST /api/v1/automations/{id}/undo           — Reverse the last execution
```

## Implementation
Look up the most recent successful execution from `automation_history`. For each action that was a command, determine the "reverse" command (lock→unlock, climate_on→climate_off, sentry_on→sentry_off, charge_start→charge_stop). Execute the reverse chain. Not all commands are reversible (honk, flash, navigate) — skip those and note in response. Log the undo as a separate history entry with `status = "undo"`.

Reverse command map:
```go
var reverseCommands = map[string]string{
    "lock": "unlock", "unlock": "lock",
    "climate_on": "climate_off", "climate_off": "climate_on",
    "sentry_on": "sentry_off", "sentry_off": "sentry_on",
    "charge_start": "charge_stop", "charge_stop": "charge_start",
    "vent_windows": "close_windows", "close_windows": "vent_windows",
    // ... etc
}
```
