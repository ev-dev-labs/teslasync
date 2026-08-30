// Package teslapipeline hosts the production AtomicsObserver implementation
// that bridges normalize.Pipeline payload completion to cross-cutting effects:
// live signal state, FSM dispatch, drive/charge sessions, alert evaluation, and
// SSE fanout.
//
// This bridge lives outside internal/tesla/normalize because it wires
// application-level concerns. Placing it in normalize would either create an
// import cycle with internal/api or force API-owned callback types into the pure
// normalization package.
//
// Tests use the small callback interfaces declared here so the bridge can be
// exercised without spinning up a TelemetryHandler.
package teslapipeline

import (
	"context"
	"time"

	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
)

// sideEffectsTracerName is the OpenTelemetry tracer name for the observer
// parent span and per-effect child spans. The trace-coverage audit greps for
// this exact constant so the observer stays accounted for in the
// tesla_signal_ingest_to_db flow.
const sideEffectsTracerName = "teslapipeline"

// LiveSignalStore mirrors the subset of internal/signal.LiveSignalStore that
// SideEffectsObserver needs. The adapter keeps this package decoupled from the
// broader signal package.
//
// Returning an error preserves the LiveSignalStore's ability to surface
// back-pressure (for example, a Redis publish-queue overflow) to the bridge,
// which logs at WARN. The bridge does not propagate the error to the
// AtomicsObserver caller because observer failures must not fail the payload.
//
// GetAll returns the current cross-batch snapshot of all signals
// known for the vehicle (i.e. the union of every UpdateAll call
// since the live store was hydrated). The bridge invokes GetAll
// AFTER UpdateAll on every payload to build the true `accumulated`
// argument SessionTracker + AlertEvaluator need. Returning a nil
// map (or an error) is acceptable — the bridge falls back to the
// per-payload signals map and logs at DEBUG.
//
// GetAll is load-bearing for per-field MQTT: each payload often carries one
// signal, so sessions need the cross-batch snapshot to use last-known battery,
// odometer, and location when starting a new session.
type LiveSignalStore interface {
	UpdateAll(ctx context.Context, vehicleID int64, signals map[string]TimedSignal) error
	GetAll(ctx context.Context, vehicleID int64) (map[string]any, error)
}

// TimedSignal carries a normalized value and its producer event time across
// the side-effects boundary into the layered live store.
type TimedSignal struct {
	Value     any
	EmittedAt time.Time
}

// FSMHandler mirrors (*internal/api.FSMHandler).ProcessSignals. The
// legacy method is fire-and-forget (no error return) because the FSM
// processes asynchronously and surfaces failures via its own
// per-FSM metrics. Bridging at the same shape keeps the production
// adapter trivial.
//
// ProcessSignalsAt is the event-time-aware variant. payloadTs is the largest
// EmittedAt across the batch's atomics (see OnPayloadProcessed below); fieldTs
// maps each Field name to its per-atomic EmittedAt so downstream consumers can
// stamp per-field-derived state (gear timestamp, charge-state timestamp) at the
// originating signal's event-time rather than wall-clock.
// A zero payloadTs (or nil/empty fieldTs) signals the legacy code
// path — implementations fall back to time.Now().UTC().
type FSMHandler interface {
	ProcessSignals(ctx context.Context, vehicleID int64, signals map[string]any)
	ProcessSignalsAt(ctx context.Context, vehicleID int64, signals map[string]any, payloadTs time.Time, fieldTs map[string]time.Time)
}

// SessionTracker mirrors (*internal/api.TelemetrySessionTracker).ProcessSignals.
// The trailing accumulated map is the last-known values snapshot across
// batches.
//
// ProcessSignalsAt is the event-time-aware variant. payloadTs + fieldTs are
// forwarded so drive/charge session start/end timestamps reflect the underlying
// signal event-time instead of wall-clock. Without this, replaying historical
// signals would stamp sessions with the replay runner's clock rather than the
// original event window.
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

