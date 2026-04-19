---
description: "Add PIN to Drive commands: set PIN, reset PIN, and clear PIN (admin)"
---

# Feature: PIN to Drive Commands

## Overview

Add PIN to Drive management commands to the Security & Access group. These allow
fleet managers to set, reset, and clear the PIN required before driving.

> **Note:** `set_pin_to_drive` and `reset_pin_to_drive_pin` require the Tesla Vehicle
> Command Protocol (signed commands via Vehicle Command Proxy). `clear_pin_to_drive_admin`
> requires firmware 2023.44+ and fleet manager/owner access.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `set_pin_to_drive` | `set_pin_to_drive` | `on: bool`, `password: "NNNN"` | Enable/disable PIN to Drive with a 4-digit PIN |
| `reset_pin_to_drive_pin` | `reset_pin_to_drive_pin` | — | Remove PIN (must not be in valet mode, PIN to Drive must be inactive) |
| `clear_pin_to_drive_admin` | `clear_pin_to_drive_admin` | — | Admin deactivate + reset PIN (firmware 2023.44+) |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// PIN to Drive
"set_pin_to_drive":         {endpoint: "set_pin_to_drive"},
"reset_pin_to_drive_pin":   {endpoint: "reset_pin_to_drive_pin"},
"clear_pin_to_drive_admin": {endpoint: "clear_pin_to_drive_admin"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"set_pin_to_drive":         true,
"reset_pin_to_drive_pin":   true,
"clear_pin_to_drive_admin": true,
```

## Step 3 — Frontend: Add to Security & Access group

```tsx
{/* Add to Security & Access CommandGroup */}
<CommandButton
  icon={<KeyRound className="h-5 w-5" />}
  label={t('commands.security.pinToDrive', 'PIN to Drive')}
  sublabel={t('commands.security.enable', 'Enable')}
  onClick={() => {
    const pin = window.prompt(t('commands.security.enterPin', 'Enter 4-digit PIN:'));
    if (pin && pin.length === 4) {
      cmd.mutate({ command: 'set_pin_to_drive', params: { on: 'true', password: pin } });
    }
  }}
  loading={cmd.isPending}
  variant="danger"
/>
<CommandButton
  icon={<KeyRound className="h-5 w-5" />}
  label={t('commands.security.clearPin', 'Clear PIN')}
  sublabel={t('commands.security.admin', 'Admin')}
  onClick={() => sendCmd('clear_pin_to_drive_admin')}
  loading={cmd.isPending}
  variant="danger"
/>
```

Add lucide-react imports: `KeyRound`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "pin_to_drive" internal/api/command_handler.go  # ≥ 3
```
