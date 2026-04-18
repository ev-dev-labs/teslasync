---
description: "Automation safety: failure alerts — always notify on automation failure regardless of notify_on_run setting"
---

# Safety: Failure Alerts

## Implementation
Create `internal/automation/safety/failure_alert.go`. Separate from `notify_on_run` — failure alerts are always sent when `notify_on_failure = true` (default). Use the existing notification dispatcher. Include: automation name, trigger that fired, which action failed, error message, retry count, and a link to the automation history page. If the automation is auto-disabled, include that in the alert.
