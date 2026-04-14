---
description: "Upgrade FSM Debugger to support the new multi-FSM framework (vehicle, drive, charge, command, notification)"
---

# Feature: Upgrade FSM State Debugger for New FSM Framework

## Background

The codebase now has a comprehensive FSM framework with 5 state machines:

| FSM | Package | States | Purpose |
|-----|---------|--------|---------|
| **Vehicle** | `internal/fsm/` | online, driving, charging, parked, asleep, offline | Top-level vehicle lifecycle |
| **Drive Session** | `internal/fsm/drive/` | pending, active, ending, completed, recovered | Drive session lifecycle |
| **Charge Session** | `internal/fsm/charge/` | pending, active, completing, done, recovered | Charging session lifecycle |
| **Command Execution** | `internal/fsm/command/` | queued, waking, wake_confirmed, wake_timeout, sending, succeeded, failed, timed_out, retrying, gave_up | Vehicle command lifecycle |
| **Notification** | `internal/fsm/notification/` | Cooldown FSM + Delivery FSM | Alert notification delivery |

The current State Machine Debugger (`web/src/features/system/pages/StateMachineDebuggerPage.tsx`)
only shows `vehicle_state` transitions. It needs to be upgraded to visualize ALL 5 FSMs.

## Current State

### Backend (already working)
- `GET /fsm/stats` — returns transition counts grouped by `fsm_name`
- `GET /fsm/transitions` — returns paginated transitions filtered by `vehicle_id`, `fsm_type`, `hours`
- `FSMTransitionRepo.Query()` supports filtering by fsm_name
- All FSMs log to `fsm_transitions` table via `FSMTransitionRepo`

### Frontend (needs upgrade)
- `StateMachineDebuggerPage.tsx` — only shows vehicle_state, pie chart shows fsm_name not actual states
- `types/fsm.ts` — FSMType enum has stale values (`vehicle_lifecycle`, `charging_session`, `trip`, `export_job`)

## Implementation Plan

### Step 1: Update FSM type definitions

**File:** `web/src/types/fsm.ts`

Update `FSMType` to match actual `fsm_name` values in the database:
```typescript
export type FSMType =
  | 'all'
  | 'vehicle_state'
  | 'drive_session'
  | 'charge_session'
  | 'command_execution'
  | 'notification_delivery'
  | 'notification_cooldown';

export const FSM_TYPE_OPTIONS: { value: FSMType; label: string }[] = [
  { value: 'all', label: 'All FSMs' },
  { value: 'vehicle_state', label: 'Vehicle State' },
  { value: 'drive_session', label: 'Drive Sessions' },
  { value: 'charge_session', label: 'Charge Sessions' },
  { value: 'command_execution', label: 'Commands' },
  { value: 'notification_delivery', label: 'Notifications' },
];
```

### Step 2: Enhance State Machine Debugger page

**File:** `web/src/features/system/pages/StateMachineDebuggerPage.tsx`

#### 2a — Fix Transition Distribution pie chart
Currently shows `fsm_name` counts. Should show actual state distribution per selected FSM:
```typescript
// When FSM type is selected, show state distribution within that FSM
// When "All FSMs", show FSM type distribution
const pieData = useMemo(() => {
  if (fsmType === 'all') {
    // Show distribution by FSM type (deduplicated — no camelCase dupes)
    const seen = new Set<string>();
    return Object.entries(stats)
      .filter(([name]) => {
        if (seen.has(name) || (!name.includes('_') && stats[name.replace(/[A-Z]/g, m => '_' + m.toLowerCase())])) return false;
        seen.add(name);
        return true;
      })
      .map(([name, value], i) => ({ name, value, fill: CHART_COLORS[i % CHART_COLORS.length] }));
  }
  // Show state distribution within selected FSM
  const byState = new Map<string, number>();
  for (const tr of transitions) {
    byState.set(tr.to_state, (byState.get(tr.to_state) ?? 0) + 1);
  }
  return Array.from(byState.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({ name, value, fill: CHART_COLORS[i % CHART_COLORS.length] }));
}, [stats, transitions, fsmType]);
```

#### 2b — Add FSM state diagram visualization
For each FSM type, show a visual state diagram with:
- States as nodes (colored by current/active state)
- Transitions as arrows between nodes
- Transition counts on edges

