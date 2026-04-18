---
description: "Automation action: command executor — send any vehicle command as an automation action"
---

# Action: Command Executor

## Config
```json
{"type": "command", "command": "climate_on", "params": {}}
```

## Implementation
Create `internal/automation/action/command.go`. Reuses the existing `CommandHandler.SendCommand` logic — look up vehicle by ID, validate command is in `allowedCommands`, send via Tesla client, log to `command_logs`. Return `{success: bool, error: string, duration_ms: int}`.

The action executor must resolve `vehicle_id` — if automation is per-vehicle, use that. If fleet-wide (vehicle_id=null), iterate all vehicles and send to each.

Support ALL 80+ commands from the `allowedCommands` whitelist. The command name and params in the action config match exactly what the Commands page sends.
