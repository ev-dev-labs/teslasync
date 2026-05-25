// Package teslapipeline hosts the production AtomicsObserver
// implementation that bridges normalize.Pipeline payload completion
// to the legacy 5 cross-cutting effects (live signal store, durable
// signal history, FSM dispatch, drive/charge sessions + alert
// evaluation, SSE fanout).
//
// Why this lives in its own package (not under
// internal/tesla/normalize):
//
//   - The bridge depends on legacy internal/api types (FSMHandler,
//     TelemetrySessionTracker, TelemetryAlertEvaluator,
//     TelemetryHandler.broadcastSSE) and on internal/signal.LiveSignalStore.
//     If we placed SideEffectsObserver inside internal/tesla/normalize
//     it would either pull those packages into a leaf utility (creating
//     an import cycle with internal/api which already imports normalize
//     for the unit-conversion path) or force the legacy types to move.
//     Neither is acceptable for a phase-42a addition that must be
//     reversible.
//
//   - The bridge is the "wiring layer" — it owns the policy
//     decisions about call ordering, error suppression, and VIN
//     resolution. Those are application-level concerns that don't
//     belong in the (pure, single-responsibility) normalize package.
//
//   - Tests for the bridge use mock implementations of the 5
//     callback interfaces declared here (LiveSignalStore,
//     FSMHandler, SessionTracker, AlertEvaluator, VINResolver) so
//     the bridge can be exercised without spinning up a
//     TelemetryHandler. Putting the interfaces here (rather than in
//     internal/api) keeps internal/api free of the bridge's mock
//     surface.
//
// Production wiring of *SideEffectsObserver into normalize.New is
// deferred to phase-42a/0050 (the MQTT subscriber cutover prompt).
// Until then this package is import-cycle-free and can be
// constructed in tests but is NOT registered against any live
// pipeline. The phase-42 final-gate v2 verification covers the
// pipeline + writers; the bridge is verified end-to-end in
// phase-42a/9999.
package teslapipeline

import (
	"context"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
)

// LiveSignalStore mirrors the subset of internal/signal.LiveSignalStore
// the SideEffectsObserver needs. The legacy method on the concrete
// type is UpdateNonBlocking; production wiring at phase-42a/0050
// adapts that method to this UpdateAll signature so the bridge does
// not depend on the broader signal package.
//
// Returning an error rather than swallowing inside the interface
// preserves the LiveSignalStore's ability to surface back-pressure
// (e.g. a Redis publish-queue overflow) to the bridge, which logs
// at WARN. The bridge does NOT propagate the error to the
// AtomicsObserver caller — observer failures must not fail the
// payload (phase-42a/0000 Decision #2).
//
// GetAll returns the current cross-batch snapshot of all signals
// known for the vehicle (i.e. the union of every UpdateAll call
// since the live store was hydrated). The bridge invokes GetAll
// AFTER UpdateAll on every payload to build the true `accumulated`
// argument SessionTracker + AlertEvaluator need. Returning a nil
// map (or an error) is acceptable — the bridge falls back to the
// per-payload signals map and logs at DEBUG.
//
// Per the per-field MQTT cutover this is the load-bearing fix:
// before, the bridge passed the per-payload `signals` map as both
// `current` and `accumulated`. With per-field MQTT each payload
// carries one signal, so accumulated would only have one key,
// breaking sessions' "use last-known battery / odometer / location
// when starting a new session" feature. GetAll restores the
// cross-batch accumulator to its legacy semantics.
type LiveSignalStore interface {
	UpdateAll(ctx context.Context, vehicleID int64, signals map[string]any) error
	GetAll(ctx context.Context, vehicleID int64) (map[string]any, error)
}

// FSMHandler mirrors (*internal/api.FSMHandler).ProcessSignals. The
// legacy method is fire-and-forget (no error return) because the FSM
// processes asynchronously and surfaces failures via its own
// per-FSM metrics. Bridging at the same shape keeps the production
// adapter trivial.
//
// ProcessSignalsAt is the event-time-aware variant added by Phase-42a
// prompt 0030.bis (commit C2 of v3.4 prod-replay accuracy fix).
// payloadTs is the largest EmittedAt across the batch's atomics
// (see OnPayloadProcessed below); fieldTs maps each Field name to
// its per-atomic EmittedAt so downstream consumers can stamp
// per-field-derived state (gear timestamp, charge-state timestamp)
// at the originating signal's event-time rather than wall-clock.
// A zero payloadTs (or nil/empty fieldTs) signals the legacy code
// path — implementations fall back to time.Now().UTC().
type FSMHandler interface {
	ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]any)
	ProcessSignalsAt(ctx context.Context, vehicleID int64, signals map[string]any, payloadTs time.Time, fieldTs map[string]time.Time)
}

