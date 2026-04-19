---
description: "Add guest mode and erase user data commands"
---

# Feature: Guest Mode Commands

## Overview

Add Guest Mode commands to the Security & Access group. Guest mode restricts certain UI
functions and enables QR code phone key setup for guests. `erase_user_data` clears
personal data from the touchscreen (requires guest mode and vehicle in park).

> **Note:** Guest Mode requires firmware 2024.14+.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `guest_mode` | `guest_mode` | `enable: bool` | Enable/disable guest mode |
| `erase_user_data` | `erase_user_data` | — | Erase user data from touchscreen (requires guest mode + parked) |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Guest Mode
"guest_mode_on":    {endpoint: "guest_mode", params: map[string]interface{}{"enable": true}},
"guest_mode_off":   {endpoint: "guest_mode", params: map[string]interface{}{"enable": false}},
"erase_user_data":  {endpoint: "erase_user_data"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"guest_mode_on":   true,
"guest_mode_off":  true,
"erase_user_data": true,
```

## Step 3 — Frontend: Add to Security & Access group

```tsx
{/* Add to Security & Access CommandGroup */}
<CommandButton
  icon={<UserPlus className="h-5 w-5" />}
  label={t('commands.security.guestMode', 'Guest Mode')}
  sublabel={t('commands.security.enable', 'Enable')}
  onClick={() => sendCmd('guest_mode_on')}
  loading={cmd.isPending}
/>
<CommandButton
  icon={<Eraser className="h-5 w-5" />}
  label={t('commands.security.eraseData', 'Erase Data')}
  sublabel={t('commands.security.guestOnly', 'Guest mode only')}
  onClick={() => {
    if (window.confirm(t('commands.security.confirmErase', 'This will erase all user data from the vehicle touchscreen. Continue?'))) {
      sendCmd('erase_user_data');
    }
  }}
  loading={cmd.isPending}
  variant="danger"
/>
```

Add lucide-react imports: `UserPlus, Eraser`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "guest_mode\|erase_user_data" internal/api/command_handler.go  # ≥ 3
```
