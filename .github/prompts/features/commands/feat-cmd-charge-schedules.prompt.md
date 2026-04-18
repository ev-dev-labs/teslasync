---
description: "Add charge schedule and precondition schedule management commands"
---

# Feature: Charge & Precondition Schedules

## Overview

Add commands to manage vehicle charging and preconditioning schedules. These replace the
older `set_scheduled_departure` / `set_scheduled_charging` commands (deprecated in firmware 2024.26+).

These commands involve complex parameters (schedule objects), so the UI should provide
a simple form for creating schedules and a delete button for removing them.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `add_charge_schedule` | `add_charge_schedule` | Schedule object (see below) | Add/update a charging schedule |
| `remove_charge_schedule` | `remove_charge_schedule` | `id: <int>` | Remove a charging schedule by ID |
| `add_precondition_schedule` | `add_precondition_schedule` | Schedule object (see below) | Add/update a preconditioning schedule |
| `remove_precondition_schedule` | `remove_precondition_schedule` | `id: <int>` | Remove a preconditioning schedule by ID |

### Charge Schedule Object
```json
{
  "id": 0,
  "name": "Home",
  "days_of_week": 127,
  "start_enabled": true,
  "start_time": 360,
  "end_enabled": false,
  "end_time": 0,
  "one_time": false,
  "latitude": 37.394,
  "longitude": -122.15
}
```

- `days_of_week`: bitmask (Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64, all=127)
- `start_time` / `end_time`: minutes after midnight (360 = 6:00 AM)

### Precondition Schedule Object
```json
{
  "id": 0,
  "name": "Morning commute",
  "days_of_week": 31,
  "precondition_time": 420,
  "one_time": false,
  "latitude": 37.394,
  "longitude": -122.15
}
```

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Schedules
"add_charge_schedule":          {endpoint: "add_charge_schedule"},
"remove_charge_schedule":       {endpoint: "remove_charge_schedule"},
"add_precondition_schedule":    {endpoint: "add_precondition_schedule"},
"remove_precondition_schedule": {endpoint: "remove_precondition_schedule"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"add_charge_schedule":          true,
"remove_charge_schedule":       true,
"add_precondition_schedule":    true,
"remove_precondition_schedule": true,
```

## Step 3 — Frontend: Add "Schedules" command group

Add a new `CommandGroup` titled "Schedules" in `CommandsPage.tsx`.

For the MVP, provide a simple "Quick Charge Schedule" button that creates a default
schedule (charge at midnight, all days) and a remove button:

```tsx
<CommandGroup title="Schedules" t={t}>
  <CommandButton
    icon={<CalendarPlus className="h-5 w-5" />}
    label={t('commands.schedules.addCharge', 'Add Charge Schedule')}
    sublabel={t('commands.schedules.midnight', 'Midnight daily')}
    onClick={() => cmd.mutate({
      command: 'add_charge_schedule',
      params: {
        id: '0',
        name: 'Default',
        days_of_week: '127',
        start_enabled: 'true',
        start_time: '0',
        end_enabled: 'false',
        end_time: '0',
        one_time: 'false',
      },
    })}
    loading={cmd.isPending}
    variant="success"
  />
  <CommandButton
    icon={<CalendarMinus className="h-5 w-5" />}
    label={t('commands.schedules.removeCharge', 'Remove Schedule')}
    sublabel={t('commands.schedules.byId', 'By ID')}
    onClick={() => {
      const id = window.prompt(t('commands.schedules.enterScheduleId', 'Enter schedule ID to remove:'));
      if (id) cmd.mutate({ command: 'remove_charge_schedule', params: { id } });
    }}
    loading={cmd.isPending}
    variant="danger"
  />
  <CommandButton
    icon={<CalendarPlus className="h-5 w-5" />}
    label={t('commands.schedules.addPrecondition', 'Add Precondition')}
    sublabel={t('commands.schedules.morning', '7 AM daily')}
    onClick={() => cmd.mutate({
      command: 'add_precondition_schedule',
      params: {
        id: '0',
        name: 'Morning',
        days_of_week: '127',
        precondition_time: '420',
        one_time: 'false',
      },
    })}
    loading={cmd.isPending}
    variant="success"
  />
  <CommandButton
    icon={<CalendarMinus className="h-5 w-5" />}
    label={t('commands.schedules.removePrecondition', 'Remove Precondition')}
    sublabel={t('commands.schedules.byId', 'By ID')}
    onClick={() => {
      const id = window.prompt(t('commands.schedules.enterScheduleId', 'Enter schedule ID to remove:'));
      if (id) cmd.mutate({ command: 'remove_precondition_schedule', params: { id } });
    }}
    loading={cmd.isPending}
    variant="danger"
  />
</CommandGroup>
```

> **Future iteration:** Build a proper schedule form with day-of-week checkboxes,
> time picker, and location input. For MVP, the quick-create defaults are sufficient.

Add lucide-react imports: `CalendarPlus, CalendarMinus`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "charge_schedule\|precondition_schedule" internal/api/command_handler.go  # ≥ 4
```
