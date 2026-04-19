---
description: "Add valet mode commands: enable with PIN, disable, and reset valet PIN"
---

# Feature: Valet Mode Commands

## Overview

Add Valet Mode management to the Security & Access group. Valet mode limits the
vehicle's top speed, locks the glovebox and frunk, and disables personal data on screen.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `set_valet_mode` | `set_valet_mode` | `on: bool`, `password: "NNNN"` | Enable valet mode with 4-digit PIN |
| `reset_valet_pin` | `reset_valet_pin` | — | Reset valet PIN (must disable valet mode first) |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Valet Mode
"valet_on":        {endpoint: "set_valet_mode", params: map[string]interface{}{"on": true}},
"valet_off":       {endpoint: "set_valet_mode", params: map[string]interface{}{"on": false}},
"set_valet_mode":  {endpoint: "set_valet_mode"},
"reset_valet_pin": {endpoint: "reset_valet_pin"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"valet_on":        true,
"valet_off":       true,
"set_valet_mode":  true,
"reset_valet_pin": true,
```

## Step 3 — Frontend: Add to Security & Access group

```tsx
{/* Add to Security & Access CommandGroup */}
<CommandButton
  icon={<UserCheck className="h-5 w-5" />}
  label={t('commands.security.valetMode', 'Valet Mode')}
  sublabel={t('commands.security.enable', 'Enable')}
  onClick={() => {
    const pin = window.prompt(t('commands.security.enterValetPin', 'Enter 4-digit valet PIN:'));
    if (pin && pin.length === 4) {
      cmd.mutate({ command: 'set_valet_mode', params: { on: 'true', password: pin } });
    }
  }}
  loading={cmd.isPending}
  variant="danger"
/>
<CommandButton
  icon={<UserX className="h-5 w-5" />}
  label={t('commands.security.valetOff', 'Valet Off')}
  onClick={() => sendCmd('valet_off')}
  loading={cmd.isPending}
/>
```

Add lucide-react imports: `UserCheck, UserX`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "valet" internal/api/command_handler.go  # ≥ 3
```
