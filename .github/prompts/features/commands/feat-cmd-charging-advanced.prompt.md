---
description: "Add charge max range, charge standard, set charging amps, and close charge port commands"
---

# Feature: Advanced Charging Commands

## Overview

Add extended charging commands: max range mode, standard mode, set charging amps,
and close charge port. These extend the Charging group on the Commands page.

`set_charging_amps` is already in the Tesla client `commands` map but is missing from
the `allowedCommands` whitelist and the Commands page UI.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `charge_max_range` | `charge_max_range` | — | Set charge limit to max range |
| `charge_standard` | `charge_standard` | — | Set charge limit to standard/daily |
| `set_charging_amps` | `set_charging_amps` | `charging_amps: <int>` | Set charging amperage (e.g., 16, 32, 48) |
| `close_charge_port` | `charge_port_door_close` | — | Close the charge port door |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`, add the new entries (some already exist):

```go
// Charging (add these if not already present)
"charge_max_range": {endpoint: "charge_max_range"},
"charge_standard":  {endpoint: "charge_standard"},
// "set_charging_amps" already exists
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"charge_max_range":  true,
"charge_standard":   true,
"set_charging_amps": true,
"close_charge_port": true,
```

> **Note:** `close_charge_port` is already mapped via `charge_port_close` → `charge_port_door_close`
> in the `commands` map, but ensure the frontend command name matches the whitelist.

## Step 3 — Frontend: Extend Charging group

Update the "Charging" `CommandGroup` in `CommandsPage.tsx`:

```tsx
{/* Add to existing Charging group */}
<CommandButton
  icon={<Zap className="h-5 w-5" />}
  label={t('commands.charging.closePort', 'Charge Port')}
  sublabel={t('commands.charging.close', 'Close')}
  onClick={() => sendCmd('close_charge_port')}
  loading={cmd.isPending}
/>
<CommandButton
  icon={<BatteryFull className="h-5 w-5" />}
  label={t('commands.charging.maxRange', 'Max Range')}
  sublabel={t('commands.charging.tripMode', 'Trip mode')}
  onClick={() => sendCmd('charge_max_range')}
  loading={cmd.isPending}
  variant="danger"
/>
<CommandButton
  icon={<BatteryMedium className="h-5 w-5" />}
  label={t('commands.charging.standard', 'Standard')}
  sublabel={t('commands.charging.dailyMode', 'Daily mode')}
  onClick={() => sendCmd('charge_standard')}
  loading={cmd.isPending}
  variant="success"
/>
<CommandButton
  icon={<Gauge className="h-5 w-5" />}
  label={t('commands.charging.setAmps', 'Set Amps')}
  sublabel={t('commands.charging.amperage', 'Amperage')}
  onClick={() => {
    const amps = window.prompt(t('commands.charging.enterAmps', 'Enter charging amps (e.g., 16, 32, 48):'));
    if (amps) {
      cmd.mutate({ command: 'set_charging_amps', params: { charging_amps: amps } });
    }
  }}
  loading={cmd.isPending}
/>
```

Add lucide-react imports: `BatteryFull, BatteryMedium, Gauge`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "charge_max_range\|charge_standard\|set_charging_amps\|close_charge_port" internal/api/command_handler.go  # ≥ 4
```