Use the known state definitions:
```typescript
const FSM_STATES: Record<string, string[]> = {
  vehicle_state: ['online', 'driving', 'charging', 'parked', 'asleep', 'offline'],
  drive_session: ['pending', 'active', 'ending', 'completed', 'recovered'],
  charge_session: ['pending', 'active', 'completing', 'done', 'recovered'],
  command_execution: ['queued', 'waking', 'wake_confirmed', 'wake_timeout', 'sending', 'succeeded', 'failed', 'timed_out', 'retrying', 'gave_up'],
  notification_delivery: ['pending', 'sending', 'delivered', 'failed', 'retrying'],
};
```

Render as a horizontal flow diagram using SVG or simple flex layout with arrows.

#### 2c — Add Sub-FSM panel
When viewing vehicle_state transitions, show linked drive/charge sessions:
- "Active Drive" card showing drive FSM state (pending → active → ending → completed)
- "Active Charge" card showing charge FSM state

#### 2d — Add transition timeline chart
Stacked area or bar chart showing transitions over time per FSM:
```typescript
// Group transitions by hour, count per FSM type
// X-axis: time, Y-axis: transition count, color: FSM type
```

#### 2e — Enhance transition table
Add color-coded state badges with FSM-aware colors:
```typescript
const STATE_COLORS: Record<string, Record<string, string>> = {
  vehicle_state: { online: '#3b82f6', driving: '#10b981', charging: '#00f0ff', parked: '#8b5cf6', asleep: '#64748b', offline: '#374151' },
  drive_session: { pending: '#f59e0b', active: '#10b981', ending: '#ef4444', completed: '#6366f1', recovered: '#8b5cf6' },
  charge_session: { pending: '#f59e0b', active: '#00f0ff', completing: '#3b82f6', done: '#10b981', recovered: '#8b5cf6' },
  command_execution: { queued: '#64748b', waking: '#f59e0b', sending: '#3b82f6', succeeded: '#10b981', failed: '#ef4444', timed_out: '#f97316', retrying: '#a855f7', gave_up: '#dc2626' },
};
```

### Step 3: Add FSM health indicators

Add a "FSM Health" section at the top:
- **Flap Detection**: Flag when any FSM has >5 transitions in 1 minute
- **Stuck Detection**: Flag when a session FSM is in `pending` or `active` for >4 hours
- **Recovery Count**: Show how many sessions were recovered after pod restart

## Files to Modify

| File | Change |
|------|--------|
| `web/src/types/fsm.ts` | Update FSMType enum + options to match actual fsm_names |
| `web/src/features/system/pages/StateMachineDebuggerPage.tsx` | Pie chart fix, state diagram, sub-FSM panel, timeline chart, enhanced table |
| `web/src/api/hooks/useFSM.ts` | Add hooks for sub-FSM data if needed |

## Reference Files (read for context)

- `internal/fsm/state.go` — Vehicle FSM states + triggers
- `internal/fsm/drive/state.go` — Drive session states + events
- `internal/fsm/charge/state.go` — Charge session states + events
- `internal/fsm/command/machine.go` — Command execution states
- `internal/api/fsm_handler.go` — Backend FSM handler with Stats(), ProcessSignals()
- `internal/database/fsm_transition_repo.go` — Transition persistence + query
- `D:\repos\teslasync-old\web\src\pages\StateMachineDebugger.tsx` — Old page for reference

## Verification

```bash
cd web && npx tsc --noEmit

# FSM type dropdown should show: All FSMs, Vehicle State, Drive Sessions, Charge Sessions, Commands, Notifications
# Pie chart should show state distribution (not just "vehicle_state" repeated)
# Transition table should show color-coded from/to states per FSM type
# State diagram should visualize nodes + arrows for selected FSM
```

**COMPLETION DEFINITION:**
- [ ] FSMType enum updated to match actual DB values (vehicle_state, drive_session, charge_session, command_execution)
- [ ] Pie chart shows actual state distribution when a specific FSM is selected
- [ ] Pie chart shows FSM type distribution when "All FSMs" selected (no duplicates)
- [ ] Transition table has FSM-aware color-coded state badges
- [ ] State diagram section showing states + arrows for selected FSM type
- [ ] Sub-FSM panel showing active drive/charge context when viewing vehicle_state
- [ ] Transition timeline chart (transitions over time by FSM type)
- [ ] Flap detection + stuck session warnings
- [ ] TypeScript compiles clean
