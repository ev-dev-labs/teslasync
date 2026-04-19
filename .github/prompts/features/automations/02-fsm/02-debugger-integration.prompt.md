---
description: "Automations FSM: register in FSM debugger with states, edges, and badge colors"
---

# Automations: FSM Debugger Integration

## Overview

Register the automation FSM in the FSM debugger so it appears in the state machine
dropdown with full transition timeline, state diagram, and filtering.

## Backend: Log transitions

The automation FSM (from `02-fsm/01-state-machine`) already calls `FSMTransitionRepo.Insert()`
with `fsm_type = "automation"`. Ensure the `fsm_instance_id` is set to the `automation_history.id`
(the specific execution run), so the debugger can show per-execution timelines.

## Frontend: Update `web/src/types/fsm.ts`

### Add to FSMType union
```typescript
export type FSMType =
  | 'all'
  | 'vehicle'
  | 'drive_session'
  | 'charge_session'
  | 'command'
  | 'notification'
  | 'alert_cooldown'
  | 'automation';  // ← ADD
```

### Add to FSM_TYPE_OPTIONS
```typescript
{ value: 'automation', label: 'Automations' },
```

### Add to FSM_STATES
```typescript
automation: [
  'idle', 'evaluating', 'executing', 'succeeded', 'partial',
  'failed', 'retrying', 'gave_up', 'skipped', 'cooldown', 'disabled'
],
```

### Add to FSM_EDGES
```typescript
automation: [
  ['idle', 'evaluating'],
  ['evaluating', 'executing'], ['evaluating', 'skipped'],
  ['executing', 'succeeded'], ['executing', 'partial'], ['executing', 'failed'],
  ['failed', 'retrying'],
  ['retrying', 'executing'], ['retrying', 'gave_up'],
  ['succeeded', 'cooldown'], ['succeeded', 'idle'],
  ['partial', 'cooldown'], ['partial', 'idle'],
  ['gave_up', 'idle'], ['gave_up', 'disabled'],
  ['skipped', 'idle'],
  ['cooldown', 'idle'],
  ['disabled', 'idle'],
],
```

## Frontend: Update FSMBadge component

In `web/src/components/data-display/FSMBadge.tsx`, add color for automation type:
```typescript
automation: 'bg-purple-500/20 text-purple-400 border-purple-500/30'
```

## Frontend: Update StateBadge colors

Add automation state colors:
```typescript
// automation states
idle: 'text-white/50',
evaluating: 'text-neon-cyan',
executing: 'text-neon-amber',
succeeded: 'text-neon-green',
partial: 'text-neon-amber',
failed: 'text-neon-red',
retrying: 'text-neon-amber',
gave_up: 'text-neon-red',
skipped: 'text-white/30',
cooldown: 'text-neon-purple',
disabled: 'text-neon-red/50',
```

## Verification

```bash
cd web && npx tsc --noEmit
grep -n "automation" web/src/types/fsm.ts        # type + options + states + edges
grep -n "automation" web/src/components/data-display/FSMBadge.tsx  # badge color
```
