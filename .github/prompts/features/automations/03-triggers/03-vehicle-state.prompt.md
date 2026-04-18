---
description: "Automation trigger: vehicle state changes — wake, sleep, online, offline, charging starts/stops, drive starts/ends"
---

# Trigger: Vehicle State

## Overview

Fires when the vehicle transitions between states. Hooks into the existing vehicle FSM
transition events.

## Trigger Config Schema

```json
{
  "trigger_type": "vehicle_state",
  "trigger_config": {
    "event": "charging_complete",  // see event list below
    "from_state": null,            // optional: only fire if transitioning FROM this state
    "to_state": null               // optional: only fire if transitioning TO this state
  }
}
```

### Supported Events

| Event | Description | FSM Source |
|-------|-------------|------------|
| `wakes_up` | Vehicle wakes from sleep | vehicle: asleep → online |
| `goes_to_sleep` | Vehicle enters sleep | vehicle: * → asleep |
| `comes_online` | Vehicle becomes reachable | vehicle: offline → online |
| `goes_offline` | Vehicle becomes unreachable | vehicle: * → offline |
| `drive_starts` | Drive session begins | drive_session: pending → active |
| `drive_ends` | Drive session completes | drive_session: * → completed |
| `charging_starts` | Charge session begins | charge_session: pending → active |
| `charging_stops` | Charge session stops | charge_session: active → * |
| `charging_complete` | Charge reaches limit | charge_session: * → done |
| `sentry_event` | Sentry mode triggered an event | MQTT sentry topic |
| `state_change` | Any state change (use from/to filters) | Any FSM |

## Implementation

Create `internal/automation/trigger/vehicle_state.go`:

```go
type VehicleStateTrigger struct {
    repo   *database.AutomationRepo
    engine AutomationEngine
}

// OnFSMTransition is called whenever any FSM transition occurs.
// It checks all vehicle_state automations to see if any should fire.
func (t *VehicleStateTrigger) OnFSMTransition(vehicleID int64, fsmType, fromState, toState string)
```

## Integration

Hook into the FSM transition logging path. After every `FSMTransitionRepo.Insert()`,
also call `VehicleStateTrigger.OnFSMTransition()`. This is a fan-out from the existing
transition pipeline — no new MQTT subscriptions needed.

## Trigger Snapshot

```json
{"vehicle_id": 1, "event": "charging_complete", "fsm_type": "charge_session", "from_state": "active", "to_state": "done"}
```

## Tests

- Test charging_complete fires on charge_session done transition
- Test drive_starts fires on drive_session active transition
- Test from/to filters (only fire if FROM specific state)
- Test event matching logic
- Test no double-fire for same transition

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v -run VehicleState
```
