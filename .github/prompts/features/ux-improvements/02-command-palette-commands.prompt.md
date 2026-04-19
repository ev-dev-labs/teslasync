---
description: "Add vehicle commands to the CommandPalette (Cmd+K) for keyboard power users"
---

# Add Vehicle Commands to CommandPalette

## Problem

The `CommandPalette` component (Cmd+K) currently only supports **page navigation**.
Power users can't quickly send vehicle commands (lock, climate, horn) from the keyboard
without navigating to the Commands page and clicking tiles.

## Current State

```
web/src/components/ui/CommandPalette.tsx — navigation-only, uses navSections
web/src/components/layout/Layout.tsx:510 — mounted in layout
```

The CommandPalette already has:
- Cmd/Ctrl+K keybinding ✅
- Fuzzy search filtering ✅
- Arrow key navigation ✅
- Enter to execute ✅
- Section grouping ✅

Missing:
- Vehicle commands as searchable items
- Command execution (mutation) from palette
- Vehicle selector when multiple vehicles
- Recent commands section

## Task

### Step 1: Extend Command Items to Support Actions

Currently, palette items only navigate (`useNavigate`). Add support for action callbacks:

```typescript
interface PaletteItem {
  id: string;
  label: string;
  section: string;
  icon?: React.ReactNode;
  action: () => void;          // navigate OR execute command
  keywords?: string[];         // extra search terms
  shortcut?: string;           // display shortcut hint
  type?: 'navigate' | 'command';
}
```

### Step 2: Add Vehicle Command Items

When the palette opens, include vehicle commands alongside navigation items:

```typescript
const commandItems: PaletteItem[] = [
  {
    id: 'cmd-lock',
    label: 'Lock Vehicle',
    section: 'Vehicle Commands',
    icon: <Lock className="h-4 w-4" />,
    keywords: ['lock', 'security', 'doors'],
    type: 'command',
    action: () => sendCommand(vehicleId, 'lock'),
  },
  {
    id: 'cmd-unlock',
    label: 'Unlock Vehicle',
    section: 'Vehicle Commands',
    icon: <Unlock className="h-4 w-4" />,
    keywords: ['unlock', 'open', 'doors'],
    type: 'command',
    action: () => sendCommand(vehicleId, 'unlock'),
  },
  // ... common commands: climate_on/off, horn, flash_lights, frunk, trunk,
  // sentry_on/off, wake_up, start_charge, stop_charge
];
```

Only include **safe, common commands** in the palette (no Erase Data, no PIN commands).
About 15-20 commands that don't require input parameters.

### Step 3: Vehicle Selector

If user has multiple vehicles, show a vehicle picker before executing:
- If 1 vehicle: execute immediately
- If 2+ vehicles: show sub-menu with vehicle names, then execute

### Step 4: Recent Commands Section

Track the last 5 executed commands in sessionStorage and show them at the top
of the palette as a "Recent" section when no search query is entered.

### Step 5: Visual Distinction

Style command items differently from navigation items:
- Navigation items: default text color
- Command items: neon accent color with a ⚡ or 🔧 badge
- Show a small "sends to {vehicle name}" sublabel on command items

### Step 6: Command Execution Integration

The palette needs access to the command mutation. Options:
- Pass `sendCommand` function via context
- Create a `useCommandPalette` hook that wraps the palette with command dispatch
- Use the existing `request()` client directly

Preferred: Create a `useVehicleCommand()` hook that the palette and Commands page
both use for command execution. This avoids duplicating the mutation logic.

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Cmd+K opens palette with both navigation and command items
- [ ] Typing "lock" shows Lock/Unlock commands
- [ ] Executing a command sends the API call and shows toast
- [ ] Recent commands appear when palette opens with empty search
- [ ] Multi-vehicle users see a vehicle picker before execution

## Commit

```bash
git add -A
git commit -m "feat(web): add vehicle commands to CommandPalette (Cmd+K)

- Extend PaletteItem to support command actions alongside navigation
- Add 15-20 common vehicle commands as palette items
- Add vehicle selector for multi-vehicle fleets
- Add recent commands section (sessionStorage)
- Create shared useVehicleCommand hook for command execution"
```
