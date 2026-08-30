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

## ADR-003: Go Quality Conventions

**Status:** Accepted, supersedes ad-hoc style guides.

**Context.**
A Go-only audit (85 HIGH + 417 MEDIUM findings across 495 batches) found
recurring quality drift across the backend — missing context timeouts on
Tesla calls, unrecovered goroutines, swallowed errors, missing pagination,
response-shape unit mislabels, magic numbers, and snapshot-table reads for
live current state. Each class is individually small but recurs because
nothing in the project blocks it from re-entering. The conventions below
are the codification of those findings, derived directly from the audit
table `phase41_findings` (in the session-store SQLite) and the per-package
SQL exports under `files/raw-audits/`.

**Decision (Conventions, all enforced via per-prompt gates and CI):**

1. **Context propagation.** Every exported function that performs I/O
   accepts `ctx context.Context` as its first parameter.
   `context.Background()` and `context.TODO()` are forbidden outside
   `main`, `init`, and `_test.go`. Re-entry from goroutines must use
   `context.WithoutCancel(ctx)` to preserve trace IDs without inheriting
   cancellation.

2. **External call timeouts.** Every Tesla Fleet API call, every external
   HTTP call, and every long-running DB call wraps the inherited context
   in `context.WithTimeout`. Default timeouts: Tesla=30s, geocoding=10s,
   Mosquitto reconnect=5s, signal_log Timeline=15s.

3. **Goroutine safety.** Every `go func()` either uses
   `resilience.SafeGo` (a deferred `recover()` that logs and increments a
   metric) or is documented as "panic-safe by construction" with a
   one-line comment.

4. **Resource lifecycle.** `rows.Close()`, `body.Close()`,
   `tx.Rollback()`, `ticker.Stop()`, file `Close()`, etc. are deferred
   immediately after acquisition. Manual `Unlock` is forbidden — use
   `defer mu.Unlock()`.

5. **Error handling.** `http.Error(...)` is forbidden in handlers — use
   the project `writeError(w, status, msg)` helper. Swallowed errors via
   `_ = ...` are forbidden except where explicitly documented (e.g.
   `defer tx.Rollback()` after a successful Commit).

6. **Error wrap context.** Return paths use
   `fmt.Errorf("operation context: %w", err)`, never bare `return err`.
   The wrap context names the operation and the relevant identifier
   (e.g., `vehicle %d`).

7. **SQL safety.** All queries use parameterized placeholders (`$1`,
   `$2`). String interpolation of values into queries is forbidden.
   `signal_log` queries MUST include a time bound (lower AND upper).
   List endpoints MUST include a `LIMIT` cap (default 200, configurable
   up to 1000).

8. **Pagination.** Every list endpoint accepts `limit` and `offset`
   query parameters and enforces a maximum `limit`. The `pagination(r)`
   helper returns `(limit, offset)` — both MUST be wired through to the
   underlying repo call.

9. **Input validation.** `chi.URLParam` → `strconv.ParseInt(...)` MUST
   be followed by an `if id <= 0` bounds check. Date ranges from query
   string are validated against RFC3339 / `2006-01-02` formats before
   forwarding to upstream APIs.

10. **Response shape.** All JSON field names are `snake_case` and end in
    a unit suffix when the value is a measurement (e.g., `distance_mi`,
    `speed_kph`, `outside_temp_c`). Renaming an existing column without
    conversion is a CORRECTNESS BUG (e.g.,
    `AVG(distance_mi) AS avg_distance_km` is NEVER permitted).

11. **Logging.** All logging goes through zerolog with structured fields.
    `fmt.Print*` and `log.Print*` from the standard `log` library are
    forbidden in non-test code. Log levels: `Error` (operation failed),
    `Warn` (degraded), `Info` (significant business events), `Debug`
    (development diagnostics).

12. **Long handlers.** Functions over 150 LOC must be decomposed unless
    the body is a single switch/state-machine over a finite enumeration.
    Decomposition follows Single Responsibility (validate / compute /
    persist / respond helpers).

13. **Magic numbers.** Magic numbers, hardcoded URLs, and ad-hoc
    thresholds are extracted as named `const` blocks at the top of the
    file. Tariffs, capacities, and per-region values are sourced from
    the settings table or environment variables.

14. **Layering.** Snapshot tables (`positions`, `security_events`,
    `climate_snapshots`, etc.) are NEVER read for live current state —
    use `signal.Store` (L1) → Redis (L2) → `signal_log` (durable). Per
    ADR-002.

15. **Dead code.** Exported symbols without callers are removed (or
    marked `// Deprecated: ...` with a removal date).

**Enforcement model.**

- **Per-prompt gate:** every phase-41 remediation prompt runs
  `go build ./...` + `go test ./<pkg>/...` + drift check. Anchored greps
  assert the convention is now applied where applicable.
- **CI gate (post-phase-41):** golangci-lint v2 config additions for the
  rules above (configured in a follow-up phase, not this one).
- **ADR review:** any future change that violates a convention requires
  an ADR superseding ADR-003 in the same PR.

**Rejected alternatives.**

- **Single mega-prompt.** Rejected: too coarse for revertibility;
  impossible to gate; impossible to assign to different agents.
- **Per-package prompts.** Rejected for HIGH findings: a single
  mega-package prompt would obscure individual fixes and make the gate
  non-anchorable.
- **Lint-only enforcement.** Rejected for the unit-mislabel class:
  linters cannot detect that `AVG(distance_mi) AS avg_distance_km` has
  the wrong units — only domain-aware human review (or per-prompt
  anchored greps) can.

**Consequences.**

- The phase-41 prompt slate (299 prompts) is the precedent for the
  conventions. Future audits follow the same pattern (audit → SQL →
  prompts → ADR).
- Each new bug class found in production is documented as an addition to
  ADR-003 with a remediation phase reference.
- `internal/resilience.SafeGo` becomes a project-required helper for
  goroutines.

**References:**

- phase-41 prompt directory: `.github/prompts/db-refactor/phase-41/`
- phase-41 audit findings table: `phase41_findings` (in the session-store
  SQLite, exported into `files/raw-audits/`)

## ADR-004: Tesla Fleet Telemetry Pipeline (codegen + dynamic units + single pipeline)

**Status:** Accepted (phase-42).

### Pipeline at-a-glance (read this first)

```
                                                          ┌─────────────────────────────┐
Tesla Vehicle ── mTLS stream ──▶ Tesla Fleet Telemetry ──▶│ Mosquitto MQTT             │
                                 (transmit_decoded_records │ telemetry/{VIN}/v/{Field}  │
                                  = true → per-field JSON) │ subscriber filter:         │
                                                           │  {base}/+/v/+              │
                                                           └─────────┬───────────────────┘
                                                                     ▼
                                                     ┌──────────────────────────────┐
                                                     │ PipelineSubscriber           │
                                                     │ internal/mqtt/...            │
                                                     │ ▸ ack-after-process          │
                                                     │ ▸ tracker (4096 capacity)    │
                                                     │ ▸ DLQ via ErrPayloadDrop     │
                                                     │ ▸ VIN cache (5min refresh)   │
                                                     └──────────────┬───────────────┘
                                                                    ▼
                                                 ┌──────────────────────────────────┐
                                                 │ Codec  internal/tesla/codec      │
                                                 │ DecodeJSONField(field, body) →   │
                                                 │   []codec.Atomic                 │
                                                 │ failure ⇒ ErrPayloadDrop → DLQ   │
                                                 └──────────────┬───────────────────┘
                                                                ▼
                                 ┌──────────────────────────────────────────────────┐
                                 │ normalize.Pipeline   internal/tesla/normalize    │
                                 │ ▸ ProcessAtomics — THE one ingest entry          │
                                 │ ▸ ToSI(field, raw, vehicleUnits)                 │
                                 │   uses tesla/unit_history per-vehicle Setting*   │
                                 │ ▸ produces signal.Sample{Field, Value, Time}     │
                                 └──────────────┬───────────────────────────────────┘
                                                ▼
                           ┌────────────────────────────────────────┐
                           │ Router  internal/tesla/router          │
                           │ routing.yaml — field-static, vehicle-  │
                           │ agnostic per ADR-004 #8                │
                           │ field → {dest_table, column?, also_log}│
                           └──────┬──────────────────────┬──────────┘
                                  ▼                      ▼
                      ┌───────────────────────┐  ┌───────────────────┐
                      │ Writers (per table)   │  │ signal.Store L1   │
                      │ drive_telemetry       │  │ in-process map    │
                      │ charging_telemetry    │  │ hot path: FSM,    │
                      │ positions             │  │ sessions, merge   │
                      │ tesla_charging_history│  │ context           │
                      │ ...                   │  └────────┬──────────┘
                      │ writer failure ⇒ log+ │           │
                      │ counter, NEVER MQTT   │           │ pubsub
                      │ redeliver             │           ▼
                      └─────────┬─────────────┘  ┌───────────────────┐
                                ▼                │ Redis L2          │
                      ┌───────────────────┐      │ HSET vehicle:{id}:│
                      │ signal_log        │      │ signals + Pub/Sub │
                      │ (TimescaleDB      │      │ cross-pod live    │
                      │  hypertable)      │      │ TTL: 2 min stale  │
                      │ durable history,  │      └────────┬──────────┘
                      │ replay, charts,   │               │
                      │ point-in-time     │               ▼
                      └───────────────────┘   ┌──────────────────────┐
                                              │ SSE event hub        │
                                              │ Redis Pub/Sub        │
                                              │ → /events stream     │
                                              └──────────┬───────────┘
                                                         │
                                 ┌───────────────────────┴────────────────┐
                                 ▼                                        ▼
                   ┌──────────────────────────┐           ┌─────────────────────────┐
                   │ FSM   internal/fsm       │           │ React SPA               │
                   │ 20-transition table      │           │ ▸ EventSource for live  │
                   │ ▸ drive / charge / park  │           │ ▸ TanStack Query for    │
                   │ ▸ reconciliation 15s     │           │   history endpoints     │
                   │ ▸ commits sessions to    │           │ ▸ useUnits/useFormatting│
                   │   drives, charging_     │           │   for SI→display only at │
                   │   sessions tables        │           │   render boundary       │
                   └──────────────────────────┘           └─────────────────────────┘
```

