---
description: "Add sunroof control command: vent, close, and stop"
---

# Feature: Sunroof Control Command

## Overview

Add sunroof control to the Commands page. Only available on vehicles equipped with
a panoramic sunroof. Supports three states: vent, close, and stop.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `sun_roof_control` | `sun_roof_control` | `state: "vent"\|"close"\|"stop"` | Control sunroof position |

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`:

```go
// Sunroof
"sunroof_vent":  {endpoint: "sun_roof_control", params: map[string]interface{}{"state": "vent"}},
"sunroof_close": {endpoint: "sun_roof_control", params: map[string]interface{}{"state": "close"}},
"sunroof_stop":  {endpoint: "sun_roof_control", params: map[string]interface{}{"state": "stop"}},
```

## Step 2 — Backend: Add to `allowedCommands`

In `internal/api/command_handler.go`:

```go
"sunroof_vent":  true,
"sunroof_close": true,
"sunroof_stop":  true,
```

## Step 3 — Frontend: Add to Doors & Trunk group (or new "Windows & Roof" group)

```tsx
{/* Add to Doors & Trunk CommandGroup or create a new "Windows & Roof" group */}
<CommandButton
  icon={<ArrowUpFromDot className="h-5 w-5" />}
  label={t('commands.sunroof.vent', 'Sunroof')}
  sublabel={t('commands.sunroof.ventAction', 'Vent')}
  onClick={() => sendCmd('sunroof_vent')}
  loading={cmd.isPending}
/>
<CommandButton
  icon={<ArrowDownToDot className="h-5 w-5" />}
  label={t('commands.sunroof.close', 'Sunroof')}
  sublabel={t('commands.sunroof.closeAction', 'Close')}
  onClick={() => sendCmd('sunroof_close')}
  loading={cmd.isPending}
/>
```

Add lucide-react imports: `ArrowUpFromDot, ArrowDownToDot`

## Verification

```bash
go build ./...
cd web && npx tsc --noEmit

grep -c "sunroof" internal/api/command_handler.go  # ≥ 3
```
