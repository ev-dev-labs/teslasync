---
description: "Automations UI: create/edit builder page with trigger, condition, and action configurators"
---

# Page: Automation Builder

## Overview
Create `web/src/features/automations/pages/AutomationBuilderPage.tsx` — form for creating and editing automations.

## Layout
```
┌─ Create Automation ──────────────────────────────────────┐
│ Name: [Morning Commute Prep                        ]     │
│ Description: [Prepare car for morning commute      ]     │
│ Vehicle: [Falcon ▼] or [All Vehicles]                    │
│                                                          │
│ ── WHEN (Trigger) ─────────────────────────────────────  │
│ Type: [Schedule ▼]                                       │
│ ┌─ Trigger Config (dynamic per type) ────────────────┐   │
│ │ Cron: Time [07:15] Days [☑M ☑T ☑W ☑T ☑F ☐S ☐S]  │   │
│ │ Timezone: [America/Los_Angeles ▼]                  │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ ── ONLY IF (Conditions) ─── optional ────────────────── │
│ [+ Add Condition]                                        │
│ 1. [State Check ▼] battery_level [<] [40]    [🗑]       │
│ 2. [Time Window ▼] 06:00 - 09:00            [🗑]       │
│                                                          │
│ ── THEN (Actions) ─────────────────────────────────────  │
│ 1. [Command ▼] [climate_on ▼] {}             [🗑] [↕]  │
│ 2. [Wait    ▼] [10] seconds                  [🗑] [↕]  │
│ 3. [Command ▼] [seat_heater ▼] {heater:0}   [🗑] [↕]  │
│ 4. [Notify  ▼] "Car is warming up"           [🗑] [↕]  │
│ [+ Add Action]                                           │
│                                                          │
│ ── OPTIONS ──────────────────────────────────────────── │
│ ☑ Notify on each run    ☑ Notify on failure              │
│ ☐ Stop on first failure                                  │
│ Cooldown: [30] minutes   Priority: [50]                  │
│                                                          │
│ ⚠ Conflict: "Night Security" sends unlock at 10:05 PM   │
│                                                          │
│ [Save]  [Test Run]  [Cancel]                             │
│                                                          │
│ ── OR START FROM PRESET ─────────────────────────────── │
│ [Browse Presets Gallery →]                                │
└──────────────────────────────────────────────────────────┘
```

## Components
- **TriggerConfigurator** — dynamic form per trigger type (cron → time/day picker, battery → threshold slider, geofence → geofence dropdown, etc.)
- **ConditionBuilder** — add/remove condition rows, each with type dropdown and type-specific fields
- **ActionBuilder** — ordered list with drag-to-reorder, add/remove, type-specific config per action
- **CommandPicker** — dropdown of all 80+ commands grouped by category, with param fields
- **ConflictWarnings** — yellow alert showing detected conflicts

## Dynamic trigger configs
Each trigger type renders different form fields:
- `cron` → time picker + day checkboxes + timezone
- `battery` → threshold slider + operator dropdown
- `vehicle_state` → event dropdown
- `geofence` → geofence selector + enter/leave toggle
- `mqtt` → topic input + payload match
- `webhook` → shows generated URL + copy button
- `sunrise_sunset` → event toggle + offset slider
- `energy` → site selector + event + threshold
- `calendar` → offset slider + event filter

## Route
```typescript
const AutomationBuilderPage = lazy(() => import('./features/automations/pages/AutomationBuilderPage'));
<Route path="/automations/new" element={<AutomationBuilderPage />} />
<Route path="/automations/:id/edit" element={<AutomationBuilderPage />} />
```

## Verification
```bash
cd web && npx tsc --noEmit
```
