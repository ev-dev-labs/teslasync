# Remote vehicle commands

TeslaSync exposes **65 unique Tesla Fleet API command endpoints** plus a set of
convenience aliases. This page is the user-facing reference. The implementation
source of truth is `internal/tesla/client_commands.go`.

## How a command is sent

```
Frontend → POST /api/v1/vehicles/{vin}/command
          { "command": "<name>", "params": { ... } }
              │
              ▼
       internal/tesla/client_commands.go::SendCommand
              │
       ┌──────┴──────┐
       │             │
   noProxy=true    noProxy=false  AND  commandProxyURL is set
       │             │
       ▼             ▼
  Fleet API     Vehicle Command Proxy ── signs ─► Fleet API
  (wake_up)
```

- **`wake_up`** always goes directly to Fleet API — it does not require signing.
- **Every other command** is routed through the Vehicle Command Proxy when
  one is configured (set `VEHICLE_COMMAND_PROXY_URL`). The proxy signs the
  request with your partner key for vehicles that require it (Model 3/Y from
  2021+, Model S/X refresh, Cybertruck).
- If no proxy is configured, the command is sent directly. This works only for
  vehicles that don't require signing.

## API surface

```
POST /api/v1/vehicles/{vin}/command
Content-Type: application/json

{ "command": "set_charge_limit", "params": { "percent": 80 } }
```

Successful responses return the Tesla envelope `{"response": {"result": true}}`
verbatim. On failure, the API returns a non-2xx with `{"error": "...", "details": "..."}`.

## Command catalog

### Wake (1)

| Frontend name | Tesla endpoint | Notes |
|---|---|---|
| `wake` / `wake_up` | `wake_up` | Direct to Fleet API — never proxied |

### Security & access (10)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `lock` | `door_lock` | |
| `unlock` | `door_unlock` | |
| `set_sentry_mode` | `set_sentry_mode` | `on: true` |
| `sentry_on` / `sentry_off` | `set_sentry_mode` | `on` set accordingly |
| `speed_limit_on` | `speed_limit_activate` | |
| `speed_limit_off` | `speed_limit_deactivate` | |
| `speed_limit_set_limit` | `speed_limit_set_limit` | `{ "limit_mph": <num> }` |
| `speed_limit_clear_pin` | `speed_limit_clear_pin` | `{ "pin": "<4-digit>" }` |
| `speed_limit_clear_pin_admin` | `speed_limit_clear_pin_admin` | |
| `guest_mode_on` / `guest_mode_off` | `guest_mode` | `enable` true/false |
| `erase_user_data` | `erase_user_data` | Destructive — confirm in UI |

### Valet & PIN-to-drive (5)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `valet_on` / `valet_off` | `set_valet_mode` | `on` true/false |
| `set_valet_mode` | `set_valet_mode` | `{ "on": <bool>, "password": "<4-digit>" }` |
| `reset_valet_pin` | `reset_valet_pin` | |
| `set_pin_to_drive` | `set_pin_to_drive` | `{ "on": <bool>, "password": "<4-digit>" }` |
| `reset_pin_to_drive_pin` | `reset_pin_to_drive_pin` | |
| `clear_pin_to_drive_admin` | `clear_pin_to_drive_admin` | |

### Climate (3)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `climate_on` | `auto_conditioning_start` | |
| `climate_off` | `auto_conditioning_stop` | |
| `set_temps` | `set_temps` | `{ "driver_temp": <°C>, "passenger_temp": <°C> }` |

### Seat & steering heat (6)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `seat_heater` | `remote_seat_heater_request` | `{ "heater": 0..5, "level": 0..3 }` |
| `seat_cooler` | `remote_seat_cooler_request` | `{ "seat_position": 0..5, "seat_cooler_level": 0..3 }` |
| `auto_seat_climate` | `remote_auto_seat_climate_request` | `{ "auto_seat_position": 0..5, "auto_climate_on": <bool> }` |
| `steering_wheel_heat` | `remote_steering_wheel_heater_request` | `{ "on": <bool> }` |
| `steering_wheel_level` | `remote_steering_wheel_heat_level_request` | `{ "level": 0..3 }` |
| `auto_steering_heat` | `remote_auto_steering_wheel_heat_climate_request` | `{ "on": <bool> }` |

### Climate protection (7)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `bioweapon_on` / `bioweapon_off` | `set_bioweapon_mode` | `on` + `manual_override` |
| `cop_on` | `set_cabin_overheat_protection` | `{ "on": true, "fan_only": false }` |
| `cop_fan_only` | `set_cabin_overheat_protection` | `{ "on": true, "fan_only": true }` |
| `cop_off` | `set_cabin_overheat_protection` | `{ "on": false, "fan_only": false }` |
| `set_cop_temp` | `set_cop_temp` | `{ "cop_activation_temp": 0..2 }` |
| `climate_keeper_off` | `set_climate_keeper_mode` | `climate_keeper_mode: 0` |
| `climate_keeper_on` | `set_climate_keeper_mode` | `climate_keeper_mode: 1` (Keep) |
| `dog_mode` | `set_climate_keeper_mode` | `climate_keeper_mode: 2` |
| `camp_mode` | `set_climate_keeper_mode` | `climate_keeper_mode: 3` |
| `preconditioning_max` | `set_preconditioning_max` | `{ "on": true }` |
| `preconditioning_reset` | `set_preconditioning_max` | `{ "on": false }` |

