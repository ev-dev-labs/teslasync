---
description: "Automation trigger: cron/schedule-based — time of day, day of week, recurring, one-time"
---

# Trigger: Cron / Schedule

## Overview

Implement the cron/schedule trigger evaluator. This is the most common trigger type —
fires at a specific time, on specific days, with optional recurrence.

## Trigger Config Schema

```json
{
  "trigger_type": "cron",
  "trigger_config": {
    "cron_expr": "15 7 * * 1-5",       // standard 5-field cron (min hour dom mon dow)
    "timezone": "America/Los_Angeles",   // IANA timezone
    "one_time": false,                   // if true, auto-disable after first execution
    "one_time_date": "2026-05-01"        // for one-time: specific date
  }
}
```

## Implementation

Create `internal/automation/trigger/cron.go`:

```go
type CronTrigger struct {
    scheduler *cron.Cron  // robfig/cron/v3
    repo      *database.AutomationRepo
    engine    AutomationEngine  // interface to fire evaluation
}

// Start registers all enabled cron automations with the scheduler.
func (t *CronTrigger) Start(ctx context.Context) error

// Register adds a single automation to the scheduler.
func (t *CronTrigger) Register(automation *models.Automation) error

// Unregister removes an automation from the scheduler.
func (t *CronTrigger) Unregister(automationID int64)

// Reload re-reads all cron automations from DB and re-registers.
func (t *CronTrigger) Reload(ctx context.Context) error
```

Use `github.com/robfig/cron/v3` for cron parsing. Support:
- Standard 5-field cron: `15 7 * * 1-5` (7:15 AM weekdays)
- Predefined schedules: `@hourly`, `@daily`, `@weekly`
- Timezone via `cron.WithLocation()`

When cron fires, call `engine.Evaluate(automationID, triggerSnapshot)` where snapshot is:
```json
{"scheduled_time": "2026-04-18T07:15:00-07:00", "cron_expr": "15 7 * * 1-5"}
```

For one-time triggers, auto-disable the automation after successful execution.

## Dependencies

```bash
go get github.com/robfig/cron/v3
```

## Tests

- Test cron expression parsing
- Test timezone handling (fire at 7 AM Pacific, not UTC)
- Test one-time auto-disable
- Test register/unregister lifecycle
- Test reload from DB

## Verification

```bash
go build ./...
go test ./internal/automation/trigger/... -v
```
