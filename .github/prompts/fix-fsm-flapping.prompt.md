---
description: "Fix FSM state flapping — Driving↔Online oscillation caused by SpeedZero+GuardNoGear on Fleet Telemetry vehicles"
---

# Fix: FSM State Flapping — Driving↔Online Rapid Oscillation

## Problem (Validated by Signal Replay)

Replaying 804K real production signals (14 days, 36x speed) revealed **severe state flapping**:

```
09:18  driving → online → driving → online → driving → online  (6 transitions in 1 minute)
11:18  driving → online → driving → online → driving → online  (6 transitions in 2 minutes)
11:57  driving → parked → driving → parked → online             (5 transitions in 2 minutes)
```

This creates:
- 49 state transitions where prod likely had ~15
- 7 micro-drives (some 0 distance, 0.2 min duration)
- Noisy vehicle_states table
- Incorrect drive session boundaries

## Root Cause

**Transition rule (transition.go line 49):**
```go
{Driving, Online, TriggerSpeedZero, GuardNoGear, Debounced, "GuardNoGear"}
```

**Guard (guards.go line 17-18):**
```go
func GuardNoGear(ctx *SignalContext) bool {
    return !ctx.IsGearCapable  // true if vehicle has NEVER received Gear signal
}
```

**The bug:** Fleet Telemetry sends `Gear` signal only on CHANGE (delta streaming). During
a 2-hour highway drive, there's ONE `Gear=D` at the start, then silence. The vehicle IS
gear-capable (70 Gear signals in our 14-day export), but between Gear signals, every
`VehicleSpeed=0` (red light, traffic) triggers:

1. `TriggerSpeedZero` fires
2. `GuardNoGear` checks `IsGearCapable` → true (vehicle HAS received Gear before)
3. Guard returns false → transition BLOCKED ✅

**But wait — that should work!** Let me check if `isGearCapable` is being persisted correctly...

The issue is likely: **`isGearCapable` resets when the API restarts** (it's an in-memory flag
on the `VehicleFSM` struct). After restart, the flag is `false` until the first `Gear` signal
arrives. During that window, every `SpeedZero` triggers `Driving→Online`.

## Investigation Steps

```bash
# 1. Check if isGearCapable is loaded from DB on startup
grep -n "isGearCapable\|SetGearCapable\|gear_capable" internal/fsm/machine.go internal/api/fsm_handler.go internal/api/telemetry_handler.go

# 2. Check if it's stored in vehicle_live_state or vehicles table
grep -n "gear_capable\|is_gear_capable" internal/database/live_state_repo.go internal/database/vehicle_repo.go

# 3. Check the vehicle_live_state schema
docker exec teslasync-postgres psql -U teslasync -c "\d vehicle_live_state" | grep gear
```

## Fix Options

### Option A: Persist `isGearCapable` in DB (Best)

1. Add `is_gear_capable BOOLEAN DEFAULT FALSE` to `vehicles` table
2. When first `Gear` signal arrives, set it to `true` in DB
3. On startup/FSM creation, load from DB: `fsm.SetGearCapable(vehicle.IsGearCapable)`
4. After restart, the flag is immediately correct — no flapping window

```sql
-- Migration
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_gear_capable BOOLEAN NOT NULL DEFAULT FALSE;
```

```go
// In FSM handler, when creating/restoring FSM for a vehicle:
func (h *FSMHandler) getOrCreate(ctx context.Context, vehicleID int64) *fsm.VehicleFSM {
    // ... existing code ...
    // Load persisted gear capability
    vehicle, _ := h.vehicleRepo.GetByID(ctx, vehicleID)
    if vehicle != nil && vehicle.IsGearCapable {
        m.SetGearCapable(true)
    }
    return m
}

// When Gear signal first arrives:
func (h *FSMHandler) ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]interface{}) {
    if _, hasGear := signals["Gear"]; hasGear {
        m := h.getOrCreate(ctx, vehicleID)
        if !m.IsGearCapable() {
            m.SetGearCapable(true)
            // Persist to DB
            h.vehicleRepo.SetGearCapable(ctx, vehicleID, true)
        }
    }
}
```

