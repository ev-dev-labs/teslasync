---
description: "Add HomeLink (garage door) trigger command"
---

# Feature: HomeLink Command

## Overview

Add HomeLink command to the Commands page. This triggers a HomeLink-paired garage door
opener. Requires the vehicle's current GPS coordinates and HomeLink hardware.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `trigger_homelink` | `trigger_homelink` | `lat: <float>`, `lon: <float>` | Trigger HomeLink (open/close garage door) |

> **Note:** The vehicle must be near the paired HomeLink location. The `lat`/`lon` params
> should match the vehicle's current position. If the vehicle is not equipped with HomeLink,
> the command returns `not_supported`.

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// HomeLink
"trigger_homelink": {endpoint: "trigger_homelink"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"trigger_homelink": true,
```

## Step 3 — Frontend: Add "HomeLink" button

Add to an appropriate group (Alerts & Location or a new "Home" group):

```tsx
<CommandButton
  icon={<Home className="h-5 w-5" />}
  label={t('commands.homelink.trigger', 'HomeLink')}
  sublabel={t('commands.homelink.garage', 'Garage door')}
  onClick={() => {
    // Ideally use the vehicle's last known lat/lon from state
    // For MVP, use a simple prompt or the vehicle's stored location
    const lat = window.prompt(t('commands.homelink.enterLat', 'Enter vehicle latitude:'));
    const lon = lat ? window.prompt(t('commands.homelink.enterLon', 'Enter vehicle longitude:')) : null;
    if (lat && lon) {
      cmd.mutate({ command: 'trigger_homelink', params: { lat, lon } });
    }
  }}
  loading={cmd.isPending}
/>
```

> **Future iteration:** Auto-fill lat/lon from the vehicle's last known position
> (available in vehicle state data). This eliminates the need for manual input.

Add lucide-react imports: `Home`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "trigger_homelink" internal/api/command_handler.go  # ≥ 1
```
