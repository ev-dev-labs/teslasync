---
description: "Add media playback commands: play/pause, next/prev track, next/prev favorite, volume up/down"
---

# Feature: Media Playback Commands

## Overview

Add media control commands to the Commands page. These let users control their vehicle's
media player remotely — play/pause, skip tracks, skip favorites, and adjust volume.

## Tesla Fleet API Endpoints

| Command | Endpoint | Params | Description |
|---------|----------|--------|-------------|
| `media_toggle_playback` | `media_toggle_playback` | — | Toggle play/pause |
| `media_next_track` | `media_next_track` | — | Next track |
| `media_prev_track` | `media_prev_track` | — | Previous track |
| `media_next_fav` | `media_next_fav` | — | Next favorite |
| `media_prev_fav` | `media_prev_fav` | — | Previous favorite |
| `media_volume_up` | `adjust_volume` | `volume: <float>` | Volume up (increment +0.333) |
| `media_volume_down` | `media_volume_down` | — | Volume down one step |

> **Note:** `adjust_volume` accepts a float 0.0–11.0. For a simple "volume up" button,
> we cannot know the current volume level. Use `media_volume_down` for down and
> `adjust_volume` with a UI slider for precise control in a future iteration.
> For now, just wire `media_volume_down` as a simple button.

## Step 1 — Backend: Add to `commands` map

In `internal/tesla/client.go`, add to the `commands` map:

```go
// Media
"media_toggle_playback": {endpoint: "media_toggle_playback"},
"media_next_track":      {endpoint: "media_next_track"},
"media_prev_track":      {endpoint: "media_prev_track"},
"media_next_fav":        {endpoint: "media_next_fav"},
"media_prev_fav":        {endpoint: "media_prev_fav"},
"media_volume_down":     {endpoint: "media_volume_down"},
"adjust_volume":         {endpoint: "adjust_volume"},
```

## Step 2 — Backend: Add to `allowedCommands` whitelist

In `internal/api/command_handler.go`, add to `allowedCommands`:

```go
"media_toggle_playback": true,
"media_next_track":      true,
"media_prev_track":      true,
"media_next_fav":        true,
"media_prev_fav":        true,
"media_volume_down":     true,
"adjust_volume":         true,
```

## Step 3 — Frontend: Add "Media" command group to CommandsPage

In `web/src/features/system/pages/CommandsPage.tsx`, add a new `CommandGroup` inside the
`VehicleCommandCenter` component, after the "Alerts & Location" group:

```tsx
<CommandGroup title="Media" t={t}>
  <CommandButton
    icon={<Play className="h-5 w-5" />}
    label={t('commands.media.playPause', 'Play / Pause')}
    onClick={() => sendCmd('media_toggle_playback')}
    loading={cmd.isPending}
  />
  <CommandButton
    icon={<SkipBack className="h-5 w-5" />}
    label={t('commands.media.prevTrack', 'Prev Track')}
    onClick={() => sendCmd('media_prev_track')}
    loading={cmd.isPending}
  />
  <CommandButton
    icon={<SkipForward className="h-5 w-5" />}
    label={t('commands.media.nextTrack', 'Next Track')}
    onClick={() => sendCmd('media_next_track')}
    loading={cmd.isPending}
  />
  <CommandButton
    icon={<Heart className="h-5 w-5" />}
    label={t('commands.media.prevFav', 'Prev Favorite')}
    onClick={() => sendCmd('media_prev_fav')}
    loading={cmd.isPending}
  />
  <CommandButton
    icon={<Heart className="h-5 w-5" />}
    label={t('commands.media.nextFav', 'Next Favorite')}
    onClick={() => sendCmd('media_next_fav')}
    loading={cmd.isPending}
  />
  <CommandButton
    icon={<VolumeX className="h-5 w-5" />}
    label={t('commands.media.volumeDown', 'Volume Down')}
    onClick={() => sendCmd('media_volume_down')}
    loading={cmd.isPending}
  />
</CommandGroup>
```

Add these lucide-react imports: `Play, SkipForward, SkipBack, Heart, VolumeX`

## Verification

```bash
# Backend compiles
go build ./...

# Frontend TypeScript passes
cd web && npx tsc --noEmit

# New commands are in the whitelist
grep -c "media_" internal/api/command_handler.go   # should be ≥ 6
grep -c "media_" internal/tesla/client.go          # should be ≥ 6

# No violations
# Run: audit_code({ path: "web/src/features/system/pages/CommandsPage.tsx" })
```
