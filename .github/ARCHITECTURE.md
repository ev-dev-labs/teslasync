---

## 🏗️ ARCHITECTURE DECISIONS (PA/PE Approved — Non-Negotiable)

These decisions were reviewed and approved by Principal Architect and Principal Engineer.
They are **binding for all agents, all phases, all prompts.** Violating any of these is
a regression that must be caught in review.

## ADR-001: Unified Signal Log (Single Source of Truth)

```
STATUS: APPROVED (PA)
DATE: 2026-04-24
SUPERSEDES: 12 snapshot tables + vehicle_live_state

DECISION:
  All vehicle telemetry data lives in ONE table: `signal_log` (TimescaleDB hypertable).
  Schema: (created_at, vehicle_id, signal, value_num, value_str, value_bool, value_jsonb)

RULES:
  ✅ READ from signal_log for any historical telemetry query
  ✅ READ from signal.Store (in-memory L1) for telemetry/FSM/session hot paths
  ✅ READ from Redis HSET vehicle:{id}:signals for cross-pod current-state reads
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

## ADR-002: Change Feed vs State Separation

```
STATUS: Accepted (PA/PE)
DATE: 2026-04-30
SUPERSEDES: Ad-hoc state reads in ADR-001 implementation
RELATED: ADR-001 (canonical signal_log), ADR-007 (live signal layering)

