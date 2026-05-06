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
//   - Tests for the bridge use mock implementations of the 6
//     callback interfaces declared here (LiveSignalStore,
//     SignalHistoryWriter, FSMHandler, SessionTracker, AlertEvaluator,
//     VINResolver) so the bridge can be exercised without spinning
//     up a TelemetryHandler. Putting the interfaces here (rather
//     than in internal/api) keeps internal/api free of the bridge's
//     mock surface.
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
type LiveSignalStore interface {
	UpdateAll(ctx context.Context, vehicleID int64, signals map[string]any) error
}

// SignalHistoryWriter mirrors the buffered Append on
// internal/database.SignalHistoryWriter. Append is non-blocking on
// the legacy type (signals are queued for batched flush), so the
// interface returns no error — buffer-overflow conditions surface
// via metrics and are out of scope for the bridge.
type SignalHistoryWriter interface {
	Append(vehicleID int64, signals map[string]any)
}

// FSMHandler mirrors (*internal/api.FSMHandler).ProcessSignals. The
// legacy method is fire-and-forget (no error return) because the FSM
// processes asynchronously and surfaces failures via its own
// per-FSM metrics. Bridging at the same shape keeps the production
// adapter trivial.
type FSMHandler interface {
	ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]any)
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
type SessionTracker interface {
	ProcessSignals(ctx context.Context, vehicleID int64, vin string, signals map[string]any, accumulated map[string]any)
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
// payload — live store / history / FSM / SSE proceed because they
// do not depend on VIN.
type VINResolver interface {
	VINByID(ctx context.Context, vehicleID int64) (string, error)
}

// BroadcastSSEFunc mirrors the legacy
// (*internal/api.TelemetryHandler).broadcastSSE method. The legacy
// method handles Redis pub/sub fanout vs single-pod fallback
// internally; the bridge just delivers the wire-shaped payload.
type BroadcastSSEFunc func(payload map[string]any)

// Config bundles the SideEffectsObserver's six callback dependencies
// plus optional logger and clock. Required dependencies are checked
// at constructor time — misuse is a programming bug and panics.
type Config struct {
	Live         LiveSignalStore
	History      SignalHistoryWriter
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
	history      SignalHistoryWriter
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
	case cfg.History == nil:
		panic("teslapipeline: New: Config.History must be non-nil")
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
		history:      cfg.History,
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
// the legacy 5 cross-cutting effects in the order locked by
// phase-42a/0000 Decision #10 + the prompt's DESIGN block:
//
//  1. live.UpdateAll(...)               — L1 in-process state
//  2. history.Append(...)               — durable history write
//  3. fsm.ProcessSignals(...)           — drive/charge/sleep FSM
//                                          (may read live state from
//                                          step 1)
//  4. sessions.ProcessSignals(...)      — drive/charge sessions
//     alerts.Evaluate(...)              — alert rule fanout
//                                          (both share the same
//                                          per-payload signals map
//                                          per Decision #8)
//  5. broadcastSSE(...)                 — SSE fanout LAST so the
//                                          wire view reflects all
//                                          upstream side-effects
//
// VIN resolution is performed once via vinResolver.VINByID. If the
// lookup fails (vehicle not registered, transient pgx error) the
// bridge logs at WARN and SKIPS sessions + alerts only — the other
// four callbacks proceed because they key off vehicleID, not vin.
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
	for _, a := range atomics {
		signals[a.Field] = a.Value
	}

	// Step 1: live store FIRST so FSM may read live state.
	if err := o.live.UpdateAll(ctx, vehicleID, signals); err != nil {
		o.log.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Int("signal_count", len(signals)).
			Msg("teslapipeline: live signal store update failed")
	}

	// Step 2: durable history append (non-blocking by contract).
	o.history.Append(vehicleID, signals)

	// Step 3: FSM dispatch. The FSM may read live state populated by
	// step 1 — calling FSM before live is the regression that
	// Decision #10(e) explicitly guards against.
	o.fsm.ProcessSignals(ctx, vehicleID, signals)

	// Step 4: VIN-keyed sessions + alerts. A VIN lookup failure
	// SKIPS this pair only; live / history / FSM / SSE proceed.
	vin, err := o.vinResolver.VINByID(ctx, vehicleID)
	if err != nil {
		o.log.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Msg("teslapipeline: VIN lookup failed; skipping sessions + alerts")
	} else {
		// Both sessions and alerts receive the SAME per-payload map
		// for both the current and accumulated arguments
		// (Decision #8). The cross-batch accumulator is deferred.
		o.sessions.ProcessSignals(ctx, vehicleID, vin, signals, signals)
		o.alerts.Evaluate(ctx, vehicleID, vin, signals, signals)
	}

	// Step 5: SSE fanout LAST so the broadcast reflects all
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
	o.broadcastSSE(map[string]any{
		"vehicle_id": vehicleID,
		"ts":         o.now(),
		"signals":    signals,
	})
}

// Compile-time assertion that *SideEffectsObserver satisfies
// normalize.AtomicsObserver. The blank-identifier var triggers a
// build error if the interface ever drifts under either package.
var _ normalize.AtomicsObserver = (*SideEffectsObserver)(nil)
