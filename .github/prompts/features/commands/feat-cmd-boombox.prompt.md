---
description: "Add remote boombox command: play sounds through vehicle external speaker"
---

# Feature: Remote Boombox Command

## Overview

Add the Boombox command to the Commands page. This plays a sound through the vehicle's
external speaker (pedestrian warning speaker). Fun/utility feature.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `remote_boombox` | `remote_boombox` | `sound: <int>` | Play sound through external speaker |

### Sound IDs
- `0` — Random fart sound 💨
- `2000` — Locate ping 📍

> **Note:** The full list of sound IDs is not officially documented beyond these two.

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Boombox
"boombox_fart": {endpoint: "remote_boombox", params: map[string]interface{}{"sound": 0}},
"boombox_ping": {endpoint: "remote_boombox", params: map[string]interface{}{"sound": 2000}},
"remote_boombox": {endpoint: "remote_boombox"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"boombox_fart":   true,
"boombox_ping":   true,
"remote_boombox": true,
```

## Step 3 — Frontend: Add to Alerts & Location group

```tsx
{/* Add to Alerts & Location CommandGroup */}
<CommandButton
  icon={<Speaker className="h-5 w-5" />}
  label={t('commands.boombox.fart', 'Boombox')}
  sublabel={t('commands.boombox.randomFart', 'Random fart')}
  onClick={() => sendCmd('boombox_fart')}
  loading={cmd.isPending}
/>
<CommandButton
  icon={<Locate className="h-5 w-5" />}
  label={t('commands.boombox.ping', 'Locate Ping')}
  sublabel={t('commands.boombox.findCar', 'Find my car')}
  onClick={() => sendCmd('boombox_ping')}
  loading={cmd.isPending}
/>
```

Add lucide-react imports: `Speaker, Locate`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "boombox" internal/api/command_handler.go  # ≥ 2
```
