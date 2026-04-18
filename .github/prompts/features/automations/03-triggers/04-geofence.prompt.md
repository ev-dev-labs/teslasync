---
description: "Automation trigger: geofence — fires when vehicle enters or leaves a geofence zone"
---

# Trigger: Geofence

## Overview

Fires when a vehicle enters or leaves a defined geofence zone. Uses the existing
geofence infrastructure in TeslaSync (geofences table + position tracking).

## Trigger Config Schema

```json
{
  "trigger_type": "geofence",
  "trigger_config": {
    "geofence_id": 5,           // reference to existing geofence
    "event": "enter",           // "enter", "leave", "both"
    "dwell_minutes": 0          // optional: only fire after dwelling N minutes inside
  }
}
```

## Implementation

Create `internal/automation/trigger/geofence.go`:

```go
type GeofenceTrigger struct {
    repo          *database.AutomationRepo
    geofenceRepo  *database.GeofenceRepo
    engine        AutomationEngine
    vehicleInside sync.Map  // vehicleID:geofenceID → bool (tracks current state)
}

// OnPositionUpdate is called when a vehicle's position updates.
func (t *GeofenceTrigger) OnPositionUpdate(vehicleID int64, lat, lon float64)
```

**Logic:**
1. Get all geofences for the vehicle
2. Check if position is inside each geofence (haversine distance < radius)
3. Compare with previous state (was inside/outside)
4. If state changed → check automations with matching geofence_id + event
5. For `dwell_minutes > 0`: start a timer on enter, only fire after dwell period

## Integration

Hook into the position update path in the vehicle worker/poller. When new position
data arrives, call `GeofenceTrigger.OnPositionUpdate()`.

## Trigger Snapshot

```json
{"vehicle_id": 1, "geofence_id": 5, "geofence_name": "Home", "event": "enter", "lat": 37.394, "lon": -122.15}
```

## Tests

- Test enter fires when crossing into geofence
- Test leave fires when crossing out
- Test no fire when staying inside
- Test dwell timer (enter + wait N min → fire)
- Test multiple geofences for same vehicle

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v -run Geofence
```