CONTEXT:
  Tesla Fleet Telemetry only emits a field when BOTH the signal's interval_seconds has
  elapsed AND the value has changed (see https://developer.tesla.com/docs/fleet-api/fleet-telemetry#system-behavior).
  Unchanged signals are NEVER re-sent. As a result, signal_log is a sparse change-feed
  where any given (vehicle_id, signal, timestamp) row reflects the moment a value
  CHANGED, not the prevailing value at that moment.

  Phase 39 entry audit found 25 HTTP handlers (battery, charging, climate, security,
  motor, tire pressure, etc.) reading signal_log as if it were a state table. They
  called helpers like SignalTracePivot / SignalTracePivotFlat / SnapshotAt and bound
  the result to UI panels expecting "current value at time T". Because change-feed
  rows do not include unchanged columns, those panels rendered empty rows on every
  vehicle that had not just emitted that exact signal — the empty-row class of bug.

  The root cause is structural: one reader surface (SignalLogReader) served two
  semantically incompatible read patterns (raw change events vs derived state).
  Patching individual call sites would not prevent the next handler from making
  the same mistake. The fix has to be at the type boundary.

DECISION:
  Two reader surfaces. Each one returns ONE shape of result. Compile-time enforced
  by removing the shape-confused helpers from SignalLogReader entirely.

  1. database.SignalLogReader (in internal/database/) exposes ONLY:
       - SignalTrace          (raw change-feed rows in time order)
       - BrickVoltageHistory  (per-brick aggregations)
       - DriveAggregates      (per-drive sums/averages)
       - RegenEnergy          (regen-window sums)
       - ChargeAggregates     (per-session sums/averages)
       - LatestTimestamp      (max(created_at) for liveness checks)
     This surface owns CHANGE-FEED + AGGREGATION reads — raw events, sums,
     averages, time-bucketed rollups. It does NOT carry values forward.

  2. signal.StateReader (in internal/signal/) exposes ONLY:
       - State(ctx, vehicleID, at)             → current per-signal map at time
       - SignalAt(ctx, vehicleID, signal, at)  → single-signal value at time
       - Timeline(ctx, vehicleID, opts TimelineOptions) → ordered events
                                                  (opts.CollapseBy controls dedup)
     The default implementation (signal.LogStateReader) forward-folds over
     signal_log: for every requested signal it returns the most recent row at or
     before `at`, carrying the prior value forward in time. This is the ONLY
     correct way to derive state from a change feed.

DATA OWNERSHIP (CRITICAL — three-way split, do not "consolidate"):
  The signal_log table has three legitimate accessors. This is intentional
  CQRS-lite separation; it is NOT redundancy to be cleaned up:

  1. database.SignalHistoryWriter (internal/database/)
       owns INSERT path, schema migrations, hypertable maintenance.
  2. signal.LogStateReader (internal/signal/)
       owns FORWARD-FOLD STATE reads — point-in-time, carry-forward derivation.
  3. database.SignalLogReader (internal/database/)
       owns CHANGE-FEED + AGGREGATION reads — raw events, sums, averages,
       time-bucketed rollups.

  Three legitimate accessors, three distinct read/write patterns. A future
  refactor that "merges" state-reads back into internal/database/ "to keep DB
  concerns together" re-creates the entire bug class this ADR exists to prevent.
  Reviewers MUST reject any such merge unless this ADR is formally superseded.
  The package boundary IS the fix.

HOT-PATH vs COLD-PATH READS:
  signal.StateReader is for COLD-PATH reads only: HTTP handlers, the
  cmd/teslasync/main.go warmup path, chatbot/RAG state lookups. It hits the
  database (signal_log) on every call.

  The HOT PATH — telemetry ingest, FSM/reconciliation, session boundary
  detection — MUST continue to read from the in-process signal.Store (L1
  cache) and Redis HSET (L2 shared cache) per the existing layered live-state
  contract documented in .github/instructions/telemetry-pipeline.instructions.md
  and ADR-007. signal.StateReader MUST NOT be wired into the telemetry hot
  path: doing so would couple every signal write to a synchronous DB roundtrip
  and defeat the L1/L2 cache architecture.

SECURITY MODEL (trusted-caller):
  signal.StateReader does NOT enforce per-vehicle authorization. Callers own
  the authorization decision before invoking the reader:
    - HTTP handlers authorize via Authentik ForwardAuth middleware and the
      vehicle-scoped routing in internal/api/router.go.
    - Warmup runs as the application identity and reads all vehicles by design.
  Implementations of StateReader are responsible only for the correctness of
  the change-feed → state derivation, not for who is allowed to ask. Any future
  cross-tenant deployment MUST add an authorization layer in front of the
  reader, not inside it.

EXTENSION PATTERN (future implementations compose, do not extend):
  New StateReader implementations — e.g. RedisStateReader for hot-vehicle
  caching, CompositeStateReader chaining cache-then-fallback, an in-memory
  MockStateReader for tests — compose via the existing three-method interface.
  They MUST NOT add new methods. The recommended extension pattern for future
  caching is a CompositeStateReader composite decorator (RedisStateReader →
  LogStateReader fallback), NOT an interface change. Adding methods bloats
  the contract and re-opens the door to shape-confused helpers.

STORAGE CONTRACT (required index):
  Correct performance of LogStateReader.State and LogStateReader.Timeline
  REQUIRES the composite index on signal_log keyed (vehicle_id, signal, created_at DESC).
  This index is part of the architectural contract, not an implementation detail.
  The State query relies on DISTINCT ON (signal) ORDER BY signal, created_at DESC,
  which is O(log n) per signal with the index and O(n) without it. Removing or
  altering the (vehicle_id, signal, created_at DESC) index changes the cost model
  and silently regresses every cold-path state read in the application.

CONSEQUENCES:
  ✅ Handlers needing "value at time T" depend on signal.StateReader.
  ✅ Handlers needing raw change events or aggregations depend on
     database.SignalLogReader.
  ✅ Timeline accepts TimelineOptions{CollapseBy []string}. Chart mode
     (no collapse) returns one row per emission timestamp. List mode
     (collapse keys provided) returns one row per distinct key tuple,
     dropping consecutive duplicates of the same tuple.
  ✅ Compatibility views (compat views v_charging_telemetry, v_motor_snapshots,
     v_climate_snapshots, etc.) are unchanged. They serve EXTERNAL consumers
     (Grafana dashboards, ad-hoc SQL, external BI tooling) and are out of
     scope for this ADR. Internal Go code MUST go through signal.StateReader.
  ❌ The following helpers are REMOVED from database.SignalLogReader after
     the migration (compile-time enforcement; deletion is the load-bearing step):
       - SnapshotAt
       - SignalAt              (the database-layer one — not signal.StateReader.SignalAt)
       - SignalTracePivot
       - SignalTracePivotFlat
       - SnapshotBetween

REJECTED ALTERNATIVES:
  - Patch SignalTracePivot in place to forward-fill: rejected because it leaves the broken signature available; downstream callers re-introduce the bug the next time someone writes a similar handler.
  - Add SignalTraceForwardFill alongside the broken function: rejected for the same reason, plus the name confusion between two near-identical helpers practically guarantees the wrong one gets imported.
  - Materialized state cache table: rejected for now. signal_log already supports forward-fold via DISTINCT ON ... ORDER BY ... DESC; a separate cache table adds write-path latency and source-of-truth divergence risk. A RedisStateReader decorator is the lower-cost alternative if profiling ever shows the cold-path read is a bottleneck.
  - Wire signal.StateReader into the telemetry hot path: rejected because it violates the L1/L2 cache architecture in ADR-007 — every signal write would couple to a synchronous DB read and the cache stops being a cache.
  - Move state-fold logic into internal/database/ to "keep DB concerns together": rejected because the bug class came from exactly this co-location. The package boundary between internal/database/ (raw rows + aggregations) and internal/signal/ (derived state) IS the fix and MUST NOT be collapsed.

FOLLOW-UP WORK (post-Phase-39, separate phases):
  - Consolidate per-handler `fakeStateReader` test fakes into a shared
    internal/signal/signaltest package once Phase 39 stabilizes. DRY
    cleanup, low risk; deferred to avoid widening Phase 39 scope.
  - Add Prometheus histograms (signal_state_read_duration_seconds{vehicle_id,
    method}) wrapping the StateReader calls so we can detect cold-path
    regressions before users do.
  - If profiling shows hotspots, add a 90-day window bound to State() SQL
    with an unbounded fallback when the windowed query returns 0 rows.
    The 90-day bound caps the worst-case scan; the unbounded fallback
    preserves correctness for vehicles with sparse emission histories.
  - Consider renaming database.SignalLogReader → database.SignalAggregationReader
    after the deletions land, to make post-deletion intent unambiguous to
    future readers.

REFERENCES:
  - Tesla Fleet Telemetry System Behavior:
    https://developer.tesla.com/docs/fleet-api/fleet-telemetry#system-behavior
  - Phase 39 prompt directory: .github/prompts/db-refactor/
  - signal.StateReader interface (created in Phase 39 / Prompt 03):
    internal/signal/state_reader.go
  - Layered live-state contract (hot path / L1+L2):
    .github/instructions/telemetry-pipeline.instructions.md
  - ADR-001 (canonical signal_log) and ADR-007 (live signal layering) above.
```

### ADR-007: Live Signal State Layering (Scale-Out Contract)

```
STATUS: APPROVED (PA/PE)
DATE: 2026-04-28

DECISION:
  Live signal state is a layered runtime contract:

    L1: signal.Store              Per-process hot cache
    L2: RedisSignalCache          Cross-pod live cache + Pub/Sub fanout
    L3: signal_log / TimescaleDB  Durable history and reconstruction

  Redis does NOT replace signal.Store. signal.Store does NOT provide distributed truth.
  Each layer has a separate purpose and must remain compatible with the others.

  Scale-out topology:
    - Phase 35 does not make FSM/reconciliation active-active across API pods.
    - FSM/reconciliation may run only on the telemetry-owner pod for a vehicle.
    - Until vehicle ownership/leases or pod affinity exist, production multi-pod
      deployments must use one telemetry/FSM owner plus API-only reader pods, or
      remain single-pod for telemetry/FSM.

  Rollback/degradation:
    - `LIVE_SIGNAL_STORE_MODE=hybrid|local` is the runtime rollback switch.
    - `hybrid` enables Redis-backed distributed live reads.
    - `local` disables Redis-backed distributed live reads while preserving local
      SignalStore behavior and durable signal_log writes.

  Live-read merge rule (per signal):
    - GetSignal/GetAll merge the L1 (signal.Store) and L2 (Redis) values per signal.
    - The value with the strictly newer non-zero Timestamp wins.
    - Ties on identical non-zero Timestamps prefer L2 (cross-pod authoritative).
    - If exactly one side has a zero Timestamp (legacy unknown freshness), the
      non-zero side wins regardless of which layer it came from.
    - If both sides have zero Timestamp, L1 wins (local hot-path observation).

  Freshness is informational, not a filter:
    - The live-store boundary returns ALL known per-signal values to callers,
      including stale and legacy zero-Timestamp envelopes. The boundary does
      not silently drop values based on age or missing timestamps.
    - Callers inspect freshness via `signal.IsLiveSignalFresh(value, now)` which
      returns false for nil values, zero-Timestamp legacy entries, and entries
      older than the cross-pod 2-minute freshness window. The result is
      advisory metadata for callers to render/route appropriately, not a gate
      that erases data at the boundary.
    - Cross-pod live reads still treat values older than 2 minutes as stale and
      timestamp-less legacy Redis scalars as unknown freshness, but that
      classification is exposed to callers — never used to delete the value.

  signal_log last-known-value fallback (current-state reads):
    - `BuildStateFromSignalStore` (and any equivalent current-state assembler)
      consults `signal_log` via `SignalLogReader.SnapshotAt(ctx, vehicleID, now)`
      ONLY for fields the live store left at their Go zero / empty value.
    - Live (L1+L2) values always win; the signal_log fallback only fills holes
      after a pod restart, after a Warm miss, or before fresh telemetry
      arrives. This is a `signal_log` read (ADR-001 compliant), NOT a snapshot
      table read — the per-table snapshot prohibition in ADR-001 is unchanged.

  Warm-time legacy restamp (self-heal on hydration):
    - `HybridLiveSignalStore.Warm` calls `RedisSignalCache.RestampLegacy` BEFORE
      hydrating L1 from L2. RestampLegacy reads the vehicle's Redis HSET, skips
      every field that is already a valid timestamped envelope, and re-encodes
      every legacy scalar entry as a full envelope stamped with `now()`, then
      issues one HSET (variadic) and refreshes the key TTL via Expire.
    - This is idempotent (a second Warm sees only envelopes and writes nothing),
      partial-failure safe (HSET error returns wrapped error WITHOUT mutating
      L1, deleting fields, or issuing HDEL/DEL), and value-preserving (the
      decoded raw value is round-tripped bit-for-bit through
      `encodeTimestampedSignalValue`).
    - After RestampLegacy succeeds, `hydrateMissingValues` no longer skips
      zero-Timestamp entries — restamped legacy values now flow into L1 with a
      non-zero Timestamp and are usable by hot paths.

  SSE:
    - Redis Pub/Sub `vehicle_update` fanout is best-effort, not durable replay.
    - Clients recover missed current state through polling/live reads, not SSE replay.

RULES:
  ✅ Update signal.Store first on telemetry ingest so FSM/session/snapshot merge paths
     have a local, synchronous, last-known-good view.
  ✅ Mirror live telemetry to Redis HSET `vehicle:{vehicleID}:signals` for restart
     recovery and cross-pod current-state reads.
  ✅ Use Redis Pub/Sub channel `vehicle_signals` for cross-pod `vehicle_update` SSE
     fanout, with local in-process fallback when Redis is unavailable.
  ✅ Use Redis list `signal_log:backlog` only as a bounded secondary WAL for
     signal_log overflow/crash recovery.
  ✅ Use signal_log for history, charts, point-in-time reconstruction, drive/charge
     completion, analytics, and durable replay.
  ✅ Use the `signal_log` SnapshotAt(now) fallback in current-state assemblers
     (e.g. BuildStateFromSignalStore) for fields the live store left at zero;
     this is a signal_log read, not a snapshot-table read.
  ✅ Apply the per-signal merge rule (newer non-zero Timestamp wins; ties prefer L2;
     legacy zero-Timestamp loses to any non-zero Timestamp; both-zero L1 wins)
     when combining L1 and L2 in any new live-read code path.
  ✅ Treat freshness as informational metadata via `IsLiveSignalFresh`; expose it
     to callers but do not drop the underlying value at the boundary.
  ✅ Preserve Redis optionality: Redis failures may degrade cross-pod/live recovery
     behavior, but must not block MQTT ingest or erase local signal.Store state.
  ✅ Keep existing Redis scalar HSET values readable indefinitely; they are restamped
     by Warm legacy self-heal on the next pod start AND replaced naturally on the
     next telemetry write. Restamp is idempotent and value-preserving.

  ❌ NEVER remove signal.Store merely because Redis exists.
  ❌ NEVER route FSM/reconciliation/session hot-path reads through Redis by default.
  ❌ NEVER use Redis as historical storage or analytics truth.
  ❌ NEVER change Redis keys/channels without a compatibility shim and migration note.
  ❌ NEVER silently drop stale or legacy zero-Timestamp values at the live-store
     boundary; freshness is informational, not a filter, and callers expect the
     full per-signal union of L1 and L2.
  ❌ NEVER add HDEL / DEL / field deletion to the Warm restamp path; restamp must
     only re-encode in place under the existing `vehicle:{vehicleID}:signals` key.
  ❌ NEVER claim FSM/reconciliation is active-active across pods without vehicle-owner
     routing, leases, or an explicit ADR that supersedes this one.
  ❌ NEVER claim "Redis replaced SignalStore" in docs or prompts unless code and tests
     actually remove SignalStore and prove equivalent latency/freshness semantics.
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
│ Hot-path live signal    │ signal.Store.Get(vehicleID, signal)  │
│ Cross-pod live signal   │ Redis HSET vehicle:{id}:signals      │
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
