---
description: "Automation trigger: battery level — fires when battery crosses a threshold"
---

# Trigger: Battery Level

## Overview

Fires when vehicle battery level crosses a threshold (above, below, or reaches exact value).
Listens to vehicle state changes via MQTT or polling.

## Trigger Config Schema

```json
{
  "trigger_type": "battery",
  "trigger_config": {
    "operator": "below",          // "above", "below", "reaches", "changes_by"
    "threshold": 20,              // percentage (0-100)
    "delta": null,                // for "changes_by": fire when level changes by N%
    "direction": "any"            // for "changes_by": "up", "down", "any"
  }
}
```

## Implementation

Create `internal/automation/trigger/battery.go`:

```go
type BatteryTrigger struct {
    repo    *database.AutomationRepo
    engine  AutomationEngine
    lastLevels sync.Map  // vehicleID → last known battery level
}

// Evaluate checks if the battery state change should fire any automations.
func (t *BatteryTrigger) Evaluate(vehicleID int64, currentLevel float64) []int64
```

**Logic:**
- `below`: fire when `previousLevel >= threshold && currentLevel < threshold` (crossing downward)
- `above`: fire when `previousLevel <= threshold && currentLevel > threshold` (crossing upward)
- `reaches`: fire when `currentLevel == threshold` (exact match)
- `changes_by`: fire when `abs(currentLevel - previousLevel) >= delta`

**Important:** Only fire on **transitions** (crossing the threshold), not continuously while below/above.
Track `lastLevels` per vehicle to detect crossings.

## Integration

Subscribe to MQTT topic `teslasync/{vin}/battery_level` or hook into the vehicle state
update path in the worker. When battery level updates, call `BatteryTrigger.Evaluate()`.

## Trigger Snapshot

```json
{"vehicle_id": 1, "battery_level": 19, "previous_level": 21, "threshold": 20, "operator": "below"}
```

## Tests

- Test crossing downward (21→19 with threshold 20 → fires)
- Test already below (18→17 with threshold 20 → does NOT fire)
- Test crossing upward (79→81 with threshold 80 → fires)
- Test exact reach (79→80 with threshold 80 → fires)
- Test changes_by (50→58 with delta 5 → fires)
- Test no trigger on same level

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v -run Battery
```
