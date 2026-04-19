---
description: "Add seat heating/cooling and steering wheel heat commands"
---

# Feature: Seat & Steering Wheel Climate Commands

## Overview

Add seat heater, seat cooler, and steering wheel heater commands to the Climate & Comfort
group on the Commands page. These require climate/preconditioning to be active first.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `remote_seat_heater_request` | `remote_seat_heater_request` | `heater: 0-5`, `level: 0-3` | Set seat heater level (0=driver, 1=passenger, 2=rear-left, 4=rear-center, 5=rear-right) |
| `remote_seat_cooler_request` | `remote_seat_cooler_request` | `seat_position: 0-5`, `seat_cooler_level: 0-3` | Set seat cooler level |
| `remote_auto_seat_climate_request` | `remote_auto_seat_climate_request` | `auto_seat_position: 0-5`, `auto_climate_on: bool` | Toggle auto seat climate |
| `remote_steering_wheel_heater_request` | `remote_steering_wheel_heater_request` | `on: bool` | Toggle steering wheel heater (older vehicles) |
| `remote_steering_wheel_heat_level_request` | `remote_steering_wheel_heat_level_request` | `level: 0-3` | Set steering wheel heat level (newer vehicles) |
| `remote_auto_steering_wheel_heat_climate_request` | `remote_auto_steering_wheel_heat_climate_request` | `on: bool` | Toggle auto steering wheel heat |

### Seat Position Map
```
0 = Front-Left (Driver)
1 = Front-Right (Passenger)
2 = Rear-Left
3 = Rear-Center (not always available)
4 = Rear-Center
5 = Rear-Right
```

### Heat/Cool Levels
```
0 = Off
1 = Low
2 = Medium
3 = High
```

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Seat Climate
"seat_heater":          {endpoint: "remote_seat_heater_request"},
"seat_cooler":          {endpoint: "remote_seat_cooler_request"},
"auto_seat_climate":    {endpoint: "remote_auto_seat_climate_request"},
"steering_wheel_heat":  {endpoint: "remote_steering_wheel_heater_request"},
"steering_wheel_level": {endpoint: "remote_steering_wheel_heat_level_request"},
"auto_steering_heat":   {endpoint: "remote_auto_steering_wheel_heat_climate_request"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"seat_heater":          true,
"seat_cooler":          true,
"auto_seat_climate":    true,
"steering_wheel_heat":  true,
"steering_wheel_level": true,
"auto_steering_heat":   true,
```

## Step 3 — Frontend: Add to Climate & Comfort group

Expand the "Climate & Comfort" group in `CommandsPage.tsx`. Seat heat/cool buttons should
show driver seat by default. For the MVP, add simple toggle buttons:

```tsx
{/* Inside Climate & Comfort CommandGroup */}
<CommandButton
  icon={<Flame className="h-5 w-5" />}
  label={t('commands.climate.seatHeat', 'Seat Heat')}
  sublabel={t('commands.climate.driver', 'Driver')}
  onClick={() => cmd.mutate({
    command: 'seat_heater',
    params: { heater: '0', level: '3' },
  })}
  loading={cmd.isPending}
/>
<CommandButton
  icon={<Snowflake className="h-5 w-5" />}
  label={t('commands.climate.seatCool', 'Seat Cool')}
  sublabel={t('commands.climate.driver', 'Driver')}
  onClick={() => cmd.mutate({
    command: 'seat_cooler',
    params: { seat_position: '0', seat_cooler_level: '3' },
  })}
  loading={cmd.isPending}
/>
<CommandButton
  icon={<CircleDot className="h-5 w-5" />}
  label={t('commands.climate.steeringHeat', 'Steering Heat')}
  sublabel={t('commands.climate.toggle', 'Toggle')}
  onClick={() => cmd.mutate({
    command: 'steering_wheel_heat',
    params: { on: 'true' },
  })}
  loading={cmd.isPending}
/>
```

> **Future iteration:** Add a seat map UI where users can tap individual seats and
> adjust heat/cool levels with +/- controls. For MVP, driver seat high heat is sufficient.

Add lucide-react imports: `Flame, Snowflake, CircleDot`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "seat_heater\|seat_cooler\|steering_wheel" internal/api/command_handler.go  # ≥ 4
grep -c "seat_heater\|seat_cooler\|steering_wheel" internal/tesla/client.go         # ≥ 4
```
