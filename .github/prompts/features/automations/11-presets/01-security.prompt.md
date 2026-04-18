---
description: "Automation presets: 7 security templates — Night Lockdown, Morning Unlock, Away Mode, Auto-Lock, Guest Cleanup, Valet Return, Theft Alert"
---

# Presets: Security (7 templates)

## Templates

### 1. Night Lockdown
```json
{"name": "Night Lockdown", "trigger_type": "cron", "trigger_config": {"cron_expr": "0 23 * * *"}, "actions": [{"type": "command", "command": "lock"}, {"type": "command", "command": "sentry_on"}, {"type": "command", "command": "close_windows"}], "priority": 10}
```

### 2. Morning Unlock
```json
{"name": "Morning Unlock", "trigger_type": "cron", "trigger_config": {"cron_expr": "0 7 * * 1-5"}, "actions": [{"type": "command", "command": "unlock"}, {"type": "command", "command": "sentry_off"}], "priority": 10}
```

### 3. Away Mode
```json
{"name": "Away Mode", "trigger_type": "vehicle_state", "trigger_config": {"event": "goes_to_sleep"}, "actions": [{"type": "command", "command": "sentry_on"}], "priority": 10}
```

### 4. Auto-Lock Reminder
```json
{"name": "Auto-Lock Reminder", "trigger_type": "cron", "trigger_config": {"cron_expr": "*/10 * * * *"}, "conditions": [{"type": "state_check", "field": "is_locked", "operator": "eq", "value": false}, {"type": "state_check", "field": "state", "operator": "eq", "value": "parked"}], "actions": [{"type": "command", "command": "lock"}, {"type": "notify", "message": "Vehicle was unlocked and parked — auto-locked"}], "cooldown_minutes": 30, "priority": 10}
```

### 5. Guest Mode Cleanup
```json
{"name": "Guest Mode Cleanup", "trigger_type": "vehicle_state", "trigger_config": {"event": "state_change", "to_state": "parked"}, "conditions": [{"type": "state_check", "field": "guest_mode", "operator": "eq", "value": false}], "actions": [{"type": "command", "command": "erase_user_data"}, {"type": "command", "command": "lock"}], "priority": 10}
```

### 6. Valet Return
```json
{"name": "Valet Return", "trigger_type": "vehicle_state", "trigger_config": {"event": "state_change"}, "actions": [{"type": "notify", "message": "Valet returned vehicle. Battery: {{battery_level}}%"}], "priority": 20}
```

### 7. Theft Alert
```json
{"name": "Theft Alert", "trigger_type": "vehicle_state", "trigger_config": {"event": "sentry_event"}, "actions": [{"type": "command", "command": "flash_lights"}, {"type": "command", "command": "honk_horn"}, {"type": "notify", "channel": "all", "message": "🚨 Sentry event triggered on {{vehicle}}!"}], "priority": 1}
```

## Implementation
Store presets in `internal/automation/presets/security.go` as Go structs. Expose via `GET /api/v1/automations/presets?category=security`. Frontend renders in the presets gallery with one-click install.