**Five-line summary:**

1. **Vehicle → Mosquitto:** Tesla streams Fleet Telemetry over mTLS; TeslaSync's pinned Fleet Telemetry build emits ONE signal per topic of the form `telemetry/{VIN}/v/{Field}` with `{"value":...,"ts":"<Payload.CreatedAt>"}` as the body.
2. **Decode → Normalize:** `PipelineSubscriber` filters `{base}/+/v/+`, codec `DecodeJSONField` translates the per-field body to a `[]codec.Atomic` keyed by canonical proto field name, and `normalize.Pipeline.ProcessAtomics` converts each value to SI using per-vehicle `Setting*Unit` history.
3. **Route → Persist:** `routing.yaml` (static, no per-vehicle logic) routes each field to a destination table writer + optional `signal_log` history. **Codec failures route to the DLQ via `ErrPayloadDrop`; writer failures only log+counter** (never redeliver — a poisoned per-VIN topic would otherwise pin redelivery forever).
4. **Live state, three tiers:** L1 = in-process `signal.Store` (FSM, sessions hot path) · L2 = Redis `vehicle:{id}:signals` HSET + Pub/Sub (cross-pod, restart recovery) · durable = `signal_log` hypertable (charts, replay, point-in-time snapshots).
5. **Consumers:** FSM watches the store and commits drive/charge sessions when transitions complete · `SideEffectsObserver` builds a true cross-batch accumulated map (via `live.GetAll` after `UpdateAll`) for sessions + alerts · SSE hub fans Redis Pub/Sub out to the SPA · REST endpoints serve historical reads from `signal_log` and aggregates from `drives` / `charging_sessions` / continuous aggregates.

**The whole pipeline writes SI units to disk** (meters, m/s, °C, Pa, Wh — never miles, mph, °F, psi, kWh). User display preference is applied **only** at the React render boundary by `useUnits()` / `useFormatting()` hooks. The vendored Tesla proto is the only place imperial-named identifiers survive (e.g. proto field 256 `ChargeRateMilePerHour` whose wire content is actually meters/hour — pinned by `TestRangeAddedMetersPerHour_R2_AuditPin`).

### Pipeline invariants (enforced by tests / startup checks)

| # | Invariant | Where enforced |
|---|---|---|
| 1 | `normalize.Pipeline.ProcessAtomics` is THE one ingest entry | Reflective coverage test in `internal/tesla/normalize`; `mqtt.Pipeline` interface has only this method |
| 2 | `routing.yaml` is field-static, vehicle-agnostic | Schema validation at startup |
| 3 | Every `ftproto.Field_*` has exactly one routing entry | Reflective coverage test in `internal/tesla/router` |
| 4 | Codec failures → DLQ via `ErrPayloadDrop`; writer failures never trigger MQTT redelivery | `tesla_router_writer_failures_total` counter; `internal/tesla/router/writers`; `handlePipelineError` classifier in `internal/mqtt` |
| 5 | `signal.Store` L1 is mandatory for FSM/sessions | `LIVE_SIGNAL_STORE_MODE=local` rollback switch |
| 6 | `tesla_*` prefix for vendor-specific tables | New tables only; existing ones grandfathered |
| 7 | `internal/tesla/*` for vendor code, `internal/signal/*` for vendor-agnostic | Directory layout |
| 8 | SignalMeta.Field name MUST match `ftproto.Field_name[N]` | `TestCoverage_EveryProtoFieldHasSignalMeta` |
| 9 | Generated files in sync with vendored proto | `go generate` + CI check |
| 10 | Subscriber filter is `{base}/+/v/+` (per-field topics only) | `pipelineTopicFilter()` + subscriber tests |
| 11 | `SideEffectsObserver` accumulated map is the cross-batch live snapshot (not the per-payload signals) | `TestSideEffectsObserver_AccumulatedIncludesPriorBatches` |

**Detailed decision record below.** The at-a-glance section above is the pointer for new contributors and AI agents; the rest of ADR-004 is the deep historical record of why each decision was locked in.

---

**Context.**
The pre-phase-42 Tesla Fleet Telemetry ingest pipeline contained two parallel
transform paths (`NormalizeFleetUnits` switch and `HotCatalog.Transformer`
field), two parallel compound expanders (`Flatten()` and the `SignalRegistry`
JSON-marshal switch), 16/16 passthrough transformer stubs that silently
stored mph in `positions.speed_mps` and raw enum strings in typed enum
columns, and a hand-curated `SignalRegistry` that was missing 11 Semitruck
fields with no automated detection. A field-coverage audit produced 16 HIGH
data-corruption findings, 22 MEDIUM missing-parser findings, and 18 LOW
unit-annotation findings across 241 actionable Tesla proto fields.

**Decision.**
1. **Single source of truth.** Tesla's `vehicle_data.proto` is vendored under
   `api/proto/tesla/` with a SHA256 checksum lock. A `go generate` step in
   `cmd/protogen-tesla` parses the proto and emits `signal_metadata.go`,
   `enum_parsers.go`, and `datum_decoder.go` in `internal/tesla/protomodel/`.
   Hand-curated `SignalRegistry`, `KnownColdSignals`, and `signal_alias.go`
   are DELETED. Adding a Tesla field = re-vendor + regen + add a routing
   entry. CI fails if generated files are out of sync with the proto.
2. **Single pipeline.** Every Fleet Telemetry payload follows exactly one
   path: `bytes → typed Datum (codec) → flatten compounds → lookup
   activeUnit at T → ToSI → atomic typed value → router → write`. The
   `internal/tesla/router` package owns a curated `routing.yaml` that
   specifies the destination (hot column or cold log) for every Field. A
   reflective coverage test asserts every `ftproto.Field_*` has exactly one
   routing entry — no double-routes, no missing routes.
3. **Always flatten at ingest.** Compound message types (DoorState, Doors,
   Location, TireLocation, Time, ScheduledChargingStartTime,
   ScheduledDepartureTime, ShiftState) are decomposed into typed atomic
   children at the codec boundary. No nested maps cross the ingest boundary.
   Downstream consumers only see typed primitives.
4. **Dynamic wire-format units.** Tesla's developer docs claim fixed units
   (mph for VehicleSpeed, miles for Odometer, etc.) but the proto contract
   says otherwise: `SettingDistanceUnit`, `SettingTemperatureUnit`,
   `SettingTirePressureUnit`, and `SettingChargeUnit` are streamable Field
   entries that change at runtime when a user toggles their dashboard
   preference (e.g., a US driver crossing into Canada and switching to km).
   The wire-format unit of unit-bearing fields follows the active vehicle
   preference at emission time. Therefore: (a) `vehicle_unit_history`
   records every `Setting*Unit` change with `effective_from TIMESTAMPTZ`;
   (b) every unit-bearing field at time T looks up active unit as-of T
   before `ToSI`; (c) all 4 `Setting*Unit` fields are subscribed at
   `interval_seconds=1` as REQUIRED ingest signals; (d) the existing REST
   `/vehicle_data` client (`internal/tesla/client_vehicle_data.go`) seeds
   `vehicle_unit_history` from `gui_settings` on first connect as a
   belt-and-suspenders alongside Tesla's process-startup telemetry snapshot.
5. **Canonical SI storage.** All telemetry values are stored in SI base
   units (m/s, m, Pa, °C, W, A, V) regardless of the wire-format unit. One
   conversion site (the `internal/tesla/units.ToSI` 3-arg pure function),
   one direction. The frontend converts SI to user-display units in
   `web/src/lib/units/` using the app Settings preferences. App Settings
   unit selectors are independent of vehicle dashboard preferences.
6. **Forward-only, no shims.** All legacy code is deleted, not deprecated.
   `internal/telemetry/{normalize,flatten,transformers_stub,hot_catalog*,signal_alias}.go`,
   `internal/enums/signal_types.go`, and `internal/enums/parse_*.go` are
   removed in tombstone prompts. No compatibility wrappers. No feature
   flags. No parallel old/new pipelines.
7. **Forward-only schema.** All 38 tables populated by the broken pipeline
   are dropped with `CASCADE` and recreated with SI-canonical schemas. No
   backfill — operator triggers a fleet-wide resubscribe at deploy time,
   and Tesla's process-startup snapshot reseeds all subscribed signals
   into the new schema.
