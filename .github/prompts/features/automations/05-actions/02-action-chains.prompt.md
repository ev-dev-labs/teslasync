---
description: "Automation action: chains — execute multiple actions in sequence"
---

# Action: Action Chains

## Overview
The `actions` array in an automation is an ordered list. The chain executor runs each action sequentially, passing context between them. If `stop_on_failure` is true, abort on first failure.

## Implementation
Create `internal/automation/action/chain.go`:
```go
type ChainExecutor struct {
    executors map[string]ActionExecutor  // "command", "wait", "notify", "set_variable"
}

func (c *ChainExecutor) Execute(ctx context.Context, actions []ActionConfig, vehicle *models.Vehicle) []ActionResult
```

Each `ActionResult` includes: `{action_type, action_config, success, error, duration_ms, index}`.

For fleet-wide automations, run the entire chain per vehicle (not action 1 for all vehicles, then action 2).
