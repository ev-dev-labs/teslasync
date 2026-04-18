---
description: "Automation action: variables — store/read values for cross-automation state"
---

# Action: Set Variable

## Config
```json
{"type": "set_variable", "key": "last_charge_level", "value": "{{battery_level}}"}
```

## Implementation
Create `internal/automation/action/variable.go`. Uses `automation_variables` table. Supports template resolution in values. Variables can be read in conditions via a `variable_check` condition type:
```json
{"type": "variable_check", "key": "last_charge_level", "operator": "lt", "value": "50"}
```

Use cases: track state across automation runs (e.g., "last time garage opened", "charge level at departure").
