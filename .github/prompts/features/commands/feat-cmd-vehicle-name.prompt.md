---
description: "Add set vehicle name command"
---

# Feature: Set Vehicle Name Command

## Overview

Add the ability to rename a vehicle from the Commands page. This changes the
vehicle's display name on the touchscreen and in the Tesla app.

> **Note:** Not supported in guest mode. Requires Tesla Vehicle Command Protocol
> (signed commands via Vehicle Command Proxy).

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `set_vehicle_name` | `set_vehicle_name` | `vehicle_name: "<string>"` | Change the vehicle's display name |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Vehicle
"set_vehicle_name": {endpoint: "set_vehicle_name"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"set_vehicle_name": true,
```

## Step 3 — Frontend: Add "Rename" button

Add to the vehicle header area in `VehicleCommandCenter`, or as a new "Vehicle" group:

```tsx
<CommandButton
  icon={<Pencil className="h-5 w-5" />}
  label={t('commands.vehicle.rename', 'Rename')}
  sublabel={t('commands.vehicle.changeName', 'Change name')}
  onClick={() => {
    const name = window.prompt(
      t('commands.vehicle.enterName', 'Enter new vehicle name:'),
      vehicle.display_name
    );
    if (name && name.trim()) {
      cmd.mutate({ command: 'set_vehicle_name', params: { vehicle_name: name.trim() } });
    }
  }}
  loading={cmd.isPending}
/>
```

Add lucide-react imports: `Pencil`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "set_vehicle_name" internal/api/command_handler.go  # ≥ 1
```
