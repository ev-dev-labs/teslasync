---
description: "Add software update commands: schedule OTA update and cancel pending update"
---

# Feature: Software Update Commands

## Overview

Add software update management commands as a new "Software" group on the Commands page.
These let fleet managers schedule or cancel over-the-air (OTA) updates.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `schedule_software_update` | `schedule_software_update` | `offset_sec: <int>` | Schedule OTA install in N seconds (0 = immediately, 7200 = 2 hours) |
| `cancel_software_update` | `cancel_software_update` | — | Cancel pending OTA (won't work once installation has begun) |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Software Updates
"schedule_software_update": {endpoint: "schedule_software_update"},
"cancel_software_update":   {endpoint: "cancel_software_update"},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"schedule_software_update": true,
"cancel_software_update":   true,
```

## Step 3 — Frontend: Add "Software" command group

```tsx
<CommandGroup title="Software" t={t}>
  <CommandButton
    icon={<Download className="h-5 w-5" />}
    label={t('commands.software.scheduleUpdate', 'Schedule Update')}
    sublabel={t('commands.software.installNow', 'Install now')}
    onClick={() => {
      const minutes = window.prompt(
        t('commands.software.enterDelay', 'Install in how many minutes? (0 = now, 120 = 2 hours)'),
        '0'
      );
      if (minutes != null) {
        const secs = parseInt(minutes, 10) * 60;
        cmd.mutate({ command: 'schedule_software_update', params: { offset_sec: String(secs) } });
      }
    }}
    loading={cmd.isPending}
    variant="success"
  />
  <CommandButton
    icon={<XCircle className="h-5 w-5" />}
    label={t('commands.software.cancelUpdate', 'Cancel Update')}
    sublabel={t('commands.software.stopPending', 'Stop pending')}
    onClick={() => sendCmd('cancel_software_update')}
    loading={cmd.isPending}
    variant="danger"
  />
</CommandGroup>
```

Add lucide-react imports: `Download, XCircle`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "software_update" internal/api/command_handler.go  # ≥ 2
```
