---
description: "Automation trigger: energy/Powerwall — fires on solar production, battery level, grid status changes"
---

# Trigger: Energy / Powerwall

## Overview

Fires based on Powerwall/Solar energy events. Requires the Tesla energy endpoints
to be implemented (see `features/tesla-api/feat-tesla-energy-*` prompts).

## Trigger Config Schema

```json
{
  "trigger_type": "energy",
  "trigger_config": {
    "energy_site_id": 12345,
    "event": "solar_above",        // see event list
    "threshold": 5000,             // watts (for power events) or percent (for battery)
    "operator": "above"            // "above", "below", "reaches", "changes_to"
  }
}
```

### Supported Events

| Event | Description | Unit |
|-------|-------------|------|
| `solar_above` | Solar production exceeds threshold | watts |
| `solar_below` | Solar production drops below threshold | watts |
| `battery_above` | Powerwall battery above % | percent |
| `battery_below` | Powerwall battery below % | percent |
| `grid_outage` | Grid status changes to Islanded | — |
| `grid_restored` | Grid status returns to Active | — |
| `storm_mode_activated` | Storm mode turns on | — |
| `storm_mode_deactivated` | Storm mode turns off | — |
| `exporting_to_grid` | Battery exporting power to grid | — |

## Implementation

Create `internal/automation/trigger/energy.go`:

```go
type EnergyTrigger struct {
    repo   *database.AutomationRepo
    engine AutomationEngine
    lastState sync.Map  // siteID → last known energy state
}

// OnEnergyUpdate is called when energy live status updates.
func (t *EnergyTrigger) OnEnergyUpdate(siteID int64, status *models.TeslaEnergyLiveStatus)
```

Same crossing/transition logic as battery trigger — only fire when threshold is crossed,
not while continuously above/below.

## Trigger Snapshot

```json
{"energy_site_id": 12345, "event": "solar_above", "solar_power": 5200, "threshold": 5000, "previous_solar": 4800}
```

## Tests

- Test solar threshold crossing
- Test grid outage/restore detection
- Test battery level crossing
- Test no fire when staying above threshold

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v -run Energy
```