### Option B: Increase Debounce Duration (Quick fix)

Current: `StateConfirmDuration = 30 * time.Second`

Increase to 60-90 seconds for `Driving→Online` specifically. This reduces flapping but
doesn't eliminate it.

### Option C: Speed-based hold (Best combined with A)

Don't transition from Driving if speed was > 0 within the last N seconds, regardless
of gear capability. This handles the "red light" scenario:

```go
// In machine.go, before attempting Driving→Online:
if m.current == Driving && trigger == TriggerSpeedZero {
    // Check if speed was recently non-zero (still driving, just stopped temporarily)
    if time.Since(m.lastNonZeroSpeed) < 90*time.Second {
        return nil // hold state — likely at red light
    }
}
```

## Recommended: Option A + C Combined

1. Persist `isGearCapable` in DB → eliminates restart flapping
2. Add speed-hold timer → eliminates red-light flapping
3. Keep 30s debounce as final safety net

## Validation After Fix

```bash
# 1. Clear and reseed
docker exec teslasync-postgres psql -U teslasync -c "TRUNCATE positions, drives, charging_sessions, motor_snapshots, climate_snapshots, battery_snapshots, vehicle_states, vehicle_live_state, daily_mileage, drive_telemetry_readings, charge_telemetry_readings, charging_telemetry, command_logs CASCADE; DELETE FROM vehicles;"

# 2. Reseed vehicle (with is_gear_capable = true if column added)
# Run seed-test-vehicle.sql

# 3. Rebuild and restart
go build ./...
docker compose restart teslasync-api

# 4. Replay signals at 36x
node scripts/replay-signals.js --speed=36

# 5. Check state transitions — should be significantly fewer
docker exec teslasync-postgres psql -U teslasync -c "
SELECT count(*) as total_transitions FROM vehicle_states WHERE vehicle_id=1;
-- Target: ~15-20 (was 49 with flapping)
"

# 6. Check for rapid oscillation (flapping)
docker exec teslasync-postgres psql -U teslasync -c "
SELECT state, count(*) FROM vehicle_states WHERE vehicle_id=1 GROUP BY state ORDER BY count DESC;
-- 'driving' count should be < 5 (was 14)
"

# 7. Check drive quality — no micro-drives
docker exec teslasync-postgres psql -U teslasync -c "
SELECT count(*) FROM drives WHERE vehicle_id=1 AND duration_min < 1;
-- Target: 0 (was 4 micro-drives)
"
```

## Also: Wire FSM Transition Logging

The `fsm_transitions` table exists (migration 000045) but **nothing writes to it**.
The FSM debugger page queries this table and shows empty.

**What exists:**
- `fsm_transitions` table in Postgres ✅
- `FSMHandler.Transitions()` reads from it ✅
- `FSMHandler.Stats()` reads from it ✅
- **MISSING:** Nothing inserts rows into `fsm_transitions`

**What needs to happen:**

The `VehicleFSM.commit()` function in `internal/fsm/machine.go` (line ~195) executes actions
after a transition. One of those actions must insert into `fsm_transitions`.

1. **Restore `fsm_transition_repo.go`** from v0.31.0:
```bash
# Copy from old repo
cp D:\repos\teslasync-old\internal\database\fsm_transition_repo.go internal\database\
```

2. **Add transition logging action** — in the FSM handler's action executor, after every
   transition commit, insert a row:
```go
// In the action executor (fsm_handler.go fsmAction.Execute):
err := h.fsmTransRepo.Insert(ctx, &FSMTransitionRecord{
    ID:        uuid.New().String(),
    EntityID:  fmt.Sprint(vehicleID),
    FSMName:   "vehicle",  // or drive_session, charge_session, etc.
    FromState: string(from),
    Event:     sctx.MatchedTrigger,
    ToState:   string(to),
    CreatedAt: time.Now().UTC(),
})
```

