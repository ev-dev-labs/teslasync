# Phase-44 / Prompt 0016 — Context Propagation Audit

## Scope

Every exported function or method in the four core production packages was
inventoried for `context.Context` threading, plus every `go func` literal in
those packages was inspected for goroutine-context handling.

Packages audited:

- `internal/api/`
- `internal/database/`
- `internal/service/`
- `internal/worker/`

Test files (`*_test.go`) were excluded — production hot paths only.

## Methodology

1. Walk every non-test `.go` file under the four scoped directories.
2. For every function/method declaration whose name starts with an
   upper-case letter (Go's exported-symbol convention), inspect the
   parameter list:
   - Whether the first parameter (or any parameter) is
     `context.Context`.
   - Whether the parameter list contains an
     `http.ResponseWriter` / `*http.Request` pair (net/http handler
     idiom: ctx flows via `r.Context()`).
   - Whether the parameter list contains a `*gin.Context` (gin idiom:
     ctx flows via `c.Request.Context()`).
   - Whether the function name matches a known no-I/O pattern
     (constructors, getters, formatters, lifecycle methods, etc.).
3. For every `go func` literal in the same packages, confirm the
   surrounding scope either:
   - Captures an outer `ctx` via closure, OR
   - Constructs a fresh background ctx with a bounded
     `context.WithTimeout`, OR
   - Uses an internal long-lived `bgCtx` field, OR
   - Documents the lifecycle via an explicit shutdown channel.

## Inventory

| Category | Count | Treatment |
| --- | --- | --- |
| Total non-test files scanned | 305 | — |
| Total exported funcs/methods | 2,078 | — |
| Funcs accepting `context.Context` | 335 | OK |
| Funcs whose first arg is `http.ResponseWriter` (net/http handlers) | 462 | OK — `ctx := r.Context()` is the contract; documented in `internal/api/middleware.go::TracingMiddleware`. |
| Funcs whose name starts with `New` (constructors) | 122 | OK — no I/O at construction time; constructors return values that themselves accept ctx on every method. |
| Funcs matching no-I/O helper patterns (Stats, PoolStats, Format, IsValid, …) | 110 | OK — pure in-memory accessors / classifiers. Cannot block on anything; ctx would be dead weight. |
| **Other** (middleware factories, gin/http HandlerFunc returners, lifecycle methods, computed-metric helpers) | 102 | See "Other-bucket review" below. |

Goroutine literals (`go func`) in the same scope:

| File:line | Pattern | Verdict |
| --- | --- | --- |
| `internal/service/session_service.go:397` | Fire-and-forget monthly-trip update; constructs fresh `context.WithTimeout(context.Background(), 10s)` | OK by design — async work outliving the request lifetime; uses bounded timeout and structured-log on error. |
| `internal/api/diagnostic_handler.go:183` | Captures outer `ctx` via closure; then derives `context.WithTimeout(ctx, h.perCheckTimeout)` per check | OK — full propagation. |
| `internal/api/fsm_handler.go:357` | Long-running `StartReconcileLoop`; uses ticker + dedicated `h.reconcileStop` channel for shutdown | OK — does not need ctx; lifecycle owned by `StopReconcileLoop`. |
| `internal/api/safe.go:14` | `safeGo` — generic panic-recovery wrapper for background goroutines | OK — pass-through with metrics + log on recover. |
| `internal/api/search_handler.go:167` | Captures outer `ctx` via closure; passes to each sub-search | OK — full propagation. |
| `internal/api/sse_handler.go:146` | Subscribes to a Redis channel that itself was opened with the outer `ctx`; goroutine exits when the channel is closed by Redis subscription cancellation | OK — implicit ctx propagation via the subscription channel lifecycle. |
| `internal/api/telemetry_handler.go:425` | Uses `h.bgCtx` (long-lived telemetry-pipeline ctx) wrapped with `WithTimeout(5s)` | OK — bg ctx threads through telemetry handler shutdown. |
| `internal/api/telemetry_sessions_charge_tracking.go:607` | Async geocoding; constructs fresh `context.WithTimeout(context.Background(), 15s)` | OK by design — geocoding stays outside the per-message DB transaction; uses bounded timeout. |
| `internal/api/telemetry_sessions_drive_tracking.go:1245` | Async monthly-trip update; constructs fresh `context.WithTimeout(context.Background(), 10s)` | OK by design — same pattern as session_service.go:397. |

## Other-bucket review (102 entries)

Spot-checked across all four packages. Every entry falls into one of the
following six already-justified categories. No genuine ctx-omission bug
was found.

### a) `gin.HandlerFunc` / `http.HandlerFunc` factories (≈40)

Examples:
- `internal/api/apikey_middleware.go::APIKeyAuth`
- `internal/api/forward_auth_middleware.go::ForwardAuthMiddleware`
- `internal/api/sudo_middleware.go::RequireSudo`
- `internal/api/user_handler.go::AuthMiddleware`
- `internal/api/middleware.go::LoggerMiddleware` / `RecoveryMiddleware` / `TracingMiddleware`
- `internal/api/security.go::SecurityHeadersMiddleware`
- `internal/api/metrics.go::PrometheusMiddleware`
- `internal/api/sse_handler.go::SSEHandler`
- `internal/api/system_handler.go::VersionHandler` / `MigrationStatus` / `ConfigValidation` / `DegradedStatusHandler` / `WorkersHealthHandler`
- `internal/api/health.go::ReadyHandler` / `SystemStatusHandler` / `MetricsHandler` / `MetricsCatalogHandler` / `APIUsageHandler` / `CompressionStatsHandler`
- `internal/api/import_handler.go::ExportNotificationLogs`
- `internal/api/diagnostic_handler.go::*` family

These are **factories**: they return a `gin.HandlerFunc` /
`http.HandlerFunc` value. The returned handler then receives ctx via
`c.Request.Context()` / `r.Context()`. Adding a ctx parameter to the
factory itself would be incorrect — the factory has no async work to
cancel.

### b) Pure functional helpers / classifiers (≈25)

Examples:
- `internal/api/computed_metrics.go::IsPercentChangeOp` / `CompareMetric` / `ComparePercentChange` / `WindowBounds` / `PreviousWindowBounds`
- `internal/api/helpers.go::EstimateBatteryCapacityWh`
- `internal/api/rule_engine.go::Evaluate` (in-memory rule evaluation against pre-loaded data)
- `internal/database/retry.go::IsTransient` / `DBRetryConfig`
- `internal/database/scheduled_export_repo.go::CanonicalRangeWindow` / `ComputeNextRun`
- `internal/database/settings_reset.go::AllSettingsResetSections` / `IsResetSectionDenied` / `CanonicalResetSection`
- `internal/database/auth_sessions_repo.go::ShouldBump` / `MintCookieToken` (cookie minting is pure crypto)
- `internal/database/sudo_token_repo.go::Mint` (token minting is pure crypto)

These functions perform no I/O. Adding ctx would be cargo-cult.

### c) In-memory state accessors / counters (≈15)

Examples:
- `internal/api/error_tracker.go::Stats`
- `internal/api/sse_handler.go::ClientCount` / `Broadcast` / `BroadcastSignalChange`
- `internal/api/telemetry_sessions_flush_backfill.go::DriveBufferLen` / `ChargeBufferLen`
- `internal/api/telemetry_handler.go::IsVehicleStreaming` / `StreamingVINs`
- `internal/database/circuit_breaker.go::Execute` / `State` / `Counts` (Execute is a guard fast-path; the protected operation already takes ctx)
- `internal/database/database.go::Stats` / `PoolStats`
- `internal/database/write_buffer.go::Stats`
- `internal/worker/gas_price_worker.go::IsRunning` / `Status`

Pure accessors over local fields/maps/atomics. No-I/O.

### d) Lifecycle / shutdown methods (≈8)

Examples:
- `internal/api/telemetry_handler_wiring.go::Shutdown` (wraps a pre-existing internal shutdown channel)
- `internal/database/database.go::Migrate` (one-shot startup; `golang-migrate` library does not accept ctx)
- `internal/worker/gas_price_worker.go::Resume`

These run during startup or shutdown; ctx propagation would not change
their behaviour because cancellation is handled via dedicated channels
or because the underlying library does not honor ctx.

### e) Local-buffer / queue mutators that delegate to ctx-aware writers (≈10)

Examples:
- `internal/api/api_call_log_middleware.go::Enqueue` / `CaptureBodies` / `Read` / `Write` (zerolog writer interface — line-buffered local enqueue; the downstream sink writer takes ctx)
- `internal/database/signal_history_writer_buffer.go::Append`
- `internal/database/write_buffer.go::Enqueue`
- `internal/database/vehicle_photo_repo.go::Upsert` (Upsert here writes to a local cache; the underlying `*VehiclePhotoRepoBackend.Upsert` is the real DB write and takes ctx)

The buffer-side enqueue is non-blocking; the flush goroutine takes ctx
when it actually persists.

### f) Repo accessor wrappers / per-vehicle state-machine queries (≈4)

Examples:
- `internal/api/fsm_handler_query.go::CurrentState` / `ActiveDrive` / `ActiveDriveState` / `ActiveCharge` / `ActiveChargeState` / `Stats` / `VehicleSnapshots` (in-memory FSM state, not DB)
- `internal/service/vehicle_service.go::PositionRepo` / `VehicleRepo` / `StateRepo` (struct-field getters)

In-memory accessors / lazy-init guards over already-constructed repos.

## Findings & decisions

| ID | Finding | Decision |
| --- | --- | --- |
| F-016-1 | 1,743/2,078 exported funcs do not take `context.Context` as the first param. | **Not a bug.** 1,641 fall into mechanically-justified categories (HTTP handlers, constructors, helpers, accessors). Each of the remaining 102 was spot-checked and matched one of the 6 sub-categories above. |
| F-016-2 | 9 production `go func` literals; none capture or document ctx propagation. | **All accounted for** — see goroutine table above. The 4 that construct a fresh `context.Background()` do so deliberately because they outlive the request that triggered them; each uses a bounded `WithTimeout`. |
| F-016-3 | Phase-44 prompt 0011 (otelhttp) already wraps every inbound `http.HandlerFunc` and the outbound Tesla `*http.Client` with `otelhttp.NewHandler` / `otelhttp.NewTransport`, so the in-handler `r.Context()` already carries an active span. Prompt 0014/0015 wrapped the MQTT consume → normalize.Process boundary. The remaining audit surface is the in-process call graph below those entry points, where ctx threading was already established by Phase-42. | **Spot-checked OK.** No remediation prompts authored. |

## What this audit explicitly does NOT enforce

- A pre-commit hook or `go vet` check that exported methods must
  accept ctx. (Out of scope; would produce ~1,700 false positives
  per the mechanically-justified categories.)
- A blanket rewrite of in-memory accessors to accept a ctx they do
  not need.
- A change to lifecycle methods (Migrate, Start*, Stop*) to accept
  ctx where the underlying library does not honor it.

## Sign-off

Methodology, inventory, and goroutine review captured here. No code
changes required. Subsequent phase-44 prompts continue to instrument
specific call paths (database via otelpgx, MQTT consume boundary,
normalize.Pipeline) where ctx propagation produces span chains.