### Charging (8)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `open_charge_port` / `charge_port_open` | `charge_port_door_open` | |
| `close_charge_port` / `charge_port_close` | `charge_port_door_close` | |
| `charge_start` | `charge_start` | |
| `charge_stop` | `charge_stop` | |
| `set_charge_limit` | `set_charge_limit` | `{ "percent": 50..100 }` |
| `set_charging_amps` | `set_charging_amps` | `{ "charging_amps": <num> }` |
| `charge_max_range` | `charge_max_range` | |
| `charge_standard` | `charge_standard` | |

### Trunk & frunk (1 endpoint, 2 directions)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `actuate_frunk` / `frunk` / `frunk_open` | `actuate_trunk` | `which_trunk: "front"` |
| `actuate_trunk` / `trunk_open` | `actuate_trunk` | `which_trunk: "rear"` |

### Alerts (2)

| Frontend name | Tesla endpoint |
|---|---|
| `honk_horn` / `honk` | `honk_horn` |
| `flash_lights` / `flash` | `flash_lights` |

### Boombox (1 endpoint)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `boombox_fart` | `remote_boombox` | `sound: 0` |
| `boombox_ping` | `remote_boombox` | `sound: 2000` |
| `remote_boombox` | `remote_boombox` | `{ "sound": <id> }` |

### Windows & sunroof (2)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `vent_windows` | `window_control` | `command: "vent"` |
| `close_windows` | `window_control` | `command: "close"` |
| `sunroof_vent` | `sun_roof_control` | `state: "vent"` |
| `sunroof_close` | `sun_roof_control` | `state: "close"` |
| `sunroof_stop` | `sun_roof_control` | `state: "stop"` |

### HomeLink (1)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `trigger_homelink` | `trigger_homelink` | `{ "lat": <°>, "lon": <°> }` |

### Remote start (1)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `remote_start_drive` | `remote_start_drive` | `{ "password": "<account-password>" }` |

### Media (7)

| Frontend name | Tesla endpoint |
|---|---|
| `media_toggle_playback` | `media_toggle_playback` |
| `media_next_track` | `media_next_track` |
| `media_prev_track` | `media_prev_track` |
| `media_next_fav` | `media_next_fav` |
| `media_prev_fav` | `media_prev_fav` |
| `media_volume_down` | `media_volume_down` |
| `adjust_volume` | `adjust_volume` (`{ "volume": 0..11 }`) |

### Charge & precondition schedules (6)

Two generations of scheduling APIs:

| Frontend name | Tesla endpoint | Notes |
|---|---|---|
| `set_scheduled_departure` | `set_scheduled_departure` | Legacy (pre-2024.26) |
| `set_scheduled_charging` | `set_scheduled_charging` | Legacy (pre-2024.26) |
| `add_charge_schedule` | `add_charge_schedule` | 2024.26+ |
| `remove_charge_schedule` | `remove_charge_schedule` | 2024.26+ |
| `add_precondition_schedule` | `add_precondition_schedule` | 2024.26+ |
| `remove_precondition_schedule` | `remove_precondition_schedule` | 2024.26+ |

### Navigation (3)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `navigation_request` | `navigation_request` | `{ "type": "share_ext_content_raw", "value": { "android.intent.extra.TEXT": "<addr>" }, "locale": "en-US" }` |
| `navigation_gps_request` | `navigation_gps_request` | `{ "lat": <°>, "lon": <°>, "order": 1 }` |
| `navigation_sc_request` | `navigation_sc_request` | `{ "id": <supercharger_id>, "order": 1 }` |

### Software updates (2)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `schedule_software_update` | `schedule_software_update` | `{ "offset_sec": <s> }` |
| `cancel_software_update` | `cancel_software_update` | |

### Vehicle metadata (1)

| Frontend name | Tesla endpoint | Default params |
|---|---|---|
| `set_vehicle_name` | `set_vehicle_name` | `{ "vehicle_name": "<text>" }` |

## Validating a command name

The automation action executor uses `tesla.IsKnownCommand(name)` at parse time
to reject unknown commands before saving the rule. This means a typo in an
automation surfaces immediately, not at firing time.

## Where commands appear in the UI

- **Vehicle Detail** — single-vehicle action bar (most common commands)
- **Dashboard widgets** — quick actions for charging / climate / sentry
- **Command palette** (Cmd/Ctrl+K) — search by command name
- **Alert Studio** — alert rules can trigger commands as a response
- **Automations** — multi-step automations chain commands together
- **Admin → Dev Tools → Fleet API** — raw command sender + history

## Notes

- **Rate limits.** Tesla applies per-vehicle rate limits. TeslaSync's client
  obeys a local rate-limiter; rejected requests get back pressure with a
  clear error rather than silent drops.
- **Tracing.** Every command emits an OpenTelemetry span with
  `tesla.vehicle.vin` and `tesla.command` attributes. View in Jaeger
  when the `tracing` profile is enabled.
- **Audit.** Every command goes through `logCallback`, which writes to the
  API logs table — visible at **Admin → API Logs**.
- **Adding a new command.** Add an entry to the `commands` map in
  `internal/tesla/client_commands.go` and the corresponding Tesla endpoint
  becomes available to the rest of the stack (UI, automations, alerts).
  `IsKnownCommand` is the validation surface; no other code needs to change.