// SessionTracker mirrors
// (*internal/api.TelemetrySessionTracker).ProcessSignals. The
// trailing accumulated map is the legacy "last-known values across
// batches" parameter. Per phase-42a/0000 Decision #8 the bridge
// passes the SAME per-payload signals map for both the current and
// accumulated arguments — the cross-batch accumulator is a future
// follow-up. The session tracker's "use last-known battery /
// odometer / location when starting a new session" feature is
// therefore narrowed to "use the values present in the current
// batch", which is acceptable while the new pipeline runs in
// shadow alongside the legacy path.
//
// ProcessSignalsAt is the event-time-aware variant. payloadTs +
// fieldTs are forwarded so drive/charge session start/end timestamps
// reflect the underlying signal event-time instead of wall-clock —
// without this, replaying a 24-minute batch of historical signals
// produces a single "drive" stamped with the replay-runner's clock
// rather than the original event window.
type SessionTracker interface {
	ProcessSignals(ctx context.Context, vehicleID int64, vin string, signals map[string]any, accumulated map[string]any)
	ProcessSignalsAt(ctx context.Context, vehicleID int64, vin string, signals map[string]any, accumulated map[string]any, payloadTs time.Time, fieldTs map[string]time.Time)
}

// AlertEvaluator mirrors
// (*internal/api.TelemetryAlertEvaluator).Evaluate. Same accumulator
// caveat as SessionTracker.
type AlertEvaluator interface {
	Evaluate(ctx context.Context, vehicleID int64, vin string, signals map[string]any, accumulated map[string]any)
}

// VINResolver returns the canonical VIN string for a vehicle's
// internal database id. The bridge uses this to derive the vin
// argument for SessionTracker and AlertEvaluator without coupling
// the codec.Atomic shape to the bridge's input contract — although
// codec.Atomic.VehicleID does in fact carry the VIN today (codec
// populates it from Payload.Vin), making the bridge depend on that
// field would lock the codec to that contract for all future
// upstream changes. A VIN lookup against the canonical Postgres
// vehicles table is the architecturally clean choice phase-42a/0000
// Decision #8 locked.
//
// The interface returns an error so production wiring can surface
// "vehicle not registered" (the analogue of the writer-layer
// "vehicle not found" PII-clean error in router/writers/*). The
// bridge logs the error at WARN and SKIPS sessions+alerts for the
// payload — live store / FSM / SSE proceed because they do not
// depend on VIN.
type VINResolver interface {
	VINByID(ctx context.Context, vehicleID int64) (string, error)
}

// BroadcastSSEFunc mirrors the legacy
// (*internal/api.TelemetryHandler).broadcastSSE method. The legacy
// method handles Redis pub/sub fanout vs single-pod fallback
// internally; the bridge just delivers the wire-shaped payload.
//
// Takes a context so the SSE fan-out span nests under the same trace
// as the upstream MQTT consume → normalize → ProcessAtomics path.
// Implementations MUST honour ctx for cancellation when their fan-out
// involves blocking I/O (e.g. Redis publish).
type BroadcastSSEFunc func(ctx context.Context, payload map[string]any)

// Config bundles the SideEffectsObserver's callback dependencies
// plus optional logger and clock. Required dependencies are checked
// at constructor time — misuse is a programming bug and panics.
//
// Note: signal_log durable history writes are NOT a SideEffects
// concern — they are owned by the router signal_log_writer.go which
// runs synchronously in the routing path. The legacy
// `History SignalHistoryWriter` field was deleted as part of the
// per-field MQTT cutover.
type Config struct {
	Live         LiveSignalStore
	FSM          FSMHandler
	Sessions     SessionTracker
	Alerts       AlertEvaluator
	VINResolver  VINResolver
	BroadcastSSE BroadcastSSEFunc

	// Logger is the structured logger used to surface non-fatal
	// failures from each callback. A zero-value zerolog.Logger is
	// acceptable (logs go to /dev/null).
	Logger zerolog.Logger

	// Now is the wall-clock used to stamp the SSE payload's "ts"
	// field. Optional; defaults to time.Now().UTC. Tests inject a
	// frozen clock so the SSE assertion can compare timestamps
	// directly.
	Now func() time.Time
}

