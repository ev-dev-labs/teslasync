---
description: "Full redesign of StateMachineDebuggerPage → FSM Debugger with real-time transition log, state distribution, and context viewer"
---

# Feature: FSM Debugger UI — Full Redesign of StateMachineDebuggerPage

## Context

The FSM (Finite State Machine) system tracks vehicle state transitions (online→driving→parked→asleep,
charge sessions, drive sessions, commands, notifications). The backend has:

- **FSM package:** `internal/fsm/` with drive, charge, command, notification sub-FSMs
- **DB table:** `fsm_transitions` (migration 000045) — stores every transition with trigger, signals, context
- **API endpoints (v0.31.0):**
  - `GET /fsm/stats` — FSM enabled flag + state counts
  - `GET /fsm/transitions?vehicle_id=X&fsm_type=Y&hours=H&page=P&per_page=N` — paginated transition log
- **Repository:** `internal/database/fsm_transition_repo.go` — `Query()` method with filtering

**Problem:** The current refactored `StateMachineDebuggerPage.tsx` (405 lines) is a basic stats view.
The plan calls for a full debugger with transition timeline, filtering, context viewer, and charts.

## Backend — Verify/Restore Endpoints

### Step 0: Check if FSM routes exist in refactored router.go

```bash
grep -n "fsm\|FSM\|transition" internal/api/router.go
```

**If `/fsm/stats` and `/fsm/transitions` are NOT registered:**

The endpoints existed in v0.31.0 (router.go lines 411-465). They need to be restored in the
refactored router. The endpoints are:

```go
// In router.go, inside the /api/v1 group:
r.Route("/fsm", func(r chi.Router) {
    r.Get("/stats", /* FSM stats handler */)
    r.Get("/transitions", /* paginated transition query */)
})
```

The transition query endpoint accepts:
- `vehicle_id` (required) — which vehicle
- `fsm_type` (optional) — filter by: vehicle, drive_session, charge_session, alert_cooldown, notification, command
- `hours` (optional, default 1) — time range lookback
- `page` (optional, default 1) — pagination
- `per_page` (optional, default 50) — rows per page

Returns: `{ data: Transition[], total: number, page: number, per_page: number }`

**Also check these files exist in refactored repo:**
```bash
ls internal/fsm/
ls internal/database/fsm_transition_repo.go
ls migrations/000045_fsm_transitions.up.sql
```

If missing, copy from v0.31.0 (`D:\repos\teslasync-old`).

## Frontend — Types

### Step 1: Create FSM types

Create `web/src/types/fsm.ts`:

```typescript
export interface FSMTransition {
  id: number;
  vehicle_id: number;
  fsm_type: string;          // 'vehicle' | 'drive_session' | 'charge_session' | 'alert_cooldown' | 'notification' | 'command'
  from_state: string;
  to_state: string;
  trigger: string;
  guard_result?: string;
  signals?: Record<string, unknown>;
  context_snapshot?: Record<string, unknown>;
  instance_id?: string;      // drive/charge session ID
  duration_ms?: number;
  created_at: string;
}

export interface FSMStats {
  enabled: boolean;
  stats: Record<string, number>;   // state → count
}

export interface FSMTransitionResponse {
  data: FSMTransition[];
  total: number;
  page: number;
  per_page: number;
}

export type FSMType = 'all' | 'vehicle' | 'drive_session' | 'charge_session' | 'alert_cooldown' | 'notification' | 'command';

export const FSM_TYPE_OPTIONS: { value: FSMType; label: string }[] = [
  { value: 'all', label: 'All FSMs' },
  { value: 'vehicle', label: 'Vehicle State' },
  { value: 'drive_session', label: 'Drive Sessions' },
  { value: 'charge_session', label: 'Charge Sessions' },
  { value: 'alert_cooldown', label: 'Alert Cooldowns' },
  { value: 'notification', label: 'Notifications' },
  { value: 'command', label: 'Commands' },
];
```

## Frontend — Hooks

### Step 2: Create FSM hooks

Add to `web/src/api/hooks/useTelemetry.ts` or create `web/src/api/hooks/useFSM.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import type { FSMStats, FSMTransitionResponse, FSMType } from '@/types/fsm';

export const fsmKeys = {
  stats: ['fsm-stats'] as const,
  transitions: (vehicleId: number, fsmType: string, hours: number, page: number, perPage: number) =>
    ['fsm-transitions', vehicleId, fsmType, hours, page, perPage] as const,
};

export function useFSMStats() {
  return useQuery({
    queryKey: fsmKeys.stats,
    queryFn: () => request<FSMStats>('/fsm/stats'),
    refetchInterval: 10_000,
  });
}

export function useFSMTransitions(
  vehicleId: number,
  fsmType: FSMType,
  hours: number,
  page: number,
  perPage: number,
) {
  const typeParam = fsmType === 'all' ? '' : `&fsm_type=${fsmType}`;
  return useQuery({
    queryKey: fsmKeys.transitions(vehicleId, fsmType, hours, page, perPage),
    queryFn: () => request<FSMTransitionResponse>(
      `/fsm/transitions?vehicle_id=${vehicleId}&hours=${hours}&page=${page}&per_page=${perPage}${typeParam}`
    ),
    enabled: vehicleId > 0,
    refetchInterval: 10_000,
  });
}
```

