---
description: "Automation API: test run — dry-run an automation without actually executing commands"
---

# API: Test Run

## Endpoint
```
POST /api/v1/automations/{id}/test-run
```

## Implementation
Execute the full automation pipeline (evaluate trigger snapshot, check conditions, resolve action chain) but replace the actual command executor with a mock that returns `{success: true, simulated: true}`. Log the test run in history with `status = "test"`. Return the full execution plan showing what would happen. Useful for debugging automations before enabling.
