---
description: "Add window control with lat/lon safety and sunroof commands to the Commands page"
---

# Feature: Windows & Sunroof Commands

## Overview

The basic vent/close window commands already exist in the Tesla client but the
Commands page currently doesn't expose them. Add window vent/close buttons and
ensure the `close` command includes the required `lat`/`lon` safety params
(required for non-M3 platform vehicles).

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `window_control` (vent) | `window_control` | `command: "vent"`, `lat: 0`, `lon: 0` | Vent all windows |
| `window_control` (close) | `window_control` | `command: "close"`, `lat: <float>`, `lon: <float>` | Close all windows (lat/lon for user proximity check on non-M3) |

## Step 1 — Backend: Verify existing commands

The commands `vent_windows` and `close_windows` already exist in `client.go`.
Ensure they are in `allowedCommands`:

```go
"vent_windows":  true,
"close_windows": true,
```

## Step 2 — Frontend: Add "Windows" group to CommandsPage

```tsx
<CommandGroup title="Windows" t={t}>
  <CommandButton
    icon={<Wind className="h-5 w-5" />}
    label={t('commands.windows.vent', 'Vent Windows')}
    onClick={() => sendCmd('vent_windows')}
    loading={cmd.isPending}
  />
  <CommandButton
    icon={<X className="h-5 w-5" />}
    label={t('commands.windows.close', 'Close Windows')}
    onClick={() => sendCmd('close_windows')}
    loading={cmd.isPending}
  />
</CommandGroup>
```

> **Note on lat/lon for close:** The backend `close_windows` command currently sends
> `{command: "close"}` without lat/lon. For non-M3 vehicles, Tesla requires the user's
> lat/lon to verify proximity. A future iteration should either:
> 1. Pass the vehicle's last known position as lat/lon, or
> 2. Use the browser's Geolocation API to get the user's position.
> For now, the command will work on M3+ platform vehicles without lat/lon.

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "vent_windows\|close_windows" internal/api/command_handler.go  # ≥ 2
```
