---
description: "Automation safety: rate limits — max executions per hour per automation"
---

# Safety: Rate Limits

## Implementation
Create `internal/automation/safety/rate_limit.go`. Before executing, check `automation.max_executions_hour`. Query `automation_history` for executions in the last hour. If at limit, skip and log. Default 0 = unlimited. Recommended defaults per trigger type: cron=unlimited, battery=10/hr, state=20/hr, mqtt=30/hr.
