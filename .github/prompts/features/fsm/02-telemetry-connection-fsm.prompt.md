---
description: "Fleet Telemetry Connection FSM: track streaming health per vehicle with stale detection"
---

# Fleet Telemetry Connection FSM

## Problem

TeslaSync has no formal lifecycle tracking for Fleet Telemetry streaming connections.
The `VehicleStreamState` struct in `telemetry_handler.go` tracks per-vehicle streaming
metrics (`LastReceived`, `IsStreaming`, `SignalCount`), but there's no state machine
to detect and react to connection phase changes. When Fleet Telemetry goes silent,
signals just go stale with no alert, no FSM transition, and no visibility in the
debugger.

Users have no way to know "Is my vehicle actively streaming? Did it stop? When?"

## Current State

### VehicleStreamState (telemetry_handler.go:115-127)
```go
type VehicleStreamState struct {
    VIN              string
    LastReceived     time.Time
    FirstReceived    time.Time
    SignalCount      int64
    BatchCount       int64
    IsStreaming       bool
    DataSource       string      // "fleet_telemetry" or "fleet_api"
    SignalsPerSecond float64
    LatencyMs        int64
    UptimeSeconds    float64
}
```

### Telemetry Status Endpoint (telemetry_handler.go:1292-1345)
- `GET /api/v1/telemetry/status` — returns aggregate + per-vehicle streaming state
- Stale detection: marks `IsStreaming=false` if no signal for > `staleTimeout` (default 2min)
- Cleanup runs every 2 minutes

### What's Missing
- No formal state transitions (just a boolean `IsStreaming` flip)
- No transition history in `fsm_transitions` table
- Not visible in FSM debugger
- No MQTT events on state changes
- No alerts when streaming drops
- No distinction between "never connected" and "was streaming, now stale"

## Task

### Step 1: Define States and Triggers

Create `internal/fsm/telemetry/state.go`:

```go
package telemetry

type State string

const (
    // Vehicle has never sent Fleet Telemetry data to this instance
    Unknown       State = "unknown"

    // First batch received, connection establishing
    Connecting    State = "connecting"

    // Actively receiving telemetry batches within expected intervals
    Streaming     State = "streaming"

    // Was streaming but no data received for > staleThreshold (default 60s)
    Stale         State = "stale"

    // No data for > offlineThreshold (default 5min) — likely vehicle asleep or FT disconnected
    Disconnected  State = "disconnected"

    // Vehicle is using REST API polling instead of Fleet Telemetry streaming
    PollingOnly   State = "polling_only"
)

type Trigger string

const (
    TriggerFirstBatch       Trigger = "first_batch"         // first-ever signal batch from this vehicle
    TriggerBatchReceived    Trigger = "batch_received"      // subsequent batch within threshold
    TriggerStaleTimeout     Trigger = "stale_timeout"       // no batch for > staleThreshold
    TriggerOfflineTimeout   Trigger = "offline_timeout"     // no batch for > offlineThreshold
    TriggerReconnected      Trigger = "reconnected"         // batch received after stale/disconnected
    TriggerPollingDetected  Trigger = "polling_detected"    // data arriving via fleet_api, not fleet_telemetry
    TriggerStreamingResumed Trigger = "streaming_resumed"   // switched from polling back to streaming
)
```

### State Diagram
```
                  ┌────────────────────────────────────────────┐
                  │                                            ▼
  unknown ──(first_batch)──► connecting ──(batch)──► streaming ──(stale_timeout)──► stale
                                                        ▲          │                   │
                                                        │          │          (offline_timeout)
                                                        │     (batch)                  │
                                                        │          │                   ▼
                                                        └──────────┴──────────── disconnected
                                                        │
                                               (reconnected)
                                                        │
                                              stale/disconnected

  Any state ──(polling_detected)──► polling_only ──(streaming_resumed)──► streaming
```

### Step 2: Create the FSM Machine

Create `internal/fsm/telemetry/machine.go`:

```go
type ConnectionFSM struct {
    mu               sync.Mutex
    state            State
    vehicleID        int64
    vin              string
    lastBatchAt      time.Time
    firstBatchAt     time.Time
    batchCount       int64
    signalCount      int64
    signalsPerSec    float64
    dataSource       string        // "fleet_telemetry" or "fleet_api"
    stateEnteredAt   time.Time
    staleThreshold   time.Duration // default 60s
    offlineThreshold time.Duration // default 5min
    logger           zerolog.Logger
}

func New(vehicleID int64, vin string, opts ...Option) *ConnectionFSM {
    return &ConnectionFSM{
        state:            Unknown,
        vehicleID:        vehicleID,
        vin:              vin,
        stateEnteredAt:   time.Now().UTC(),
        staleThreshold:   60 * time.Second,
        offlineThreshold: 5 * time.Minute,
    }
}
```