8. **Domain boundaries (LOCKED).**
   - **Vendor namespace.** All Tesla-vendor-specific code lives under
     `internal/tesla/`. Vendor-agnostic primitives (live signal store,
     Redis cache, SSE fanout) live under `internal/signal/`. Cross-package
     direction is one-way: `internal/tesla/normalize` may write into
     `internal/signal` via the router; `internal/signal` MUST NOT import
     `internal/tesla`. This boundary is the seed of any future
     multi-vendor support.
   - **Tesla-owned table naming.** Tables that hold Tesla-specific wire
     interpretation MUST use the `tesla_` prefix
     (e.g., `tesla_vehicle_wire_units` would be the architecturally-clean
     name for `vehicle_unit_history`). For phase-42 we accept the
     unprefixed `vehicle_unit_history` name since it's already entrenched
     in the prompts; future tables MUST follow the prefix rule, and a
     future migration may rename `vehicle_unit_history` to
     `tesla_vehicle_unit_history` once the rename is cheap.
   - **Routing is field-static and vehicle-agnostic.** A field's
     destination is a function of `(field_name)` only. Per-vehicle or
     value-conditional routing (e.g., "Semitruck-only fields skip
     Model 3 vehicles", "speed > 0 → drive_telemetry") is OUT OF SCOPE
     and must not be added to `router.Route`. Any future need is
     handled at the writer layer (filter inside the writer), not in the
     dispatcher.
   - **Writer contract.** `router.Writer.Write(ctx, atomic, dst Entry) error`
     is best-effort and idempotent on `(vehicle_id, ts, field)`. Errors
     are logged + counted as `tesla_router_writer_failures_total{dest, reason}`
     and do NOT abort sibling writers within the same payload. The
     pipeline's `Process(ctx, bytes, vehicleID)` returns:
     - `nil` if codec succeeded (regardless of how many writers failed —
       per-atomic failures are observable via the metric, not the return
       value, so MQTT does NOT redeliver a payload because one writer
       blipped);
     - `ErrPayloadDrop` only if the codec itself failed (malformed bytes)
       — this IS what triggers MQTT redelivery + the poison-pill counter
       in `internal/mqtt/mqtt.go` (Prompt 0060).
9. **Operator surface (LOCKED).** Privileged binaries that mutate Tesla
   subscription state on behalf of users (`cmd/resubscribe`) MUST require
   an operator credential (env `TESLASYNC_OPERATOR_TOKEN`), refuse to run
   without it, and emit an audit log line including the operator
   identifier, target vehicle count, and config fingerprint
   (sha256 of the BuildSubscription output). Read-only diagnostic
   binaries (`cmd/unit-drift-validator`) MUST NOT mutate stored data
   under any flag combination.

**Consequences.**
- Adding a new Tesla proto field requires (a) re-vendoring the proto, (b)
  re-running `go generate`, (c) adding a `routing.yaml` entry. Forgetting
  step (c) is a compile/test failure (coverage test in
  `internal/tesla/router/coverage_test.go`).
- A vehicle that has never connected has no `vehicle_unit_history` rows.
  The first emission of a unit-bearing field would have no unit context.
  The bootstrap (REST `/vehicle_data` snapshot from `gui_settings`) closes
  this gap. If both bootstraps fail, the value is dropped + warning logged
  + metric emitted — never silent corruption.
- A future Tesla firmware change to wire-format unit semantics is detected
  by the nightly unit-drift validator (`cmd/unit-drift-validator/`) which
  cross-checks `delta(Position) / delta(time)` vs `ToSI('VehicleSpeed',
  raw, assumed_unit)` and alerts when drift suggests Tesla changed the
  contract.
- Frontend Settings page unit selectors and "Sync from Car" button stay
  app-display-only. They do NOT influence ingestion.
- The single-pipeline invariant means there is no way to emit a value
  through a "fast path" that bypasses unit conversion or routing. Every
  value goes through one path.

**Alternatives considered and rejected.**
- *Patch-only fix on the existing pipeline.* Rejected — leaves the dual
  transform/expander architecture intact, and the hand-curated registry
  problem unsolved. Every patch is one-grep-away from a regression.
- *Fixed wire-format units (Tesla docs interpretation).* Rejected — silent
  cross-border data corruption forever, with no way to detect or recover.
  The proto contract (streamable `Setting*Unit` Field entries) and the
  cost asymmetry settle it. Tesla docs are widely known to have errors.
- *Backfill historical data.* Rejected — there is no production data worth
  preserving (corrupted by the broken pipeline). Resubscribe is faster,
  cheaper, and produces clean data.
- *`current_unit_prefs` JSONB cache instead of `vehicle_unit_history`
  table.* Rejected — out-of-order arrivals (e.g., catch-up backlog after a
  reconnection) require timestamped history, not a current-state cache.

**Enforcement.**
- `go generate ./internal/tesla/protomodel/...` is a CI gate.
- `internal/tesla/protomodel/coverage_test.go` reflects on every
  `ftproto.Field_*` and asserts metadata exists.
- `internal/tesla/router/coverage_test.go` asserts every Field has exactly
  one routing entry.
- `internal/tesla/normalize/normalize_test.go` table-tests the entire
  pipeline end-to-end for representative fields of every category.
- `cmd/unit-drift-validator/` runs nightly and pages on suspected wire-unit
  contract drift.

### Phase-42a Amendment

**Status:** Accepted (phase-42a, 2026-05-06).

**Context.**
Phase-42 (60 prompts, gate PASSED at commit `b1dd7ea4`) built the forward-only
Tesla Fleet Telemetry pipeline rewrite per ADR-004 — vendored proto + codegen
+ reflective coverage, new `internal/tesla/{codec,units,unit_history,bootstrap,
config,router,normalize}` packages, 286-route `routing.yaml` across 12
destinations, SI-canonical schema (migrations 000181-000188), and migrated all
CONSUMERS to read from the new tables (signal store, signal pivot, signal
redis cache, signal state reader, FSM adapter, FSM domain, API fleet
telemetry, API signals, API telemetry handlers, API SSE, frontend typed
envelope, drives, charging, positions+trips, cross-domain). Phase-42 did NOT,
however:
1. Author any production `router.Writer` implementations
   (verified: `grep -rn 'router\.Writer' internal/ --include='*.go' | grep -v
   _test.go` returns 0 lines).
2. Cover the 5 cross-cutting side effects (live store, signal history, SSE,
   FSM, sessions+alerts) that the legacy `(*TelemetryHandler).ProcessSignals`
   performed per payload.
3. Cut over `cmd/teslasync/main.go` to the new subscriber
   (verified: `grep -n 'NewPipelineSubscriber' cmd/teslasync/main.go` returns
   0 lines).
4. Refactor the HTTP webhook ingest (`(*TelemetryHandler).ProcessBatch`) to
   use the pipeline (verified: `normalizeFleetUnits` still called at
   `internal/api/telemetry_handler_ingest.go:512`).

Phase-43's hook-coverage audit (prompt 0080) also surfaced 6 dropped backend
features (`useStateTimeline`, mileage, vampire-drain, guard, signal-catalog,
trip-detail) whose frontend consumers were left orphaned, contradicting the
spirit of "single source of truth" for live state. Phase-42a closes the
backend gaps; phase-43a (separate slate) authors the replacement endpoints.

**Reversal of decision #7 (forward-only schema, no backfill).**

The original text:

> ~~7. **Forward-only schema.** All 38 tables populated by the broken pipeline
> are dropped with `CASCADE` and recreated with SI-canonical schemas. No
> backfill — operator triggers a fleet-wide resubscribe at deploy time, and
> Tesla's process-startup snapshot reseeds all subscribed signals into the
> new schema.~~

is amended to:

> 7'. **Forward-only schema, replacement endpoints required.** All 38 tables
> populated by the broken pipeline are dropped with `CASCADE` and recreated
> with SI-canonical schemas. Backfill is NOT performed, but every dropped
> backend feature that had a frontend consumer MUST have a replacement
> endpoint sourced from the new SI schema (`signal_log`, `fsm_live`,
> `drives_si`, `trips`, etc.). Replacement endpoints are tracked in
> phase-43a (separate slate) and MUST land before any frontend hook can be
> @deprecated-removed. Operator still triggers a fleet-wide resubscribe at
> deploy time, and Tesla's process-startup snapshot still reseeds all
> subscribed signals into the new schema.

The cost/correctness argument against backfilling raw historical telemetry
is unchanged — Tesla's snapshot is faster, cheaper, and produces clean SI
data. What changes is the rule that frontend features can be lost as
collateral damage of a backend refactor: they cannot.

**Addition of decision #11.**

> 11. **AtomicsObserver pattern.** `normalize.New` accepts a variadic list of
> `AtomicsObserver`. `Pipeline.Process` invokes each observer's
> `OnPayloadProcessed(ctx, vehicleID, atomics)` AFTER the route loop
> completes for the payload. Observers own their atomic→map conversion and
> invoke side-effect callbacks (live signal store, signal history writer,
> SSE broadcast, FSM handler, session tracker, alert evaluator). Observers
> MUST NOT mutate the atomics slice. The single production observer is
> `tesla_pipeline.SideEffectsObserver` constructed with the existing 5
> callbacks. Test observers (recording fakes) live in `_test.go` files
> only. A reflective test in the e2e prompt walks the production binary's
> pipeline construction site and asserts a non-empty observer list.
>
> Rationale: preserves the single-public-entry invariant from ADR-004 #2
> (`Process` remains THE one entry from bytes), keeps the pipeline pure
> (codec → unit → route + observer-fanout), and lets the subscriber own
> orchestration. Alternatives considered and rejected: (a) extending
> `Pipeline` with side-effect knowledge (god-object, breaks #2);
> (b) moving side effects into writers (writers must stay best-effort
> idempotent on `(vehicle_id, ts, field)` per ADR-004 #8, and
> payload-scoped effects like FSM cannot be field-scoped);
> (c) re-decoding bytes in the subscriber (double-codec on hot path,
> creates a second mental model of the payload, splits the
> single-pipeline invariant).

**Addition of decision #12.**

> 12. **Single ingest cutover.** `cmd/teslasync` constructs exactly one MQTT
> subscriber: `mqtt.NewPipelineSubscriber`. The legacy `mqtt.NewSubscriber`
> is deleted in the cutover prompt — no feature flag, no parallel
> pipeline, no `if newPipelineEnabled` switch. The deletion + replacement
> is one atomic prompt. The HTTP webhook entry
> (`(*TelemetryHandler).ProcessBatch`) calls `pipeline.Process` directly
> on raw bytes; `normalizeFleetUnits`, `flattenCompoundMapValue`, and the
> per-call `signals := make(map[string]interface{})` adapter are deleted
> from `internal/api/telemetry_handler_ingest.go` in the same prompt.
> Both MQTT and HTTP webhook ingest paths terminate at exactly one entry
> point: `pipeline.Process(ctx, bytes, vehicleID)`.
>
> Rationale: a feature flag would (a) leave dead code at the legacy entry
> point indefinitely, (b) split observability across two pipelines, and
> (c) defer the only test that genuinely matters — production traffic on
> the new pipeline. Phase-42's reflective `TestSinglePipelineInvariant`
> already enforces "no second pipeline"; the hard cutover makes it
> visibly true. Rollback is a one-line revert of the cutover commit, not
> a careful unflipping of a flag.

**Sequencing.** Phase-42a's prompt slate:

| Prompt | Scope |
|---|---|
| 0000 | Methodology + cutover decision + ADR-004 amendment (this prompt) |
| 0010-0023 | Author 12 production `router.Writer` implementations |
| 0030 | Author `tesla_pipeline.SideEffectsObserver` |
| 0040 | Wire DLQ + manual-ack in `cmd/teslasync` |
| 0050 | Cutover MQTT subscriber (delete legacy, replace with PipelineSubscriber) |
| 0060 | Refactor HTTP webhook (`ProcessBatch` → `pipeline.Process`) |
| 0090 | Delete legacy code (`mqtt.Subscriber`, `ProcessSignals`, `normalizeFleetUnits`, `flattenCompoundMapValue`, residual `internal/telemetry/*` shims) |
| 9999 | Final gate |

Phase-43a (replacement endpoints for the 6 orphaned hooks) is sequenced
AFTER phase-42a's final gate because phase-43a's handlers query the new SI
tables — those tables have schema but no data flowing in until phase-42a's
writers + cutover are live. Authoring phase-43a handlers against empty
tables would be untestable end-to-end and unsafe to ship.

### Per-field MQTT Amendment

**Status:** Accepted (2026-05-09).

**Context.**
The upstream Tesla fleet-telemetry MQTT producer (`transmit_decoded_records:
true` in fleet-telemetry's config.json) emits ONE signal per topic of the
form `{topicBase}/{VIN}/v/{Field}` with the bare `json.Marshal` of the
producer's per-Value-variant Go value as the body. The Phase-42 codec was
authored against the proto-batch path (`telemetry/payload/{VIN}` carrying a
serialised `ftproto.Payload`); the per-field path is what Tesla's vendored
config in this repo's helm chart actually ships. Production replays
captured at the Mosquitto broker showed all signal traffic flowing
through the per-field topics, completely bypassing the Phase-42a
PipelineSubscriber's `{base}/payload/+` filter — `signal_log` would
therefore stop populating once the Phase-42a cutover landed without this
amendment.

**Decision.**
1. **Topic shape.** PipelineSubscriber subscribes to `{base}/+/v/+` (4
   segments, both wildcards single-level). Segment 2 is the VIN; segment
   4 is the canonical proto field name. The legacy `{base}/payload/+`
   filter is DELETED in the same commit — no dual-subscribe migration
   period.
2. **Codec entry point.** `internal/tesla/codec.DecodeJSONField(field,
   body, vin, fallbackTs)` is the SINGLE per-field MQTT translation
   point. The production body is an envelope `{"value":<bare>,
   "ts":"<RFC3339Nano>"}` where `ts` is Tesla's original
   `Payload.CreatedAt`; the inner value shape follows
   `protomodel.SignalsByName[field].ValueKind`. Bare values remain
   decoder-compatible for controlled tests and emergency tooling, but the
   production MQTT boundary rejects and quarantines them because replay
   receipt time is not valid event time.
3. **Pipeline interface narrowed.** `mqtt.Pipeline` exposes a single
   method `ProcessAtomics(ctx, []codec.Atomic, vehicleID)` —
   `Process(ctx, []byte, vehicleID)` is removed. This re-affirms ADR-004
   #2 (single ingest entry) and shifts the codec call site to the
   subscriber, which already owns DLQ + redelivery routing for the
   wrapped `codec.ErrPayloadDrop` sentinel.
4. **Failure semantics revised.** Phase-42-era invariant #4 ("codec
   failures trigger MQTT redelivery") is REPLACED by: codec failures
   wrap `codec.ErrPayloadDrop` and route to the DLQ (manual-ack quarantine
   topic) via the existing `handlePipelineError` classifier; the
   subscriber acks the original message so the broker does NOT redeliver
   poison pills. This is safer for per-field traffic because a single
   malformed body would otherwise pin a per-VIN topic forever.
5. **VIN cache.** `internal/mqtt.VINCache` preloads the entire vehicles
   table on startup, refreshes every 5 minutes, and falls back to the
   wrapped resolver on miss (with positive + negative memoisation). The
   cache is mandatory because the per-field hot path resolves
   `VIN → vehicle_id` on EVERY message — without the cache that's a DB
   round-trip per signal at ~5 Hz per vehicle.
6. **Cross-batch accumulator.** `tesla_pipeline.SideEffectsObserver`
   passes a TRUE accumulated map to sessions + alerts (not the
   per-payload signals map as previously deferred under Phase-42a/0000
   Decision #8). The bridge invokes `live.GetAll(ctx, vehicleID)` AFTER
   `live.UpdateAll` so the snapshot reflects the current payload merged
   into all prior batches. This restores the legacy "use last-known
   battery / odometer / location when starting a new session" feature
   under per-field MQTT, where the per-payload map carries one atomic
   and is otherwise insufficient.
7. **Replay tool wire-format parity.** `cmd/pub-test-signal` publishes
   per-field JSON envelopes matching the subscriber's expected shape;
   the legacy proto-batch path is DELETED. Historical CSV captures with
   decomposed `Latitude`/`Longitude` rows are paired into a synthetic
   `Location` compound publish so positions writer end-to-end coverage
   survives the cutover.
8. **No bridge.** A short-lived "mqtt-bridge" pod was prototyped to
   re-encode per-field traffic into the legacy proto-batch shape, then
   rejected: bridges introduce a fail point AND violate the
   "single ingest entry" rule by smuggling two wire formats into the
   same subscriber. The proper fix is the cutover above.

**Consequences.**
- The `{base}/payload/+` topic name is permanently abandoned. Any
  external publisher (replay tools, third-party producers) must publish
  to per-field topics or the subscriber drops their traffic entirely.
- `transmit_decoded_records: true` in upstream fleet-telemetry's
  config.json is REQUIRED. A future fleet-telemetry release that
  removes this knob would break the wire shape; the helm template
  pins the value explicitly.
- The TeslaSync Fleet Telemetry derivative image is REQUIRED until upstream
  preserves `Payload.CreatedAt` in its per-field MQTT output. Deploy the
  timestamp-producing image before or with the strict API consumer. Legacy
  queued bare messages are intentionally quarantined because their original
  event time cannot be reconstructed from MQTT 3.1.1.
- DLQ depth is now a per-field, per-VIN concern — a single vehicle's
  malformed `Soc` body no longer delays neighbour vehicles. This is a
  net improvement, but operators must sweep the DLQ topic regularly to
  catch schema drift (e.g., a Tesla firmware change that introduces a
  new `Field` not yet in `protomodel.SignalsByName`).
- `mqtt.SetPayloadDropSentinel` / `mqtt.PayloadDropSentinel` public
  API are DELETED — the indirection existed only to bridge to
  `normalize.ErrPayloadDrop` which `ProcessAtomics` never returns by
  contract.

**Alternatives considered and rejected.**
- *Bridge pod (legacy → new wire format).* Rejected: extra fail point;
  violates single-ingest-entry; complicates Helm + secrets surface.
- *Dual-subscribe (both topics during migration).* Rejected: doubles
  the failure surface; observability becomes ambiguous (which path
  produced which row?); cutover never actually completes if both
  remain green.
- *Hand-maintained per-field type table.* Rejected: violates the
  "no shortcuts, codegen everything" mandate. Type metadata for the
  per-field decoder is derived from `protomodel.SignalsByName` (already
  codegen-emitted by `cmd/protogen-tesla`).
- *Codec-side enum prefix re-derivation.* Rejected: violates Rule 11
  in `tesla-pipeline.instructions.md`. Codec consumes
  `meta.EnumStringPrefix` (codegen-populated) and never re-derives.

**Enforcement.**
- `internal/mqtt/mqtt.go` `pipelineTopicFilter()` returns the canonical
  `{base}/+/v/+` filter; subscriber tests pin it.
- `internal/mqtt.Pipeline` interface has exactly one method; a
  compile-time check in `internal/tesla_pipeline` asserts
  `*normalize.Pipeline` and the bridge satisfy the interface.
- `internal/tesla_pipeline.SideEffectsObserver` test
  `TestSideEffectsObserver_AccumulatedIncludesPriorBatches` pins the
  cross-batch accumulated contract.
- `internal/tesla/codec.DecodeJSONField` golden tests pin the per-kind
  body shape parity with the proto-batch decoder.

## ADR-005: Frontend SI Cutover (forward-port, no deletions)

**Status:** Accepted (phase-43)
**Context:** Phase 42 rewrote the Tesla telemetry pipeline. Public API endpoints
are preserved, but response shapes are SI-canonical and field names match the
regenerated proto. The React frontend must be forward-ported to consume these
shapes without regressing user-facing functionality.

**Decisions.**
1. **Forward-port only.** Every page, route, hook, and shared component
   present at phase-43 start MUST exist at phase-43 end. UI deletions
   require per-case user approval surfaced via STATUS=BLOCKED. No silent
   stubs (`<EmptyState>` is not a substitute for porting).
2. **SI in, display out.** All API hooks return SI values verbatim. Display
   conversion happens at the render boundary via `web/src/lib/unitConversion.ts`
   (informed by `web/src/hooks/useUnits.ts` user preference). No SI
   assumptions inside hooks; no display assumptions inside `lib/`.
3. **Snake_case from the wire.** Hook return types use the exact JSON tag
   names from the new Go structs (snake_case). The optional `camelCaseKeys()`
   transform is preserved for backward compatibility but new code reads
   snake_case directly to avoid drift.
4. **Typed SSE envelope.** The signal stream uses the typed envelope
   `{ kind: string, value: SIValue, ts: number }` produced by phase-42
   prompt 0072. The client parser is `web/src/api/sseClient.ts` and is the
   only sanctioned consumer of that stream.
5. **Audit, do not prune.** Phase-43's hook/route/i18n coverage prompts
   (0080-0082) BLOCK on orphans rather than delete. Real cleanup is a
   future phase with explicit user approval.
6. **No new direct library imports.** Existing prohibited-pattern rules
   (no inline styles with var(--*), no raw HTML, no direct recharts/leaflet,
   no `/api/v1/` prefix in hook URLs, no camelCase query params) continue to
   apply. Phase-43 prompts run an audit at every gate.
7. **Verification floor.** Every domain prompt's gate runs `npx tsc --noEmit`
   AND `npm run build` AND a violation audit. Failure of any of the three
   blocks the prompt; STATUS=DONE requires all three green.

**Consequences.** The frontend stays at parity with the rewritten backend
without losing pages, without bending engineering rules, and without
accidentally regressing on shared-component or i18n discipline. The cost is
that some pages may need section-by-section reimplementation when their
underlying signal source has changed (e.g., a page reading from
`vehicle_units` snapshots now reads from `vehicle_unit_history` via the new
backend). Such pages are ported, not deleted.

## ADR-008: Observability stack

**Status:** Accepted (phase-44)
**Date:** 2026-05-08

### Decision 1: Purely additive

Phase-44 observability deepening is additive only. Existing tracing, metrics,
alerts, dashboards, Prometheus scrape configuration, Jaeger development wiring,
and `internal/tracing/` bootstrap code are preserved. Audit prompts may block on
coverage gaps, but they do not delete existing instrumentation.

### Decision 2: Self-hosted

The default observability stack is self-hosted: Tempo for traces, Loki for logs,
Prometheus for metrics, and Grafana for dashboards. The default deployment must
not require an external SaaS dependency.

### Decision 3: OpenTelemetry-only API

OpenTelemetry is the only tracing API for new code. The existing
`internal/tracing/` package remains the bootstrap boundary, and new spans use
`otel.Tracer("...")`. Direct Jaeger SDK calls are forbidden in new code; the
legacy Jaeger development service receives traces through the OpenTelemetry
Collector.

### Decision 4: Declarative SLOs

Service-level objectives are declared in `slo/catalog.yaml` and generated into
Prometheus recording rules, Prometheus alerting rules, and Grafana dashboards.
Hand-edited generated rule files are forbidden.

### Decision 5: Multi-window multi-burn-rate alerts

Burn-rate alerts follow the Google SRE workbook multi-window, multi-burn-rate
model. Fast burn alerts use a 1h window at 14.4x and page; slow burn alerts use
a 6h window at 6x and ticket. Single-window `error rate > X` alerts are
forbidden for SLO burn alerts.

### Decision 6: Frontend RUM in scope

Frontend real-user monitoring is in scope through top-level bootstrap only:
`@opentelemetry/sdk-trace-web`, fetch instrumentation, route-change spans, and
error instrumentation. Page and component UI mutations are out of scope.

### Decision 7: Verification floor

Each phase-44 prompt gate runs the relevant verification floor: `go build ./...`,
`go test -race ./...` for changed packages, `golangci-lint run` for changed
packages, `helm lint` for changed charts, `npx tsc --noEmit` and `npm run build`
for changed frontend, plus prompt-specific assertions.

### Locks

- Lock: Additive only — no prompt may remove existing observability assets while deepening coverage.
- Lock: Self-hosted by default — Tempo, Loki, Prometheus, and Grafana are the default stack.
- Lock: OTel API everywhere — new tracing code uses OpenTelemetry APIs only.
- Lock: SLOs are code-generated — catalog-driven generation is the only supported SLO rule/dashboard path.
- Lock: MW-MBR alerts only — SLO burn alerts must use multi-window multi-burn-rate expressions.
- Lock: RUM via bootstrap only — browser telemetry is initialized centrally without per-page UI changes.


## ADR-009: HTTP Handler Canonical Home

```
STATUS: APPROVED (PA, phase-47/06)
DATE: 2026-05-08
SUPERSEDES: implicit "use whichever package you find first"
NUMBERING NOTE: phase-47 prompts 06/07/08 originally requested ADR-005/006/007.
ADR-005 (Frontend SI Cutover, phase-43) and ADR-008 (Observability stack,
phase-44) were already taken. This prompt was renumbered to ADR-009 in the
same commit.

DECISION:
  internal/handler/v1 is the CANONICAL home for new HTTP handlers.
  internal/api is FROZEN: no new .go files may be added.

RULES:
  + ADD new handlers under internal/handler/v1/<name>_handler.go.
  + EDITS to existing internal/api/*.go files are permitted (bug fixes,
     dependency updates, deprecations).
  + MIGRATION of existing internal/api handlers to handler/v1 is
     encouraged but tracked separately (phase-48+).
  + Handlers under handler/v1 MUST call into internal/app/<name>svc
     services. Direct repo or database access is forbidden (arch_test
     enforces - see prompt 10).
  + Handler/v1 + app/<name>svc + adapter/postgres + domain/<name>
     code paths are the canonical SI-units pipeline per Phase-48 (SI
     Canonical Mega-PR). NO new field may carry imperial-unit suffixes
     (DistanceMiles, EnergyUsedKWh, MaxSpeedMph, EfficiencyWhMi,
     TotalMiles, MilesAdded, ChargerPowerKw*). All persisted/transported
     numeric fields are SI: meters, m/s, deg-C, Pa, Wh.
     See: .github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md

  - No new .go file may be created under internal/api (arch_test FAILS).
  - EXCEPTION: `_test.go` files for existing `internal/api/*.go` source
     files ARE permitted, because tests must live in the same Go package
     as the code under test. arch_test MUST distinguish `_test.go` from
     production source. Phase-44 prompts 0011 + 0020 rely on this
     exception.
  - No new sub-directory may be created under internal/api.
  - Do not add new package-level vars to internal/api outside aliases
     created by phase-47/05 deprecation.
  - No new imperial-unit field names anywhere in handler/v1, dto,
     app/*svc, domain/*, or adapter/postgres (Phase-48 SI canonical
     mandate). Display conversion is React-only via useUnits/useFormatting.

RATIONALE:
  - Hexagonal scaffolding (domain, port, adapter, app, handler) is
    already in place and partially populated.
  - internal/api grew procedurally to 223 files with mixed concerns;
    further additions deepen the technical debt.
  - handler/v1 + app/<name>svc give us testable, layer-respecting code.

ROLLBACK:
  If handler/v1 + app proves insufficient (e.g. perf regressions on a
  hot endpoint), record an exception under "ADR-009 Exceptions" in this
  file with rationale and an issue link. Do not silently bypass the
  freeze.
```

### ADR-009 Exceptions

Each row below is an explicit, reviewer-approved exception to the
internal/api freeze. Refreshing the archmetrics baseline alone is NOT
enough — every new file must be listed here with rationale, otherwise
it will be reverted on next review.

| Date       | Phase / Prompt                | Files (relative to internal/api/)                                                                                                                                                                                 | Rationale                                                                                                                                                                                                                                                                                                                                                                                |
|------------|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 2026-05    | phase-43a/0007                | `signals_catalog_handler.go` + `_test.go`                                                                                                                                                                         | Admin diagnostics endpoint; constructed in `router.go` from `routing.yaml` (compile-time embedded) + `signals_catalog_repo`; thin orchestration only. handler/v1 would have required a `port/signalcatalog` + `app/signalcatalogsvc` for a read-only admin surface with zero domain logic — high churn for no testability gain.                                                          |
| 2026-05    | phase-43a/0008                | `trips_detail_handler.go` + `_test.go`                                                                                                                                                                            | Co-located with `trip_handler.go` (also legacy in internal/api); detail endpoint is a SUPERSET of the list shape and shares the same DTO assumptions. Splitting only the detail route across two layers would break that invariant.                                                                                                                                                       |
| 2026-05    | phase-46/41                   | `queue_status_handler.go` + `_test.go`                                                                                                                                                                            | Admin job-queue inspector for the React Diagnostics panel; reads `WorkerStatusStore` (Redis) + `WorkerQueueRepo` (pg). The store + repo already live under their canonical packages; handler is the THIN orchestrator the freeze is meant to permit when no app/svc is justified.                                                                                                          |
| 2026-05    | phase-44 (observability batch) | `dlq_handler.go` + `_test.go`<br>`flags_handler.go` + `_test.go`<br>`ingest_xray_handler.go` + `_test.go`<br>`drive_diagnostic_handler.go` + `_test.go`                                                              | Admin observability surface for the React Diagnostics panel. Each handler accepts a narrow interface (`ingestXRayRepo`, `driveLookup`, `driveDiagnosticReader`, `*flags.Store`, `*mqtt.DLQInspector`) constructed in `router.go` from canonical packages (`internal/database`, `internal/flags`, `internal/mqtt`). Follows the same precedent as phase-43a/phase-46 admin handlers above. |
| 2026-05    | phase-46 SOTA batch           | `slo_handler.go`<br>`dataquality_handler.go`<br>`synthetic_handler.go`                                                                                                                                              | Live SLO board (`/admin/observability/slo`), data-quality scoring + lineage (`/admin/observability/data-quality`, `/admin/observability/lineage`), and synthetic monitoring (`/admin/observability/synthetic`). Each handler is a 30-50 LOC orchestrator over `internal/slo`, `internal/dataquality`, and `internal/synthetic` — the substantive logic + tests live in those packages. handler/v1 would require 3 mirror packages (`port/slo`, `app/slosvc`, etc.) per subsystem for zero behaviour; the freeze is meant to permit exactly this case.            |
| 2026-05-28 | phase R2.0e (apperror carve)  | `apperror_bridge_test.go`                                                                                                                                                                                         | Regression-test pin that asserts every parent `Err*` var still points at the canonical `apperror.Err*` after the catalog carve into `internal/api/apperror/`. MUST live in `package api` because it is the only context that can name both `internal/api.Err*` and `internal/api/apperror.Err*` together. README/static `arch_test.TestFrozenPackagesNoNewFiles` exempts `_test.go` files; the runtime `-compare` tool counts them, hence this explicit row.        |
| 2026-05-28 | phase R2.0f (apibulk carve)   | `bulk_helpers_bridge_test.go`                                                                                                                                                                                     | Regression-test pin that asserts the parent `MaxBulkIDs` const + `bulk*` type aliases + `errBulk*` var bridges + helper wrappers in `bulk_helpers.go` still delegate to the canonical `apibulk` symbols after the catalog carve into `internal/api/apibulk/`. Same rationale as the apperror bridge test above — MUST live in `package api` to name parent + subpkg symbols together.        |
| 2026-05-28 | phase R2d.109 (aichatbot carve) | `ai_test_helpers_test.go`                                                                                                                                                                                       | Shared `stubGuardSettings` test helper used by the remaining `package api` AI handler tests (`ai_admin_handler`, `ai_internal_handler`, `ai_settings_validate_handler`, `ai_usage_handler`) that have NOT yet been carved. Extracted out of `aichatbot/handler_test.go` to avoid duplication across the still-in-api tests. Will be removed when the last in-api AI handler is carved.  |
| 2026-05-28 | phase R2d.127 (aicostfcst carve) | `ai_cost_forecast_forecaster_test.go`                                                                                                                                                                          | Tests the `NewAICostForecaster` production adapter constructor in `ai_cost_forecast_forecaster.go` (still in `package api` because it implements `forecast.CostForecaster` and is wired in `router.go`). Test asserts nil-DB panic + compile-time interface satisfaction; MUST live in `package api` to name the unexported adapter. Will move with the adapter when forecaster is carved. |

Future admin/observability handlers SHOULD follow the same pattern:
narrow interface in the handler file, concrete `*Repo` from
`internal/database`, wired in `router.go`. A new row in this table per
batch keeps the exception ledger honest.


## ADR-006: Models vs Domain Charter

```
STATUS: APPROVED (PA, phase-47/07)
DATE: 2026-05-08
SUPERSEDES: implicit "use whichever package you find first"
NUMBERING NOTE: an unrelated subsection-level "### ADR-006: Mutation UX
Feedback" exists under ADR-002 (Authentication Architecture) at
.github/ARCHITECTURE.md:406. That is a nested sub-decision in the
ADR-002 sequence and is scoped to that section; this top-level
"## ADR-006:" is the next free top-level ADR number after the
existing 001-005, 008, 009. The two enumerations live at different
heading levels (## vs ###) by pre-existing convention; future
ADR-NNN prompts should anchor their grep checks with "^## ADR-NNN:"
to avoid matching the subsection sequence.

DECISION:

  internal/models/    = persistence + transport DTOs
                        - Every exported field of every exported struct
                          carries `db:"..."` or `json:"..."` (or both).
                          arch_test enforces.
                        - Pointer fields for nullable columns.
                        - Methods limited to ToDomain() / FromDomain() and
                          simple validators.
                        - Imports: stdlib + time + (allowed exception)
                          internal/domain types referenced via
                          ToDomain/FromDomain.
                        - May NOT import internal/database,
                          internal/adapter/*, internal/api,
                          internal/handler/*, internal/app/*, or
                          internal/port/*. arch_test enforces.

  internal/domain/<X>/= business entities + value objects + invariants
                        - Imports: stdlib + other internal/domain/*
                          subpackages (including the parent
                          internal/domain package) ONLY. arch_test
                          enforces.
                        - May NOT import internal/models,
                          internal/database, internal/adapter/*,
                          internal/api, internal/handler/*,
                          internal/app/*, internal/port/*.
                        - Rich methods enforcing invariants permitted.
                        - MAY carry `db:"..."` / `json:"..."` tags
                          (today's types do; this is grandfathered).
                          Tags are NOT prohibited; the rule is the
                          IMPORT boundary, not tag presence. Future
                          types should minimize tags when feasible.

CONVERSION POLICY:
  - Repos in internal/adapter/postgres or internal/database return
    models.X by default. The matching internal/app/<name>svc method
    calls models.X.ToDomain() before applying business logic.
  - HTTP handlers under internal/handler/v1 accept request DTOs from
    internal/handler/dto and convert via dto -> domain.

RATIONALE:
  - Today's practice was undocumented; this ADR codifies what is
    actually safe to enforce: the import boundary. Domain stays
    portable (no DB or HTTP coupling); models stays persistence-aware.
  - Persistence-first refactors (TimescaleDB column changes) touch
    models; business-rule changes touch domain.
  - The "domain MAY have tags" relaxation is honest: most domain types
    under internal/domain/<X>/types.go currently carry json/db tags
    (legacy from pre-charter migration). Mass-stripping them is out
    of scope for this prompt. The arch_test enforces the rule we can
    defend today (imports), not the rule we'd like to defend
    eventually (no tags in domain).

EXCEPTIONS:
  - Legacy types under internal/api/* (FROZEN per ADR-009) often blur
    the line. They are grandfathered until the per-endpoint migration
    moves them. arch_test does NOT enforce the charter on
    internal/api.
  - The vendored Tesla proto (api/proto/tesla/) carries upstream-named
    identifiers that may violate Phase-48 SI canonical naming (e.g.
    proto field 256 ChargeRateMilePerHour whose wire content is
    meters of range added per hour). The proto identifier MUST stay
    verbatim (it is upstream-owned); the misnomer is documented via
    SignalMeta.UnitKind + the JSON wire field name + the
    TestRangeAddedMetersPerHour_R2_AuditPin invariant. This ADR's
    import test does NOT touch internal/tesla/protomodel/.

PHASE-48 SI CANONICAL HARD RULE:
  All numeric fields in internal/models/, internal/domain/<X>/,
  internal/handler/dto/, internal/app/<X>svc/, and
  internal/adapter/postgres/ MUST use SI units: meters (not miles),
  m/s (not mph), Wh (not kWh), Pa (not psi/bar), degC (not degF).
  Field name suffixes must reflect the unit (M for meters, MS for
  m/s, Wh for watt-hours, Pa for pascals, C for celsius). User-
  setting fields that are configuration not measurement (e.g.
  BaseCostPerKWh, cooldown_min, value_min, dwell_minutes) are
  explicitly allowed to keep human-readable units. See:
  .github/prompts/db-refactor/phase-48-si-canonical/0000-methodology.prompt.md

ROLLBACK:
  - If maintaining two parallel hierarchies proves too costly,
    propose a superseding ADR with a clear merge plan. Do not
    silently merge.
```


## ADR-007: internal/platform/ Charter

```
STATUS: APPROVED (PA, phase-47/08)
DATE: 2026-05-08
SUPERSEDES: implicit "platform = anywhere shared"
NUMBERING NOTE: an unrelated subsection-level "### ADR-007: Live Signal
State Layering (Scale-Out Contract)" exists at
.github/ARCHITECTURE.md:201 as a nested decision under ADR-002. The two
enumerations live at different heading levels (## vs ###). Future
ADR-NNN gates anchor on "^## ADR-NNN:" to avoid matching the
subsection sequence (see ADR-006 NUMBERING NOTE for the same pattern).

DECISION:

  internal/platform/ contains CROSS-CUTTING INFRASTRUCTURE that:
    - Is not specific to a bounded context (otherwise it belongs in
      internal/domain/<X> or internal/app/<X>svc).
    - Is not a port interface (otherwise internal/port/...).
    - Is not an adapter to an external system (otherwise
      internal/adapter/<name>).
    - Does not host HTTP request handlers (otherwise
      internal/handler/v1).

  Examples of LEGITIMATE platform/ residents:
    - HTTP client construction with shared timeouts and middleware
    - Generic pagination/cursor helpers
    - Reusable middleware (request ID, panic recovery)
    - Build-time metadata
    - OpenTelemetry plumbing (will be renamed to platform/observability
      in phase-48 — see EXISTING SUBPACKAGES)

EXISTING SUBPACKAGES (charter status):

  platform/buildinfo  → CANONICAL. Houses build-time metadata
                        (Version/Commit/BuildDate ldflags + Info()
                        accessor + /version Handler). NO duplicate
                        exists at internal/buildinfo (phase-47/04
                        explicitly chose not to extract; the package
                        is single-purpose with zero callers needing
                        layer separation). Future: stay here.
  platform/cache      → DEPRECATED. Canonical home is internal/cache
                        (4 .go files). Audit duplication; consolidate
                        in phase-48.
  platform/config     → DEPRECATED. Canonical home is internal/config
                        (4 .go files). Audit duplication; consolidate
                        in phase-48.
  platform/database   → DEPRECATED. Canonical home depends on type:
                        - generic SQL helpers → internal/adapter/postgres
                        - higher-level repo wrappers → internal/database
                        (123 .go files). Audit; consolidate in phase-48.
  platform/httputil   → CANONICAL. Charter: shared HTTP client
                        construction with circuit-breaking, timeouts,
                        retry, rate-limit, and request/response
                        logging hooks consumed by internal/apilog.
  platform/telemetry  → KEEP. Will be RENAMED to platform/observability
                        in phase-48 to avoid collision with
                        internal/telemetry (phase-42 territory).
                        Charter: OpenTelemetry tracer + meter
                        provider plumbing.

NEW PLATFORM SUBPACKAGES require an ADR amendment + reviewer sign-off.
arch_test (TestPlatformSubpackagesGated) fails on unrecognised
platform/<name> directories not present in
internal/arch/rules.go::AllowedPlatformSubpackages.

RATIONALE:
  - Today's organic growth produced three duplicates (cache, config,
    database) with no source-of-truth designation.
  - Charter clarifies WHEN platform/ is the right answer (cross-cutting
    + no specific layer fits) vs WHEN to use a specific layer.
  - Deprecation of duplicates is recorded; consolidation tracked under
    phase-48 (see docs/architecture/platform-consolidation-todo.md).
  - buildinfo is NOT deprecated despite originally being slated for
    extraction in phase-47/04 — that prompt's deviation note (commit
    56de71940) explicitly justified keeping it where it is. ADR-007
    ratifies that decision.

ROLLBACK:
  - If a deprecation creates an unsolvable circular dep, propose a
    superseding ADR with rationale. Do not silently restore.
```


## ADR-010: Repo Reorganization Mandate (Clean Architecture finishing pass)

```
STATUS: APPROVED (user mandate, 2026-05-27)
DATE: 2026-05-27
BRANCH: chore/repo-reorganization (off main @ e1550655)
RELATED: ADR-006 (Models vs Domain), ADR-007 (platform/ charter),
         ADR-009 (handler/v1 canonical, internal/api FROZEN)
PLAN: docs/architecture/repo-reorganization-plan.md

USER MANDATE (verbatim):
  > "we need to properly organize our repo code both frontend and
  >  backend. industry leading guidelines"
  > "must use proper state of art design patterns"
  > "Proper Work. Proper linting. proper state of art design patterns.
  >  No shortcuts no anti-patterns. If you see something broken fix it
  >  dont leave it. we must not have any tech debt remaining."
  > "its ok even it takes weeks or months. we need proper work"

DECISION:
  This branch executes the finishing pass on the Clean Architecture
  shape established by Phase-47 (ADR-006/007/009) and the SI canonical
  units shape established by Phase-48. It is NOT a re-architecture: the
  hexagonal scaffolding (domain/port/adapter/app/handler) already exists
  on main, the arch_test foundation already gates layering, and the
  Phase-48 SI rename has already landed. The remaining work is to:

    1. CLEAN UP repo hygiene (root binaries, coverage artifacts,
       orphan markdown, scattered seeds/scripts).
    2. SPLIT the .github/ARCHITECTURE.md mega-file into per-ADR files
       under docs/architecture/adr/. Mirror .github/instructions/ into
       docs/architecture/instructions/. .github/ stays canonical for
       Copilot tooling; docs/ is the human-readable canonical source.
    3. INSTALL frontend FSD layer enforcement via eslint-plugin-boundaries
       with the current dir → FSD layer mapping (no folder rename).
       Eliminate cross-feature imports.
    4. FINISH the frontend SI cutover (classify the ~346 remaining
       legacy unit-suffixed identifiers as CONFIG / DISPLAY / FIX;
       execute the FIX set).
    5. EXTEND tools/archmetrics + add depguard rules to enforce the
       full Clean Arch DAG with per-legacy-package ratchet (allowlist
       current count; net-new violations fail CI).
    6. MIGRATE the remaining ~422 handlers from frozen internal/api/
       (currently 434 files; 12 migrated to handler/v1/) to
       handler/v1 + app/<x>svc + dto/, slice-by-slice per the recipe
       in docs/architecture/repo-reorganization-plan.md §6.
    7. RESHAPE notification/notifier/webpush into Clean Arch
       (domain + svc + port + channel adapters) as a single C6 slice.
    8. AUDIT remaining ADR-009 admin/observability exceptions per file;
       result is the final justified list, NOT zero.

  Clean Architecture mapping for this codebase:
    Entities          → internal/domain/<X>/
    Use Cases         → internal/app/<X>svc/
    Interface Adapters→ internal/handler/v1/
                      + internal/handler/dto/
                      + internal/adapter/<X>/
                      + internal/database/  (kept as repo layer per ADR-006)
                      + internal/models/    (persistence/transport DTOs per ADR-006)
    Frameworks/Drivers→ cmd/* + third-party libs

  Ports live AT THE CONSUMER BOUNDARY (i.e. where the svc consumes the
  capability), not 1:1 per adapter. Shared interfaces go in
  internal/port/<domain>/; svc-local interfaces live inline in the svc
  file. This avoids interface explosion.

RULES:
  + Every NEW handler MUST land in internal/handler/v1 (already an
     ADR-009 rule; restated here as the destination).
  + Every NEW use case MUST land in internal/app/<X>svc.
  + Every NEW external dependency MUST be expressed as a port; the
     consuming svc MUST depend on the port, not the concrete adapter.
  + No new business handler may land in internal/api. Admin/observability
     thin handlers may be added ONLY with an explicit row in the
     ADR-009 Exceptions table.
  + Frontend: no new cross-feature import. Shared logic goes in
     components/, hooks/, lib/, api/, or entities/.
  + Behavioural parity is a hard merge gate per migrated route:
     pre/post JSON snapshot diff reviewed, OpenAPI diff reviewed,
     frontend hook smoke-tested.
  + Architecture enforcement runs in RATCHET mode: legacy packages
     have an allowlist of current violation counts; net-new violations
     in ANY package fail CI.

  - Do NOT delete internal/api as a goal in itself (admin exceptions
     stay documented per ADR-009 carve-outs).
  - Do NOT rename internal/database/ to internal/adapter/postgres/ in
     this branch (143 files, 208 importers, ADR-002 names accessors
     explicitly — out of scope).
  - Do NOT restructure internal/ai/ in this branch (394 files, ADR-015
     AI-Off Contract owned — separate project).
  - Do NOT restructure internal/tesla/, internal/signal/,
     internal/tesla_pipeline/, or any telemetry pipeline package
     (Phase-42 owned per ADR-004).
  - Do NOT flip golangci errcheck / SA1019, no-explicit-any, or
     exhaustive-deps to error in this branch (strict-lint cascade is a
     separate quality project).
  - Do NOT rename web/src/features/ to canonical FSD names. FSD =
     layer RULES, not folder names. The boundaries plugin maps current
     dirs to FSD layers; existing names are preserved.

RATIONALE:
  - Phase-47 established the architecture; Phase-48 cleaned the units;
    this branch finishes the migration that those phases scaffolded.
  - User mandate explicitly accepts a months-long effort, so we use
    a slice-atomic, behavioural-parity-gated migration recipe instead
    of a big-bang rewrite that would create unmergeable conflict
    surfaces.
  - Out-of-scope items are excluded not because they don't matter but
    because they are independent of "repo organization" — each is its
    own substantive project deserving its own ADR.

ROLLBACK:
  - Each migrated slice is independent. If a slice introduces a
    regression caught after merge, revert that slice's commit; the
    handler under internal/api/ can be restored via git revert and
    re-mounted on the router. archmetrics baseline ticks back up by N.
  - If the whole branch is judged a regression, it can be abandoned
    without affecting Phase-47 (which is already on main) or Phase-48
    (already on main).
  - ADR-010 itself is not load-bearing for production; it is a project
    charter.

DEFINITION OF DONE:
  See docs/architecture/repo-reorganization-plan.md §8 for the full
  checklist. Headline:
    - Root contains no stale binaries / coverage artifacts / orphan md
    - depguard + archmetrics + eslint-plugin-boundaries enforce DAG
    - Zero unjustified cross-feature imports in web/src/features/
    - web/src/entities/ holds genuinely shared types
    - internal/api/ contains only documented admin exceptions + router
    - ADR-011 (Clean Arch destination) authored
    - Behavioural parity: per-route snapshot diffs, OpenAPI diff,
      Docker smoke + signal-log replay parity, bundle size delta ≤ ±5%
    - docs/architecture/{clean-architecture,fsd}.md + CONTRIBUTING.md
    - One consolidated CHANGELOG.md entry

OUT OF SCOPE (explicit, see plan §9):
  AI subsystem, internal/database rename, strict-lint cascade,
  telemetry pipeline restructure, Tesla vendored proto, internal/signal
  layering, FSM design, database schema changes, new frameworks,
  features/ folder rename.
```


## ADR-011: Bounded-Context Subpackages for Flat-Folder Hot-Spots

```
STATUS: PROPOSED (commit pending; R0 deliverable)
DATE: 2026-05-28
DECIDERS: User mandate (maximalist scope, 2026-05-28) + Copilot CLI
RELATED: ADR-006 (Models vs Domain), ADR-007 (platform/ charter),
         ADR-009 (handler/v1 canonical; LIFTED for Phase R, then
         RE-APPLIED to NEW subpkgs after R2e), ADR-015 (amendment
         in 015-amendment-ai-scope.md narrows scope for Phase R).
FULL TEXT (canonical): docs/architecture/adr/011-bounded-context-subpackages.md
PLAN: docs/architecture/repo-reorganization-plan.md §16 (Phase R)

CONTEXT:
  6 backend folders + 7 frontend folders exceed 30 source files in a
  single flat package/namespace. Largest: internal/api/ (434 files,
  one package), web/src/features/dashboard/widgets/ (121 files, one
  dir). Flat namespaces make navigation, code review, archmetrics
  per-subpkg rules, and parallel work all harder.

DECISION:
  Every backend folder ≥30 .go files is split into bounded-context
  SUBPACKAGES with short idiomatic Go names (Option A — `package
  charging`, not Option B `package chargingapi`).
  Every frontend folder ≥30 .ts/.tsx files is split into bounded-
  context SUBDIRS with category names. Patterns rooted at `src/...`
  in ESLint configs (ESLint cwd is `web/`, not the repo root).

  Subpackage names match across layers:
    internal/api/charging/, internal/handler/v1/charging/,
    internal/database/charging/, internal/app/chargingsvc/,
    internal/domain/charging/, internal/models/charging/.

ALIAS CONVENTION (MANDATORY at multi-layer-import callsites):
  | Layer                       | Alias suffix       | Example                              |
  |-----------------------------|--------------------|--------------------------------------|
  | internal/api/<x>            | <x>api             | chargingapi "internal/api/charging"  |
  | internal/handler/v1/<x>     | <x>handler         | charginghandler "..."                |
  | internal/database/<x>       | <x>db              | chargingdb "..."                     |
  | internal/models/<x>         | <x>model           | chargingmodel "..."                  |
  | internal/domain/<x>         | <x>domain          | chargingdomain "..."                 |
  | internal/app/<x>svc         | <x>svc (existing)  | chargingsvc "..." (grandfathered)    |
  | internal/jobs/<x>           | <x>jobs            | chargingjobs "..."                   |
  | internal/ai/tools/<x>       | <x>aitools         | chargingaitools "..."                |
  At single-import callsites, no alias is required.

PARENT-DIR MECHANICAL RULE:
  Parent dirs (internal/api/, internal/database/, etc.) contain
  ONLY: doc.go + composition file (router.go, registry.go) +
  middleware/shared-helper subpackages (e.g. internal/api/httpx,
  internal/api/apiparams, internal/api/apitest) + the resource
  subpackages. NO handler/repo/model files at the parent level.
  Enforced by archmetrics: parent glob (*.go excluding subdirs)
  MUST match only doc.go|router.go|<composition>.go.

RESOURCE-PACKAGE PUBLIC API:
  Each resource pkg exposes a narrow constructor + Mount(r
  chi.Router, deps Deps) (or RegisterRoutes). Parent router.go
  imports resource pkgs and calls Mount — it does NOT reach into
  handler internals. Same Registry pattern for database.

OPTION B GRANDFATHERED:
  Existing suffixed packages (chargingsvc, tripsvc, etc.) are NOT
  renamed. Greenfield → Option A.

REPORT-MODE (TODAY):
  tools/archmetrics/main.go has a `plannedSubpackages` table; the
  generated baseline.md ends with a "Phase R progress" section
  showing flat-parent file counts + existing vs missing planned
  subpkgs. Never fails the gate — Phase R13 flips to enforced.
  web/eslint.config.js has matching report-mode boundaries
  descriptors with capture groups (domain, purpose, feature,
  kind). Rules permissive (default: 'allow') until R13.

BARREL-ONLY SCOPE (per rubber-duck #14):
  Strict barrel rule (no-private at error) applies to
  components/* categories ONLY. lib/ and hooks/ permit direct
  subpath imports like `@/lib/format/date` to preserve
  tree-shaking.

CONSEQUENCES:
  (+) Smaller packages → better godoc, faster IDE indexing,
      clearer ownership; archmetrics expresses per-subpkg rules.
  (+) ESLint boundaries enforces no-cross-subpkg-without-barrel
      for components/*.
  (-) Mass `git mv` commits make `git blame` noisy → mitigated
      via `.git-blame-ignore-revs` (every R-phase move commit
      added).
  (-) Some subpkg names collide with stdlib (api, admin) →
      alias at import site per table above.
  (-) Phase R adds 4-8 weeks (user accepted).
  Trade-off accepted: short names across api/database/models/
  domain layers are more collision-prone than the Kubernetes-
  style precedent. Idiomatic at DEFINITION site + deterministic
  aliases at BOUNDARY/composition sites.

ROLLBACK:
  Pure file-moves + import-path updates. Single `git revert
  <SHA-range>` per cluster commit. No schema, route, or contract
  change. Phase R0 publishes coordination note
  (docs/architecture/migration/phase-r-coordination-note.md)
  with rebase guidance for any concurrent main work.
```

## ADR-015 AMENDMENT: AI Subsystem In-Scope for Repo Reorganization (Phase R)

```
STATUS: AMENDMENT to ADR-015 (AI-Off Contract)
DATE: 2026-05-28
DECIDERS: User mandate ("we need to cover whole app", maximalist
          scope selection 2026-05-28) + Copilot CLI
FULL TEXT (canonical): docs/architecture/adr/015-amendment-ai-scope.md
PLAN: docs/architecture/repo-reorganization-plan.md §16 (Phase R)
RELATED: ADR-011 (Bounded-Context Subpackages), ADR-009.

DECISION:
  The ADR-015 carve-out that excluded the AI subsystem from
  reorg-scope work is LIFTED FOR PHASE R ONLY.
    - internal/ai/tools/ (109 files) restructures into bounded-
      context subpkgs per ADR-011 (R6).
    - web/src/components/ai/ (61 files) restructures into per-
      AI-feature subdirs per ADR-011 (R12).
  Scope is FILE-MOVE-ONLY: no AI logic, no prompts, no
  contracts, no providers, no runtime behavior changes.

IN SCOPE OF THIS AMENDMENT:
  - Move existing .go files under internal/ai/tools/ into
    bounded-context subpkgs (nl/, alert/, charge/, drive/,
    auto/, voice/, route/, safety/, ...).
  - Move existing .tsx files under web/src/components/ai/
    into per-AI-feature subdirs.
  - Update package declarations + import paths only.
  - Add doc.go to each new subpkg with `// Layer:` line.

NOT IN SCOPE (still ADR-015 owned, UNCHANGED):
  - AI feature-flag enforcement (`withAiFeature` HOC + ESLint
    rule `teslasync/ai-component-must-be-wrapped`).
  - AI-off-by-default contract.
  - ANY change to AI runtime behavior, prompts, providers, or
    contracts.
  - The `internal/ai/` PROVIDER subsystem (only internal/ai/
    tools/ is in scope).
  - The AI eval workflow (.github/workflows/ai-eval.yml).

MANDATORY PHASE R GATES FOR AI FILES (R2d + R12):
  1. AI guard preservation: grep verify EVERY /api/v1/ai/*
     route still wraps through sanctioned AI guard; mount
     chain unchanged.
  2. `make ai-vet` PASS at every commit touching internal/ai/
     tools/ OR web/src/components/ai/.
  3. ai-eval workflow PASS on the cluster commit and on the
     subsequent verify-full gate.
  4. The `teslasync/ai-component-must-be-wrapped` ESLint rule
     remains at ERROR for every AI surface file regardless of
     subdir.

ROLLBACK:
  Pure file-moves + import-path updates. Single `git revert
  <SHA-range>` per cluster commit. If ANY of the four gates
  fail, REVERT the offending commit immediately — never patch
  forward.

SUNSET:
  This amendment expires when Phase R completes (R14 baseline
  committed). After Phase R, the ADR-015 contract resumes its
  original wording: AI subsystem changes require explicit
  ADR-015 amendment.
```