// VINResolver returns the canonical VIN string for an internal vehicle id. The
// bridge uses this to derive the vin argument for SessionTracker and
// AlertEvaluator without coupling the codec.Atomic shape to the bridge's input
// contract. Although codec.Atomic.VehicleID carries the VIN today, depending on
// that field here would lock the codec to that contract for future upstream
// changes.
//
// The interface returns an error so production wiring can surface "vehicle not
// registered" without logging PII. The bridge logs the error at WARN and skips
// sessions+alerts for the payload; live store, FSM, and SSE proceed because they
// do not depend on VIN.
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
// implementation. Construct one per process via New and register it against the
// Pipeline.
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

// OnPayloadProcessed implements normalize.AtomicsObserver. It runs the
// cross-cutting side-effects in dependency order. The router writer owns
// signal_log writes; this observer handles live state, FSM, sessions, alerts,
// and SSE:
//
//  1. live.UpdateAll(...)               — L1 in-process state
//  2. fsm.ProcessSignals(...)           — drive/charge/sleep FSM
//     (may read live state from
//     step 1)
//  3. live.GetAll(...)                  — cross-batch accumulated
//     snapshot for sessions +
//     alerts (per-field MQTT
//     delivers one atomic per
//     payload, so the per-batch
//     signals map alone is
//     insufficient)
//  4. sessions.ProcessSignals(...)      — drive/charge sessions
//     alerts.Evaluate(...)              — alert rule fanout
//     (current=signals from
//     this payload;
//     accumulated=snapshot
//     from step 3)
//  5. broadcastSSE(...)                 — SSE fanout LAST so the
//     wire view reflects all
//     upstream side-effects
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
	ctx, parent := otel.Tracer(sideEffectsTracerName).Start(
		ctx,
		"observer.side_effects",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(
			attribute.Int64("vehicle_id", vehicleID),
			attribute.Int("atomic_count", len(atomics)),
		),
	)
	defer parent.End()

	signals := make(map[string]any, len(atomics))
	timedSignals := make(map[string]TimedSignal, len(atomics))
	// fieldTs preserves per-atomic EmittedAt across the map-reduction.
	// Reducing []codec.Atomic → map[Field]Value collapses duplicate
	// fields to last-write-wins; fieldTs tracks the EmittedAt of the
	// surviving Value for each Field so downstream consumers can stamp
	// per-field-derived state at the originating signal's event-time.
	// payloadTs is the latest EmittedAt across all atomics — the
	// "high-water mark" used as the sctx.Now for FSM/session
	// start/end decisions when no field-specific time is available.
	// max(EmittedAt) alone is insufficient for replay batches spanning multiple
	// minutes; fieldTs carries each surviving field's canonical event time.
	fieldTs := make(map[string]time.Time, len(atomics))
	var payloadTs time.Time
	for _, a := range atomics {
		if current, ok := timedSignals[a.Field]; ok && current.EmittedAt.After(a.EmittedAt) {
			continue
		}
		signals[a.Field] = a.Value
		fieldTs[a.Field] = a.EmittedAt
		timedSignals[a.Field] = TimedSignal{Value: a.Value, EmittedAt: a.EmittedAt}
		if a.EmittedAt.After(payloadTs) {
			payloadTs = a.EmittedAt
		}
	}
	parent.SetAttributes(attribute.Int("signal_count", len(signals)))

	// Step 1: live store FIRST so FSM may read live state AND so the
	// accumulated snapshot built in step 3 reflects the current
	// payload's atomics merged with all prior batches.
	{
		stepCtx, span := otel.Tracer(sideEffectsTracerName).Start(
			ctx, "signal.live_store.update_all",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(
				attribute.Int64("vehicle_id", vehicleID),
				attribute.Int("signal_count", len(signals)),
			),
		)
		if err := o.live.UpdateAll(stepCtx, vehicleID, timedSignals); err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "live.update_all")
			o.log.Warn().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Int("signal_count", len(signals)).
				Msg("teslapipeline: live signal store update failed")
		}
		span.End()
	}

	// Step 2: FSM dispatch. The FSM may read live state populated by step 1, so
	// live state must be updated first.
	{
		stepCtx, span := otel.Tracer(sideEffectsTracerName).Start(
			ctx, "fsm.dispatch_signals",
			trace.WithSpanKind(trace.SpanKindInternal),
			trace.WithAttributes(
				attribute.Int64("vehicle_id", vehicleID),
				attribute.Int("signal_count", len(signals)),
			),
		)
		o.fsm.ProcessSignalsAt(stepCtx, vehicleID, signals, payloadTs, fieldTs)
		span.End()
	}

	// Step 3: build the cross-batch accumulated snapshot. Per-field
	// MQTT delivers one atomic per payload, so the per-payload
	// signals map carries at most one field — sessions/alerts MUST
	// receive the union of all prior batches to make "use last-known
	// battery / odometer / location" decisions correctly. GetAll is
	// invoked AFTER UpdateAll so the snapshot includes the current
	// payload's atomics. On error (or nil snapshot — first message
	// ever), fall back to the per-payload map and log at DEBUG so
	// the regression is surfaced without flooding WARN.
	fallbackUsed := false
	stepCtx, getAllSpan := otel.Tracer(sideEffectsTracerName).Start(
		ctx, "signal.live_store.get_all",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attribute.Int64("vehicle_id", vehicleID)),
	)
	accumulated, err := o.live.GetAll(stepCtx, vehicleID)
	if err != nil {
		getAllSpan.RecordError(err)
		getAllSpan.SetStatus(codes.Error, "live.get_all")
		o.log.Debug().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Msg("teslapipeline: live signal store GetAll failed; falling back to per-payload signals map for accumulated")
		accumulated = signals
		fallbackUsed = true
	} else if accumulated == nil {
		accumulated = signals
		fallbackUsed = true
	}
	getAllSpan.SetAttributes(
		attribute.Int("signal_count", len(accumulated)),
		attribute.Bool("fallback_used", fallbackUsed),
	)
	getAllSpan.End()

	// Step 5: VIN-keyed sessions + alerts. A VIN lookup failure
	// SKIPS this pair only; live / history / FSM / SSE proceed.
	vinCtx, vinSpan := otel.Tracer(sideEffectsTracerName).Start(
		ctx, "observer.vin_resolve",
		trace.WithSpanKind(trace.SpanKindInternal),
		trace.WithAttributes(attribute.Int64("vehicle_id", vehicleID)),
	)
	vin, err := o.vinResolver.VINByID(vinCtx, vehicleID)
	if err != nil {
		vinSpan.RecordError(err)
		vinSpan.SetStatus(codes.Error, "vin_resolve")
		vinSpan.SetAttributes(
			attribute.String("result", "error"),
			attribute.Bool("sessions_alerts_skipped", true),
		)
		vinSpan.End()
		o.log.Warn().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Msg("teslapipeline: VIN lookup failed; skipping sessions + alerts")
	} else {
		vinSpan.SetAttributes(
			attribute.String("result", "ok"),
			attribute.Bool("sessions_alerts_skipped", false),
		)
		vinSpan.End()
		// `signals` is the per-payload current view; `accumulated`
		// is the cross-batch snapshot from the live store. They are
		// distinct maps under per-field MQTT (a payload typically
		// has 1 entry; accumulated has hundreds). Downstream
		// consumers MUST NOT mutate either map — both are shared
		// with FSM / SSE / live store.
		{
			sessCtx, sessSpan := otel.Tracer(sideEffectsTracerName).Start(
				ctx, "sessions.process_signals_at",
				trace.WithSpanKind(trace.SpanKindInternal),
				trace.WithAttributes(
					attribute.Int64("vehicle_id", vehicleID),
					attribute.Int("signal_count", len(signals)),
				),
			)
			o.sessions.ProcessSignalsAt(sessCtx, vehicleID, vin, signals, accumulated, payloadTs, fieldTs)
			sessSpan.End()
		}
		{
			alertCtx, alertSpan := otel.Tracer(sideEffectsTracerName).Start(
				ctx, "alerts.evaluate",
				trace.WithSpanKind(trace.SpanKindInternal),
				trace.WithAttributes(
					attribute.Int64("vehicle_id", vehicleID),
					attribute.Int("signal_count", len(signals)),
				),
			)
			o.alerts.Evaluate(alertCtx, vehicleID, vin, signals, accumulated)
			alertSpan.End()
		}
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
	// driven by the legacy ProcessSignals path until that path is retired.
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
