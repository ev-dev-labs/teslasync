---

## 🏗️ ARCHITECTURE DECISIONS (PA/PE Approved — Non-Negotiable)

These decisions were reviewed and approved by Principal Architect and Principal Engineer.
They are **binding for all agents, all phases, all prompts.** Violating any of these is
a regression that must be caught in review.

### ADR-001: Unified Signal Log (Single Source of Truth)

```
STATUS: APPROVED (PA)
DATE: 2026-04-24
SUPERSEDES: 12 snapshot tables + vehicle_live_state

DECISION:
  All vehicle telemetry data lives in ONE table: `signal_log` (TimescaleDB hypertable).
  Schema: (created_at, vehicle_id, signal, value_num, value_str, value_bool, value_jsonb)

RULES:
  ✅ READ from signal_log for any historical telemetry query
  ✅ READ from signal.Store (in-memory) for real-time latest values
  ✅ READ from Redis HSET vehicle:{id}:signals for cross-pod cache
  ✅ READ from drives / charging_sessions for session-level aggregates
  ✅ READ from cagg_* continuous aggregates for pre-computed analytics
  ✅ USE SignalTracePivotFlat() for telemetry trace endpoints

  ❌ NEVER read from dropped tables:
     - battery_snapshots, charging_telemetry, state_snapshots
     - climate_snapshots, tire_pressure_snapshots, vehicle_live_state
     - security_snapshots, media_state, vehicle_config_snapshots
     - location_snapshots, safety_snapshots, user_preference_snapshots
  ❌ NEVER read from legacy `positions` table (use signal_log Latitude/Longitude)
  ❌ NEVER reference `signal_history` (renamed to `signal_log` in migration 000145)
```

### ADR-002: No Fabricated Data

```
STATUS: APPROVED (PA)
DATE: 2026-04-26

DECISION:
  When data is unavailable, return NULL/nil — never fabricated zeros or hardcoded defaults
  that could be mistaken for real measurements.

RULES:
  ✅ Return null/nil for missing telemetry values
  ✅ Include metadata when returning estimates: {"value": 75.0, "source": "vin_estimate"}
  ✅ Return "reason": "insufficient_data" when a computed metric can't be calculated
  ✅ Use *float64 (pointer) in Go for nullable numeric fields

  ❌ NEVER return hardcoded 0 for temperature, voltage, power, or any measurement
  ❌ NEVER return hardcoded scores (e.g., "temp_exposure_score": 80)
  ❌ NEVER interpolate/fabricate per-cell values from aggregate min/max
  ❌ NEVER present estimates as exact values without metadata
```

### ADR-003: Error Handling (No Silent Swallowing)

```
STATUS: APPROVED (PE)
DATE: 2026-04-26

DECISION:
  All database query errors must be logged. Use _ = only for intentional fire-and-forget
  operations (metrics, non-critical side effects), never for data queries.

RULES:
  ✅ Log real errors with log.Warn() or log.Error()
  ✅ Differentiate pgx.ErrNoRows (expected, no data) from real errors
  ✅ Return HTTP error status for critical query failures
  ✅ Use zero/default fallback ONLY after logging the error

  ❌ NEVER use _ = db.Pool.QueryRow(...).Scan(...) for data queries
  ❌ NEVER use bare `continue` in row scan loops without logging
  ❌ NEVER swallow context.DeadlineExceeded without logging
```

### ADR-004: FSM Reconciliation Architecture

```
STATUS: APPROVED (PA)
DATE: 2026-04-26

DECISION:
  The vehicle FSM uses event-driven transitions as primary + periodic reconciliation as
  safety net. Reconciliation reads from signal.Store and replays through the normal
  ProcessSignals pipeline.

RULES:
  ✅ Reconciliation uses signal.Store (in-memory, synchronous updates)
  ✅ Replay through normal ProcessSignals() — preserves guards, debounce, sub-FSM lifecycle
  ✅ Only reconcile on HIGH/MEDIUM confidence (fresh signals within 2 minutes)
  ✅ Skip reconciliation if FSM processed newer data than the snapshot (TOCTOU protection)
  ✅ Only derive Driving/Charging/Parked states (positive evidence)

  ❌ NEVER force-transition bypassing guards or debounce
  ❌ NEVER derive Online/Asleep/Offline from signal absence
  ❌ NEVER read from Redis for reconciliation (use signal.Store — it has timestamps)
```

### ADR-005: ForwardAuth (Provider-Agnostic)

```
STATUS: APPROVED (PA)
DATE: 2026-04-25

DECISION:
  Auth is provider-agnostic via FORWARD_AUTH_HEADER env var. Works with Authentik,
  Authelia, oauth2-proxy, Keycloak. Empty header = dev mode (no auth).

RULES:
  ✅ All /api/v1/* routes protected by ForwardAuthMiddleware
  ✅ SSE /api/v1/events uses same ForwardAuth (no separate JWT)
  ✅ Nginx must explicitly forward the auth header to backend
  ✅ Webhook + share endpoints use token-based auth (exempt from ForwardAuth)

  ❌ NEVER add Authentik-specific code
  ❌ NEVER add internal JWT validation for SSE
  ❌ NEVER hardcode auth provider URLs
```

### ADR-006: Mutation UX Feedback

```
STATUS: APPROVED (PE)
DATE: 2026-04-26

DECISION:
  All frontend useMutation() hooks must have onError + onSuccess callbacks with
  toast notifications. Users must always see feedback when an action succeeds or fails.

RULES:
  ✅ Import useToast from @/components/feedback/Toast
  ✅ Add onError with toast.error(err.message) to every mutation
  ✅ Add onSuccess with descriptive toast.success() message
  ✅ Keep existing onSuccess logic (query invalidation) — ADD toast alongside

  ❌ NEVER have a useMutation without onError
  ❌ NEVER silently swallow mutation failures
```

### Data Source Decision Matrix

```
┌─────────────────────────┬──────────────────────────────────────┐
│ Need                    │ Source                               │
├─────────────────────────┼──────────────────────────────────────┤
│ Real-time signal value  │ signal.Store.Get(vehicleID, signal)  │
│ Signal trace/history    │ signal_log via SignalTracePivotFlat  │
│ Drive aggregates        │ drives table                         │
│ Charge aggregates       │ charging_sessions table              │
│ Fleet-level stats       │ cagg_fleet_stats                     │
│ Battery daily trends    │ cagg_battery_daily                   │
│ Per-cell voltages       │ signal_log (BrickVoltageMax/Min)     │
│ Vehicle position        │ signal_log (Latitude/Longitude)      │
│ FSM state               │ vehicle_states table                 │
│ Configuration           │ settings table                       │
│ API call audit          │ api_call_logs table                  │
└─────────────────────────┴──────────────────────────────────────┘
```
