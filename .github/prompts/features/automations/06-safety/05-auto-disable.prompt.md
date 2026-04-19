---
description: "Automation safety: auto-disable — disable automation after repeated consecutive failures"
---

# Safety: Auto-Disable

## Implementation
Create `internal/automation/safety/auto_disable.go`. Track `consecutive_failures` on the automation record. After N consecutive failures (default 5), set `auto_disabled = true` with `auto_disabled_reason` explaining why. FSM transitions to `disabled` state. The automation stops firing until manually re-enabled by the user. Show a prominent warning on the automations list page. Send a notification when auto-disabled.
