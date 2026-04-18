---
description: "Automation trigger: sunrise/sunset — fires relative to solar events based on vehicle or home location"
---

# Trigger: Sunrise / Sunset

## Overview

Fires at or relative to sunrise/sunset times. Useful for "30 min before sunset → Sentry ON"
or "At sunrise → Climate OFF". Calculates solar times based on the vehicle's home location
or a configured lat/lon.

## Trigger Config Schema

```json
{
  "trigger_type": "sunrise_sunset",
  "trigger_config": {
    "event": "sunset",             // "sunrise" or "sunset"
    "offset_minutes": -30,          // negative = before, positive = after
    "latitude": 37.394,            // location for calculation (or null to use vehicle's home)
    "longitude": -122.15,
    "days_of_week": [1,2,3,4,5]    // optional: 0=Sun, 1=Mon, ..., 6=Sat. null = every day
  }
}
```

## Implementation

Create `internal/automation/trigger/sunrise_sunset.go`:

```go
type SunriseSunsetTrigger struct {
    repo   *database.AutomationRepo
    engine AutomationEngine
}

// CalculateNextFiring returns the next fire time for a sunrise/sunset automation.
func (t *SunriseSunsetTrigger) CalculateNextFiring(config SunriseSunsetConfig, now time.Time) time.Time

// Start runs a goroutine that checks every minute for automations that should fire.
func (t *SunriseSunsetTrigger) Start(ctx context.Context) error
```

Use a sunrise/sunset calculation library or implement the solar position algorithm:
- `github.com/nathan-osman/go-sunrise` or similar
- Input: lat, lon, date → output: sunrise time, sunset time
- Apply offset_minutes to get the actual fire time

**Scheduler approach:** Every minute, calculate today's sunrise/sunset for each automation,
check if current time matches (within 1-minute window), and fire if so.

## Trigger Snapshot

```json
{"event": "sunset", "offset_minutes": -30, "solar_time": "19:45:00", "fire_time": "19:15:00", "lat": 37.394, "lon": -122.15}
```

## Tests

- Test sunrise calculation for known location/date
- Test offset calculation (30 min before sunset)
- Test day-of-week filter
- Test location fallback to vehicle home geofence

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v -run SunriseSunset
```
