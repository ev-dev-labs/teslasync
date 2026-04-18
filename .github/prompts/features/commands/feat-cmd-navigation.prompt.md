---
description: "Add navigation commands: send address, GPS coordinates, supercharger destination"
---

# Feature: Navigation Commands

## Overview

Add navigation commands to the Commands page. These let users send destinations
to their vehicle's navigation system — addresses, GPS coordinates, or supercharger locations.

These commands require user input (address text, coordinates, or supercharger ID),
so each button should open a small modal or inline form to collect the parameter before sending.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `navigation_request` | `navigation_request` | `type: "share_ext_content_raw"`, `value: { "android.intent.extra.TEXT": "<address>" }`, `locale: "en-US"` | Send address to nav |
| `navigation_gps_request` | `navigation_gps_request` | `lat: <float>`, `lon: <float>`, `order: <int>` | Navigate to GPS coordinates |
| `navigation_sc_request` | `navigation_sc_request` | `id: <int>`, `order: <int>` | Navigate to supercharger by ID |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`, add to the `commands` map:

```go
// Navigation
"navigation_request":     {endpoint: "navigation_request"},
"navigation_gps_request": {endpoint: "navigation_gps_request"},
"navigation_sc_request":  {endpoint: "navigation_sc_request"},
```

## Step 2 — Backend: Add to `allowedCommands` whitelist

In `internal/api/command_handler.go`, add to `allowedCommands`:

```go
"navigation_request":     true,
"navigation_gps_request": true,
"navigation_sc_request":  true,
```

## Step 3 — Backend: Update `Params` type for complex params

The `SendCommand` function currently accepts `params map[string]string`. The `navigation_request`
command requires nested JSON (`value` is an object). The `commands` map already merges default
params as `map[string]interface{}`, so the user-provided `params` from the frontend need to be
passed through. Ensure the handler passes params correctly — the `body.Params` field type may
need to change from `map[string]string` to `map[string]interface{}` or the frontend should
send pre-formatted values.

**Approach:** Change the handler's `body.Params` to `map[string]interface{}` and update
`SendCommand` signature to accept `map[string]interface{}`. Alternatively, keep it simple
and have the frontend send the full value as a JSON string that the backend parses. Pick the
approach that requires fewer changes across existing commands.

## Step 4 — Frontend: Add "Navigation" command group to CommandsPage

The navigation commands need input fields. Create a simple inline form pattern:

```tsx
<CommandGroup title="Navigation" t={t}>
  <CommandButton
    icon={<Navigation className="h-5 w-5" />}
    label={t('commands.nav.sendAddress', 'Send Address')}
    sublabel={t('commands.nav.sendAddressSub', 'To vehicle nav')}
    onClick={() => {
      // Open a prompt/modal asking for the address
      const address = window.prompt(t('commands.nav.enterAddress', 'Enter destination address:'));
      if (address) {
        cmd.mutate({
          command: 'navigation_request',
          params: {
            type: 'share_ext_content_raw',
            value: { 'android.intent.extra.TEXT': address },
            locale: 'en-US',
          },
        });
      }
    }}
    loading={cmd.isPending}
  />
  <CommandButton
    icon={<MapPin className="h-5 w-5" />}
    label={t('commands.nav.sendGPS', 'Send GPS')}
    sublabel={t('commands.nav.coordinates', 'Lat/Lon')}
    onClick={() => {
      const lat = window.prompt(t('commands.nav.enterLat', 'Enter latitude:'));
      const lon = lat ? window.prompt(t('commands.nav.enterLon', 'Enter longitude:')) : null;
      if (lat && lon) {
        cmd.mutate({
          command: 'navigation_gps_request',
          params: { lat: parseFloat(lat), lon: parseFloat(lon), order: 0 },
        });
      }
    }}
    loading={cmd.isPending}
  />
</CommandGroup>
```

> **Note:** `window.prompt` is a temporary solution. A future iteration should replace it
> with a proper Modal or inline form using the shared `<Modal>` and `<Input>` components.
> The supercharger command (`navigation_sc_request`) requires a supercharger ID which isn't
> user-friendly — skip it for now or add it behind an "Advanced" toggle.

Add lucide-react imports: `Navigation`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "navigation_" internal/api/command_handler.go  # ≥ 2
grep -c "navigation_" internal/tesla/client.go         # ≥ 3
```
