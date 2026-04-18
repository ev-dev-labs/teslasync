---
description: "Add speed limit commands: set limit MPH, clear PIN, and admin clear PIN"
---

# Feature: Speed Limit Extended Commands

## Overview

Extend the existing Speed Limit commands with the ability to set a specific speed limit,
clear the speed limit PIN, and admin-clear the PIN. The basic activate/deactivate
commands already exist.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `speed_limit_set_limit` | `speed_limit_set_limit` | `limit_mph: <int>` | Set max speed in MPH (50–90) |
| `speed_limit_clear_pin` | `speed_limit_clear_pin` | `pin: "NNNN"` | Clear speed limit PIN |
| `speed_limit_clear_pin_admin` | `speed_limit_clear_pin_admin` | — | Admin clear speed limit PIN (firmware 2023.38+) |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Speed Limit (extended)
"speed_limit_set_limit":      {endpoint: "speed_limit_set_limit"},
"speed_limit_clear_pin":      {endpoint: "speed_limit_clear_pin"},
"speed_limit_clear_pin_admin": {endpoint: "speed_limit_clear_pin_admin"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"speed_limit_set_limit":       true,
"speed_limit_clear_pin":       true,
"speed_limit_clear_pin_admin": true,
```

## Step 3 — Frontend: Update Speed Limit in Security & Access group

Replace or extend the existing "Speed Limit" button with more granular controls:

```tsx
{/* Replace existing Speed Limit button */}
<CommandButton
  icon={<GaugeCircle className="h-5 w-5" />}
  label={t('commands.security.speedLimit', 'Speed Limit')}
  sublabel={t('commands.security.setMph', 'Set MPH')}
  onClick={() => {
    const mph = window.prompt(t('commands.security.enterSpeedLimit', 'Enter speed limit (50-90 MPH):'));
    if (mph) {
      const val = parseInt(mph, 10);
      if (val >= 50 && val <= 90) {
        cmd.mutate({ command: 'speed_limit_set_limit', params: { limit_mph: mph } });
      }
    }
  }}
  loading={cmd.isPending}
  variant="danger"
/>
<CommandButton
  icon={<GaugeCircle className="h-5 w-5" />}
  label={t('commands.security.speedActivate', 'Activate')}
  sublabel={t('commands.security.speedLimitMode', 'Speed Limit')}
  onClick={() => {
    const pin = window.prompt(t('commands.security.enterSpeedPin', 'Enter 4-digit PIN:'));
    if (pin && pin.length === 4) {
      cmd.mutate({ command: 'speed_limit_on', params: { pin } });
    }
  }}
  loading={cmd.isPending}
  variant="danger"
/>
<CommandButton
  icon={<GaugeCircle className="h-5 w-5" />}
  label={t('commands.security.speedDeactivate', 'Deactivate')}
  sublabel={t('commands.security.speedLimitMode', 'Speed Limit')}
  onClick={() => {
    const pin = window.prompt(t('commands.security.enterSpeedPin', 'Enter 4-digit PIN:'));
    if (pin && pin.length === 4) {
      cmd.mutate({ command: 'speed_limit_off', params: { pin } });
    }
  }}
  loading={cmd.isPending}
/>
```

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "speed_limit" internal/api/command_handler.go  # ≥ 3 new entries
```
