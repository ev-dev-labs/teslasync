---
description: "Automation safety: retry policy — configurable retry with exponential backoff for failed actions"
---

# Safety: Retry Policy

## Implementation
Create `internal/automation/safety/retry.go`. When an action fails with a retryable error (network, rate limit, vehicle asleep): retry up to `max_retries` (default 3) with exponential backoff (5s, 15s, 45s). Non-retryable errors (auth, invalid command) fail immediately. Track retry count in FSM state. Integrate with the automation FSM `retrying` → `executing` transition.