**Key methods:**

#### `RecordBatch()` — called on every telemetry batch
```go
func (f *ConnectionFSM) RecordBatch(signalCount int, dataSource string) {
    f.mu.Lock()
    defer f.mu.Unlock()

    now := time.Now().UTC()
    f.lastBatchAt = now
    f.batchCount++
    f.signalCount += int64(signalCount)
    f.dataSource = dataSource

    switch f.state {
    case Unknown:
        f.firstBatchAt = now
        if dataSource == "fleet_api" {
            f.transition(TriggerPollingDetected)
        } else {
            f.transition(TriggerFirstBatch)
        }

    case Connecting:
        f.transition(TriggerBatchReceived)

    case Streaming:
        // Already streaming, just update metrics (no transition)

    case Stale, Disconnected:
        f.transition(TriggerReconnected)

    case PollingOnly:
        if dataSource == "fleet_telemetry" {
            f.transition(TriggerStreamingResumed)
        }
    }
}
```

#### `CheckTimeouts()` — called periodically (every 10s) by the health monitor
```go
func (f *ConnectionFSM) CheckTimeouts() {
    f.mu.Lock()
    defer f.mu.Unlock()

    if f.state != Streaming && f.state != Connecting {
        return
    }

    age := time.Since(f.lastBatchAt)
    if age > f.offlineThreshold {
        f.transition(TriggerOfflineTimeout)
    } else if age > f.staleThreshold {
        f.transition(TriggerStaleTimeout)
    }
}
```

### Step 3: Integrate into Telemetry Handler

In `internal/api/telemetry_handler.go`:

Add a map of `ConnectionFSM` instances alongside the existing `streamingState`:

```go
type TelemetryHandler struct {
    // ... existing fields ...
    connFSMs  map[int64]*telemetry.ConnectionFSM  // vehicleID → connection FSM
}
```

Update the signal processing path (where `streamingState` is updated, ~line 506-522)
to also call `connFSMs[vehicleID].RecordBatch(len(signals), dataSource)`.

Add a periodic goroutine that calls `CheckTimeouts()` on all active FSMs:
```go
// Start timeout checker (every 10s)
go func() {
    ticker := time.NewTicker(10 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            h.mu.RLock()
            for _, fsm := range h.connFSMs {
                fsm.CheckTimeouts()
            }
            h.mu.RUnlock()
        }
    }
}()
```

### Step 4: Log Transitions to fsm_transitions

Each state transition should be logged via `FSMTransitionRepo.Insert()`:

```go
func (f *ConnectionFSM) transition(trigger Trigger) {
    from := f.state
    to := transitionTable[f.state][trigger]
    if to == "" {
        return // invalid transition
    }

    durationInState := time.Since(f.stateEnteredAt).Milliseconds()
    f.state = to
    f.stateEnteredAt = time.Now().UTC()

    // Log transition
    if f.transRepo != nil {
        f.transRepo.Insert(ctx, f.vehicleID, "telemetry_connection", nil,
            string(from), string(to), string(trigger), "",
            "immediate", f.Snapshot(), durationInState)
    }

    // Publish to MQTT
    if f.mqttClient != nil {
        f.mqttClient.Publish(f.vin+"/telemetry/connection_state", string(to))
    }

    f.logger.Info().
        Str("from", string(from)).
        Str("to", string(to)).
        Str("trigger", string(trigger)).
        Int64("duration_ms", durationInState).
        Msg("telemetry connection state changed")
}
```

**Context snapshot:**
```go
func (f *ConnectionFSM) Snapshot() map[string]interface{} {
    return map[string]interface{}{
        "vin":               f.vin,
        "data_source":       f.dataSource,
        "batch_count":       f.batchCount,
        "signal_count":      f.signalCount,
        "signals_per_sec":   f.signalsPerSec,
        "last_batch_age_ms": time.Since(f.lastBatchAt).Milliseconds(),
    }
}
```

### Step 5: Expose in Telemetry Status Endpoint

Update `TelemetryStatus()` to include FSM state per vehicle:

```go
// In the streaming_vehicles response:
vehicleStatus["connection_fsm_state"] = fsm.State()
vehicleStatus["state_since"] = fsm.StateEnteredAt()
vehicleStatus["state_duration"] = time.Since(fsm.StateEnteredAt()).String()
```

