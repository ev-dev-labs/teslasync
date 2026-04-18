---
description: "Automations FSM: state machine for automation execution lifecycle"
---

# Automations: Execution FSM

## Overview

Create `internal/fsm/automation/machine.go` implementing the automation execution
lifecycle FSM. Follows the same patterns as `internal/fsm/command/machine.go`.

## States

```go
const (
    Idle       State = "idle"        // Enabled, waiting for trigger
    Evaluating State = "evaluating"  // Trigger fired, checking conditions
    Executing  State = "executing"   // Conditions met, running actions
    Succeeded  State = "succeeded"   // All actions completed successfully
    Partial    State = "partial"     // Some actions succeeded, some failed
    Failed     State = "failed"      // Action(s) failed
    Retrying   State = "retrying"    // Retrying failed actions
    GaveUp     State = "gave_up"    // Max retries exceeded
    Skipped    State = "skipped"     // Conditions not met
    Cooldown   State = "cooldown"    // Waiting for cooldown period
    Disabled   State = "disabled"    // Auto-disabled after repeated failures
)
```

## Transitions

```
idle       → evaluating     (trigger fires)
evaluating → executing      (conditions met)
evaluating → skipped        (conditions not met)
executing  → succeeded      (all actions OK)
executing  → partial        (some actions failed, stop_on_failure=false)
executing  → failed         (action failed, stop_on_failure=true)
failed     → retrying       (retry policy allows)
retrying   → executing      (retry attempt)
retrying   → gave_up        (max retries exceeded)
succeeded  → cooldown       (cooldown_minutes > 0)
partial    → cooldown       (cooldown_minutes > 0)
succeeded  → idle           (no cooldown)
partial    → idle           (no cooldown)
gave_up    → idle           (reset for next trigger)
gave_up    → disabled       (consecutive_failures > threshold)
skipped    → idle           (ready for next trigger)
cooldown   → idle           (cooldown expired)
disabled   → idle           (manually re-enabled)
```

## Implementation

```go
package automation

type ExecutionFSM struct {
    mu              sync.Mutex
    state           State
    automationID    int64
    automationName  string
    vehicleID       int64
    triggerType     string
    retryCount      int
    maxRetries      int
    startedAt       time.Time
    transitions     []Transition  // local log for this execution
}

type Transition struct {
    From      State
    To        State
    Trigger   string
    At        time.Time
}
```

Each state change MUST:
1. Log locally to `fsm.transitions` slice
2. Call `FSMTransitionRepo.Insert()` with `fsm_type = "automation"` and context snapshot
3. Log via zerolog at Info level

Context snapshot should include:
```go
snapshot := map[string]interface{}{
    "automation_id":   fsm.automationID,
    "automation_name": fsm.automationName,
    "trigger_type":    fsm.triggerType,
    "retry_count":     fsm.retryCount,
}
```

## Tests

Create `internal/fsm/automation/machine_test.go`:
- Test full happy path: idle → evaluating → executing → succeeded → cooldown → idle
- Test conditions not met: idle → evaluating → skipped → idle
- Test failure + retry: executing → failed → retrying → executing → succeeded
- Test give up: retrying → gave_up → disabled (after N consecutive failures)
- Test cooldown expiry
- Test concurrent safety (multiple goroutines)

## Verification

```bash
go test ./internal/fsm/automation/... -v -race
go build ./...
```