3. **Also log sub-FSM transitions** — drive session start/end, charge session start/end
   should each write a row with their FSM name.

**The table schema uses `entity_id` (text) + `fsm_name` (text):**
- For vehicle state: `entity_id = "1"` (vehicle_id), `fsm_name = "vehicle"`
- For drive sessions: `entity_id = "1"`, `fsm_name = "drive_session"`
- For charge sessions: `entity_id = "1"`, `fsm_name = "charge_session"`

## Verification (FSM Debugger)

After fix + replay:
```bash
docker exec teslasync-postgres psql -U teslasync -c "SELECT count(*) FROM fsm_transitions"
# Target: > 0 (should match vehicle_states count roughly)

curl -sf "http://localhost:8080/api/v1/fsm/transitions?vehicle_id=1&hours=24" | python -m json.tool | head -20
# Should return transition data
```

The FSM Debugger page at `http://localhost:3000/state-debugger` should then show:
- Transition Distribution pie chart
- Transition Counts table
- Transition Timeline with rows

## Also: Fix Timeline Page — Blank Columns

The Timeline page (`/timeline`) shows "—" for Time, From State, and To State columns.

**Root Cause:** Field name mismatch between API response and page interface.

API returns:
```json
{"state": "online", "started_at": "2026-04-14T07:27:04Z", "ended_at": "...", "duration_seconds": 76}
```

Page expects:
```typescript
interface StateTransition {
  id: number;
  from_state: string;   // ❌ doesn't exist in API response
  to_state: string;     // ❌ doesn't exist — API has "state" instead
  timestamp: string;    // ❌ doesn't exist — API has "started_at" instead
  duration_seconds: number;  // ✅ matches
}
```

**Fix in `web/src/features/analytics/pages/TimelinePage.tsx`:**

1. Update the `StateTransition` interface to match the API:
```typescript
interface StateTransition {
  state: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
}
```

2. Update column renders:
- TIME column: `formatDateTime(row.started_at)` instead of `row.timestamp`
- FROM STATE: derive from previous row's `state` or show `row.state` with "entered" label
- TO STATE: show `row.state` (this IS the state the vehicle transitioned TO)
- Or better: compute from/to by comparing consecutive rows:
```typescript
const transitions = useMemo(() => {
  return (data ?? []).map((row, i, arr) => ({
    ...row,
    from_state: i > 0 ? arr[i - 1].state : '—',
    to_state: row.state,
    timestamp: row.started_at,
  }));
}, [data]);
```

3. Also fix the `keyExtractor` — the API doesn't return `id`, use index or `started_at`

## Engineering Rules
- Add migration for `is_gear_capable` column (up + down)
- Persist via repository pattern — `vehicleRepo.SetGearCapable(ctx, id, true)`
- Load on FSM creation — `vehicle.IsGearCapable`
- Unit tests: `TestDriving_SpeedZero_GearCapable_StaysDriving`
- Unit tests: `TestDriving_SpeedZero_AfterRestart_GearPersistedFromDB`
- DO NOT change the transition table — fix the guard input, not the rules
- Go build must pass, existing FSM tests must pass

**COMPLETION DEFINITION:**
- [ ] `is_gear_capable` column added to vehicles table (migration)
- [ ] Gear capability persisted on first Gear signal
- [ ] Gear capability loaded on FSM creation/restore
- [ ] Speed-hold timer prevents red-light flapping (90s)
- [ ] Go builds clean
- [ ] Existing FSM tests pass
- [ ] New test: `TestDriving_SpeedZero_GearCapable_StaysDriving`
- [ ] Signal replay produces < 20 state transitions (was 49)
- [ ] Zero micro-drives (duration < 1 min with 0 distance)