### Step 6: Register in FSM Debugger

#### Backend
Add `"telemetry_connection"` to valid `fsm_type` values in the query handler.

#### Frontend
In `web/src/types/fsm.ts`:

Add to `FSM_STATES`:
```typescript
telemetry_connection: ['unknown', 'connecting', 'streaming', 'stale', 'disconnected', 'polling_only'],
```

Add to `STATE_COLORS`:
```typescript
telemetry_connection: {
  unknown:       { bg: 'bg-gray-500/10',   text: 'text-gray-400',   dot: 'bg-gray-400' },
  connecting:    { bg: 'bg-amber-500/10',  text: 'text-amber-400',  dot: 'bg-amber-400' },
  streaming:     { bg: 'bg-green-500/10',  text: 'text-green-400',  dot: 'bg-green-400' },
  stale:         { bg: 'bg-amber-500/10',  text: 'text-amber-400',  dot: 'bg-amber-400' },
  disconnected:  { bg: 'bg-red-500/10',    text: 'text-red-400',    dot: 'bg-red-400' },
  polling_only:  { bg: 'bg-blue-500/10',   text: 'text-blue-400',   dot: 'bg-blue-400' },
},
```

Add `'telemetry_connection'` to the `FSMType` union type.

### Step 7: MQTT Topics

Publish connection state changes for Home Assistant:

```
teslasync/{VIN}/telemetry/connection_state    — "streaming", "stale", "disconnected"
teslasync/{VIN}/telemetry/data_source         — "fleet_telemetry" or "fleet_api"
teslasync/{VIN}/telemetry/signals_per_second  — numeric throughput
```

### Step 8: Alert Integration

When the FSM transitions to `stale` or `disconnected`, publish a notification
event so the existing alert/notification system can pick it up:

```go
if to == Stale || to == Disconnected {
    h.eventBus.Publish("telemetry_health", events.Event{
        Type:      "telemetry_" + string(to),
        VehicleID: f.vehicleID,
        Message:   fmt.Sprintf("Fleet Telemetry %s for vehicle %s", to, f.vin),
    })
}
```

Users can then set up a notification rule: "Alert me if Fleet Telemetry is disconnected
for more than 10 minutes."

### Step 9: Unit Tests

Create `internal/fsm/telemetry/machine_test.go`:

Table-driven tests covering:
- Full connection lifecycle: unknown → connecting → streaming
- Stale detection: streaming → stale (after timeout)
- Offline detection: stale → disconnected (after longer timeout)
- Reconnection: disconnected → streaming (on new batch)
- Polling detection: unknown → polling_only (fleet_api data source)
- Polling → streaming switch: polling_only → streaming
- Concurrent batch recording safety
- Custom thresholds (configurable stale/offline timeouts)
- Snapshot contents at each state

## Verification

```bash
# Build
CGO_ENABLED=0 go build ./cmd/teslasync

# Tests
go test -count=1 -v ./internal/fsm/telemetry/...

# Full test suite
go test -count=1 ./internal/...

# Frontend types
cd web && npx tsc --noEmit
```

- [ ] FSM transitions logged to `fsm_transitions` with `fsm_type = 'telemetry_connection'`
- [ ] FSM debugger shows telemetry_connection in the type dropdown
- [ ] Stale timeout triggers transition after configured threshold
- [ ] Reconnection after stale/disconnected transitions back to streaming
- [ ] MQTT topics published on state changes
- [ ] Telemetry status endpoint includes FSM state per vehicle

## Commit

```bash
git add -A
git commit -m "feat(fsm): add Fleet Telemetry Connection FSM with stale detection

- Define 6 states: unknown → connecting → streaming → stale → disconnected / polling_only
- Create ConnectionFSM with batch recording and periodic timeout checks
- Integrate with telemetry handler signal processing pipeline
- Log transitions to fsm_transitions table
- Register in FSM debugger (backend + frontend state/color definitions)
- Publish connection state to MQTT for Home Assistant
- Emit notification events on stale/disconnected for alerting
- Add unit tests for all transition paths and timeout scenarios"
```

## What NOT To Change

- Do not modify the existing `VehicleStreamState` struct — the FSM wraps it, doesn't replace it
- Do not change the stale cleanup logic in telemetry_handler — the FSM adds tracking on top
- Do not modify other FSMs (vehicle, command, drive, charge, automation)
- Do not add new migrations — reuse the existing `fsm_transitions` table
- Do not change the telemetry ingestion path — just hook into it
