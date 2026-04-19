---
description: "Automation trigger: calendar — fires before/after upcoming calendar events synced to the vehicle"
---

# Trigger: Calendar

## Overview

Fires relative to upcoming calendar events synced to the vehicle. Requires the
`upcoming_calendar_entries` command to read calendar data. Useful for "30 min before
next meeting → Climate ON + Navigate to event location".

## Trigger Config Schema

```json
{
  "trigger_type": "calendar",
  "trigger_config": {
    "offset_minutes": -30,          // negative = before event, positive = after
    "event_filter": null,           // optional: regex to match event title
    "location_required": false,     // only fire if event has a location
    "include_navigation": true      // auto-send event location to vehicle nav
  }
}
```

## Implementation

Create `internal/automation/trigger/calendar.go`:

```go
type CalendarTrigger struct {
    repo        *database.AutomationRepo
    engine      AutomationEngine
    teslaClient *tesla.Client
}

// PollCalendar fetches upcoming calendar entries and schedules automation fires.
func (t *CalendarTrigger) PollCalendar(ctx context.Context, vehicleID int64, vin string) error

// Start runs a polling loop that checks calendar every 15 minutes.
func (t *CalendarTrigger) Start(ctx context.Context) error
```

**Logic:**
1. Periodically call `upcoming_calendar_entries` command to fetch events
2. For each event, calculate fire time = event_start + offset_minutes
3. If fire time is within the next polling window → schedule fire
4. Track which events have already been fired (by event ID + date) to prevent duplicates

## Trigger Snapshot

```json
{"event_title": "Team Standup", "event_start": "2026-04-18T10:00:00", "event_location": "123 Main St", "fire_time": "2026-04-18T09:30:00", "offset_minutes": -30}
```

## Tests

- Test fire 30 min before event
- Test event title filter (regex)
- Test location_required filter
- Test no double-fire for same event
- Test event without location

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v -run Calendar
```