// SideEffectsObserver is the production normalize.AtomicsObserver
// implementation. Construct one per process via New and register it
// against the Pipeline at phase-42a/0050 cutover.
type SideEffectsObserver struct {
	live         LiveSignalStore
	fsm          FSMHandler
	sessions     SessionTracker
	alerts       AlertEvaluator
	vinResolver  VINResolver
	broadcastSSE BroadcastSSEFunc

	log zerolog.Logger
	now func() time.Time
}

// New constructs a SideEffectsObserver from a Config. Every callback
// dependency MUST be non-nil — a missing dependency is a wiring bug
// and panics rather than silently no-oping a critical effect (a
// silent no-op on, say, FSM dispatch would leave drives orphaned
// without any obvious symptom).
func New(cfg Config) *SideEffectsObserver {
	switch {
	case cfg.Live == nil:
		panic("teslapipeline: New: Config.Live must be non-nil")
	case cfg.FSM == nil:
		panic("teslapipeline: New: Config.FSM must be non-nil")
	case cfg.Sessions == nil:
		panic("teslapipeline: New: Config.Sessions must be non-nil")
	case cfg.Alerts == nil:
		panic("teslapipeline: New: Config.Alerts must be non-nil")
	case cfg.VINResolver == nil:
		panic("teslapipeline: New: Config.VINResolver must be non-nil")
	case cfg.BroadcastSSE == nil:
		panic("teslapipeline: New: Config.BroadcastSSE must be non-nil")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &SideEffectsObserver{
		live:         cfg.Live,
		fsm:          cfg.FSM,
		sessions:     cfg.Sessions,
		alerts:       cfg.Alerts,
		vinResolver:  cfg.VINResolver,
		broadcastSSE: cfg.BroadcastSSE,
		log:          cfg.Logger,
		now:          now,
	}
}

// OnPayloadProcessed implements normalize.AtomicsObserver. It runs
// the cross-cutting side-effects in the order locked by
// phase-42a/0000 Decision #10 + the prompt's DESIGN block, as
// amended by the per-field MQTT cutover (signal_log writes are
// owned by the router writer, NOT this observer):
//
//  1. live.UpdateAll(...)               — L1 in-process state
//  2. fsm.ProcessSignals(...)           — drive/charge/sleep FSM
//                                          (may read live state from
//                                          step 1)
//  3. live.GetAll(...)                  — cross-batch accumulated
//                                          snapshot for sessions +
//                                          alerts (per-field MQTT
//                                          delivers one atomic per
//                                          payload, so the per-batch
//                                          signals map alone is
//                                          insufficient)
//  4. sessions.ProcessSignals(...)      — drive/charge sessions
//     alerts.Evaluate(...)              — alert rule fanout
//                                          (current=signals from
//                                          this payload;
//                                          accumulated=snapshot
//                                          from step 3)
//  5. broadcastSSE(...)                 — SSE fanout LAST so the
//                                          wire view reflects all
//                                          upstream side-effects
//
// VIN resolution is performed once via vinResolver.VINByID. If the
// lookup fails (vehicle not registered, transient pgx error) the
// bridge logs at WARN and SKIPS sessions + alerts only — the other
// callbacks proceed because they key off vehicleID, not vin.
//
// The atomics slice is the post-route slice from the Pipeline:
// per-atomic Value fields hold the SI value for unit-bearing fields
// that converted successfully and the codec-original Value for
// pass-through, Setting*Unit, and conversion-failed atomics. The
// observer treats every Field+Value pair uniformly — downstream
// consumers (the legacy callbacks) already handle the mixed-type
// signals map.
//
// Per the AtomicsObserver contract this method MUST NOT mutate the
// atomics slice; we read it for the conversion to a map and never
// write back.
func (o *SideEffectsObserver) OnPayloadProcessed(ctx context.Context, vehicleID int64, atomics []codec.Atomic) {
	signals := make(map[string]any, len(atomics))
	// fieldTs preserves per-atomic EmittedAt across the map-reduction.
	// Reducing []codec.Atomic → map[Field]Value collapses duplicate
	// fields to last-write-wins; fieldTs tracks the EmittedAt of the
	// surviving Value for each Field so downstream consumers can stamp
	// per-field-derived state at the originating signal's event-time.
	// payloadTs is the latest EmittedAt across all atomics — the
	// "high-water mark" used as the sctx.Now for FSM/session
	// start/end decisions when no field-specific time is available.
	// Per Phase-42a/0030.bis (commit C2 of v3.4 prod-replay accuracy
	// fix) max(EmittedAt) alone is INSUFFICIENT for replay batches
	// spanning multiple minutes — fieldTs is the canonical thread.
	fieldTs := make(map[string]time.Time, len(atomics))
	var payloadTs time.Time
	for _, a := range atomics {
		signals[a.Field] = a.Value
		fieldTs[a.Field] = a.EmittedAt
		if a.EmittedAt.After(payloadTs) {
			payloadTs = a.EmittedAt
		}
	}

	// Step 1: live store FIRST so FSM may read live state AND so the
	// accumulated snapshot built in step 3 reflects the current
	// payload's atomics merged with all prior batches.
	if err := o.live.UpdateAll(ctx, vehicleID, signals); err != nil {
		o.log.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Int("signal_count", len(signals)).
			Msg("teslapipeline: live signal store update failed")
	}

	// Step 2: FSM dispatch. The FSM may read live state populated by
	// step 1 — calling FSM before live is the regression that
	// Decision #10(e) explicitly guards against.
	o.fsm.ProcessSignalsAt(ctx, vehicleID, signals, payloadTs, fieldTs)

	// Step 3: build the cross-batch accumulated snapshot. Per-field
	// MQTT delivers one atomic per payload, so the per-payload
	// signals map carries at most one field — sessions/alerts MUST
	// receive the union of all prior batches to make "use last-known
	// battery / odometer / location" decisions correctly. GetAll is
	// invoked AFTER UpdateAll so the snapshot includes the current
	// payload's atomics. On error (or nil snapshot — first message
	// ever), fall back to the per-payload map and log at DEBUG so
	// the regression is surfaced without flooding WARN.
	accumulated, err := o.live.GetAll(ctx, vehicleID)
	if err != nil {
		o.log.Debug().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Msg("teslapipeline: live signal store GetAll failed; falling back to per-payload signals map for accumulated")
		accumulated = signals
	} else if accumulated == nil {
		accumulated = signals
	}

	// Step 5: VIN-keyed sessions + alerts. A VIN lookup failure
	// SKIPS this pair only; live / history / FSM / SSE proceed.
	vin, err := o.vinResolver.VINByID(ctx, vehicleID)
	if err != nil {
		o.log.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Msg("teslapipeline: VIN lookup failed; skipping sessions + alerts")
	} else {
		// `signals` is the per-payload current view; `accumulated`
		// is the cross-batch snapshot from the live store. They are
		// distinct maps under per-field MQTT (a payload typically
		// has 1 entry; accumulated has hundreds). Downstream
		// consumers MUST NOT mutate either map — both are shared
		// with FSM / SSE / live store under Decision #10(d).
		o.sessions.ProcessSignalsAt(ctx, vehicleID, vin, signals, accumulated, payloadTs, fieldTs)
		o.alerts.Evaluate(ctx, vehicleID, vin, signals, accumulated)
	}

	// Step 6: SSE fanout LAST so the broadcast reflects all
	// upstream side-effects. Wire shape: {vehicle_id, ts, signals}.
	// The shape intentionally differs from the legacy
	// {vehicle_id, ts, tables} payload because that legacy shape
	// embeds typed-table column maps the SideEffectsObserver does
	// not have; the legacy hot-row builder is owned by the
	// router.Writer layer which handles per-table persistence
	// independently. Frontend consumers that subscribe to this
	// observer's payload will see the canonical signals view; the
	// existing sseManager.ts consumer of the legacy payload remains
	// driven by the legacy ProcessSignals path until phase-42a/0090
	// retires it.
	o.broadcastSSE(ctx, map[string]any{
		"vehicle_id": vehicleID,
		"ts":         o.now(),
		"signals":    signals,
	})
}

// Compile-time assertion that *SideEffectsObserver satisfies
// normalize.AtomicsObserver. The blank-identifier var triggers a
// build error if the interface ever drifts under either package.
var _ normalize.AtomicsObserver = (*SideEffectsObserver)(nil)