## Frontend — Shared Components

### Step 3: Create FSM-specific shared components

Create in `web/src/components/data-display/`:

**FSMBadge.tsx** — color-coded badge for FSM type:
```typescript
import { Badge } from '@/components/ui';

const FSM_COLORS: Record<string, { variant: 'cyan' | 'green' | 'amber' | 'purple' | 'blue' | 'red'; label: string }> = {
  vehicle: { variant: 'cyan', label: 'Vehicle' },
  drive_session: { variant: 'green', label: 'Drive' },
  charge_session: { variant: 'amber', label: 'Charge' },
  alert_cooldown: { variant: 'purple', label: 'Alert' },
  notification: { variant: 'blue', label: 'Notification' },
  command: { variant: 'red', label: 'Command' },
};

export function FSMBadge({ type }: { type: string }) {
  const config = FSM_COLORS[type] ?? { variant: 'cyan' as const, label: type };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
```

**TransitionArrow.tsx** — "from → to" display:
```typescript
export function TransitionArrow({ from, to }: { from: string; to: string }) {
  return (
    <span className="font-mono text-xs">
      <span className="text-white/50">{from}</span>
      <span className="text-white/30 mx-1">→</span>
      <span className="text-white/90">{to}</span>
    </span>
  );
}
```

Add both to `components/data-display/index.ts` barrel.

## Frontend — Page Redesign

### Step 4: Rewrite StateMachineDebuggerPage

Rewrite `web/src/features/system/pages/StateMachineDebuggerPage.tsx` with this layout:

**Section 1 — Header + Filters**
- Vehicle selector (from `useVehicles`)
- FSM Type dropdown (All FSMs, Vehicle, Drive, Charge, Alert, Notification, Command)
- Date range with quick presets (1h, 6h, 24h, 7d)
- Rows per page selector + Query button

**Section 2 — Current State Badge**
- Shows current vehicle state: "● ONLINE Since: Apr 12, 2026, 03:13 AM"

**Section 3 — State Distribution (PieChart) + Transition Counts (table)**
- Left: PieChart showing time in each state or FSM type distribution
- Right: Small table with FSM type, count, avg duration

**Section 4 — Transition Timeline (DataTable with pagination)**
- Columns: #, Time, FSM Type (FSMBadge), From→To (TransitionArrow), Trigger, Duration
- Pagination with DataTable `pagination` prop
- Click row → expands to show `context_snapshot` as formatted JSON
- Flap detection: rows with >5 transitions of same FSM in 1 minute highlighted with amber border

**Section 5 — Context Detail (expandable JSON viewer)**
- Shows when a transition row is clicked
- Formatted JSON of the `context_snapshot` and `signals` fields

### Default Behavior
- Default time range: last 1 hour
- Default FSM type: All FSMs
- Default rows per page: 50
- Auto-refresh: every 10 seconds
- Vehicle: first vehicle from list

## Engineering Rules

```
✅ Import from @/components/{category}/ barrels
✅ Use TanStack Query hooks (useFSMStats, useFSMTransitions)
✅ Use useTranslation() for all strings
✅ PageContainer wrapper with loading/error
✅ Every section always shows (EmptyState when no transitions)
✅ Tailwind CSS only (no inline styles with var(--)
✅ Use DataTable with pagination prop
✅ Use fmtNumber/fmtInt for numeric display
✅ Use cn() for conditional classes (not clsx)
❌ DO NOT revert to old code — build fresh with new architecture
❌ DO NOT hardcode vehicleId — use vehicle selector
❌ DO NOT import from 'recharts' — use @/components/charts
```

## Verification

```bash
cd web
npx tsc --noEmit

wc -l src/features/system/pages/StateMachineDebuggerPage.tsx
# Target: 500+ lines (currently 405, needs expansion)

# Verify hooks exist
grep -n "useFSMStats\|useFSMTransitions" src/api/hooks/*.ts

# Verify shared components
grep -n "FSMBadge\|TransitionArrow" src/components/data-display/index.ts

# Violations check
grep -c "from 'recharts'" src/features/system/pages/StateMachineDebuggerPage.tsx  # must be 0
grep -c "empty={" src/features/system/pages/StateMachineDebuggerPage.tsx  # must be 0
grep -c "style={{" src/features/system/pages/StateMachineDebuggerPage.tsx  # should be 0
```

**COMPLETION DEFINITION:**
- [ ] FSM types created in `web/src/types/fsm.ts`
- [ ] `useFSMStats` + `useFSMTransitions` hooks created
- [ ] `FSMBadge` + `TransitionArrow` shared components created + exported
- [ ] Backend `/fsm/stats` and `/fsm/transitions` endpoints verified/restored
- [ ] Page has: vehicle selector, FSM type filter, date range, quick presets
- [ ] Page has: current state badge, state distribution chart, transition counts
- [ ] Page has: transition timeline DataTable with pagination + expandable context
- [ ] Auto-refresh every 10 seconds
- [ ] All strings use i18n
- [ ] TypeScript compiles clean
- [ ] Zero violations (inline styles, raw HTML, direct imports, empty={})
