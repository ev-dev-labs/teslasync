package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// StateFreshness classifies the newest REAL live observation backing a
// current-state read. It describes the vehicle's live stream, never the age of
// the HTTP request that produced the answer.
//
//	fresh   — a non-synthetic, timestamped live signal landed inside the
//	          cross-pod freshness window (signal.IsLiveSignalFresh).
//	stale   — the newest real observation is outside that window.
//	unknown — no real observation exists at all (durable fallback only, legacy
//	          zero-timestamp envelopes, or a cold live store). NEVER conflate
//	          this with "offline": it is an absence of evidence, not evidence
//	          of absence.
type StateFreshness string

const (
	FreshnessFresh   StateFreshness = "fresh"
	FreshnessStale   StateFreshness = "stale"
	FreshnessUnknown StateFreshness = "unknown"
)

// Data-source provenance strings shared by the single-vehicle and the fleet
// batch current-state surfaces so both wire contracts stay identical.
const (
	DataSourceLiveSignalStore = "live_signal_store"
	DataSourceDBFallback      = "db_fallback"
	DataSourceAsOf            = "as_of"
)

// ErrNilVehicle is returned by ResolveCurrentState when no vehicle is
// supplied. Callers surface it as a per-item failure, never as "the vehicle
// has no state".
var ErrNilVehicle = errors.New("resolve current state: nil vehicle")

// fsmStateSource is the persisted FSM "current state + since" lookup used to
// enrich an assembled state and to detect telemetry-vs-FSM disagreement.
// Production is *vehicleStateProvider (fsm_transitions-backed).
type fsmStateSource interface {
	GetCurrentStateSince(ctx context.Context, vehicleID int64) (string, *time.Time, error)
}

// fsmStateSource returns the active lookup. The concrete provider's methods
// are nil-safe, so a zero-value VehicleService still resolves cleanly.
func (s *VehicleService) fsmStateLookup() fsmStateSource {
	if s.fsmState != nil {
		return s.fsmState
	}
	return s.stateProvider
}

// StateConflict records a disagreement between the operational state DERIVED
// FROM VERIFIED TELEMETRY and the persisted FSM/inventory state.
//
// Only verified, currently-fresh telemetry can raise a conflict: a stale or
// unverified reading disagreeing with the FSM is expected (the FSM is the
// durable record precisely because telemetry is a sparse change feed) and
// counting it would make the signal meaningless.
type StateConflict struct {
	// TelemetryState is the operational state the live stream proves right
	// now: enums.StateCharging or enums.StateDriving.
	TelemetryState string
	// FSMState is the persisted vehicle FSM state for the same vehicle.
	FSMState string
	// Reason names the evidence that established TelemetryState — "charging"
	// (verified DetailedChargeState/ChargeAmps) or "motion" (verified
	// VehicleSpeed > 0).
	Reason string
}

// CurrentState is the provenance-carrying result of ONE current-state read.
//
// It is the single shared shape behind GET /api/v1/vehicles/{id}/state and
// GET /api/v1/vehicles/states, so the two endpoints cannot drift apart in
// either the values they report or the trust metadata that qualifies them.
type CurrentState struct {
	State      *vehiclemodel.VehicleState
	Live       bool
	DataSource string
	// ObservedAt is the instant of the newest REAL (non-synthetic,
	// timestamped) live signal, or nil when no such signal exists.
	ObservedAt *time.Time
	Freshness  StateFreshness
	// VerifiedFields lists the state JSON fields whose winning value came
	// from a real live signal. Durable signal_log fallbacks and synthetic
	// warmup restamps stay visible in State but are deliberately absent here.
	VerifiedFields []string
	// LiveReadErr records a DEGRADED live-store read. The read still returns
	// a state (assembled from the durable fallback), but the caller can see
	// that the live layer was unavailable rather than merely empty.
	LiveReadErr error
	// Conflict is non-nil when verified telemetry disagrees with the FSM.
	Conflict *StateConflict
}

// ResolveCurrentState assembles the current state for one vehicle from the
// live signal boundary (L1+L2 per ADR-007) with the durable signal_log
// fallback, enriches it with the persisted FSM state, and returns the full
// provenance envelope.
//
// It reads NOTHING from the dropped snapshot tables (ADR-001): the live store
// is the primary and BuildStateFromSignalStoreWithProvenance's signal_log
// last-known-value fallback fills the holes.
//
// `now` is supplied by the caller so a fleet-wide batch can classify every
// vehicle against ONE request-level instant; a zero value falls back to
// time.Now().UTC().
//
// A nil `live` store selects the DB-only path used when no telemetry source is
// configured, exactly matching the legacy handler's secondary branch.
//
// The returned error is reserved for conditions under which NO state could be
// produced (nil receiver/vehicle, cancelled context). A failed live read is
// NOT an error — it degrades to the durable fallback and is reported through
// CurrentState.LiveReadErr, preserving the existing single-vehicle behaviour.
func (s *VehicleService) ResolveCurrentState(
	ctx context.Context,
	vehicle *vehiclemodel.Vehicle,
	live signal.LiveSignalStore,
	now time.Time,
) (CurrentState, error) {
	return s.ResolveCurrentStateWith(ctx, vehicle, live, now, nil)
}

// ResolveCurrentStateWith is ResolveCurrentState reading its storage inputs
// from a batch-level CurrentStatePrefetch instead of issuing its own
// per-vehicle round trips.
//
// A nil prefetch is exactly ResolveCurrentState: every layer reads for itself.
// A non-nil prefetch supplies whichever layers were successfully read in bulk;
// layers the prefetch does not cover are still read per vehicle here, so a
// deployment whose store lacks a bulk capability keeps working unchanged.
//
// The VERDICTS are identical either way — same merge rule, same freshness
// window, same provenance, same telemetry-vs-FSM conflict detection — because
// the prefetch only changes where the inputs came from, never how they are
// interpreted.
func (s *VehicleService) ResolveCurrentStateWith(
	ctx context.Context,
	vehicle *vehiclemodel.Vehicle,
	live signal.LiveSignalStore,
	now time.Time,
	pre *CurrentStatePrefetch,
) (CurrentState, error) {
	if s == nil {
		return CurrentState{}, errors.New("resolve current state: nil vehicle service")
	}
	if vehicle == nil {
		return CurrentState{}, ErrNilVehicle
	}
	if err := ctx.Err(); err != nil {
		return CurrentState{}, fmt.Errorf("resolve current state (vehicle %d): %w", vehicle.ID, err)
	}
	if now.IsZero() {
		now = time.Now().UTC()
	} else {
		now = now.UTC()
	}

	if live == nil {
		// No telemetry source configured: durable records only. There is no
		// live stream, so freshness is unknown and nothing is verified.
		state, _, err := s.buildStateFromSignalStoreWithProvenance(ctx, nil, vehicle, pre)
		if err != nil {
			return CurrentState{}, fmt.Errorf("resolve durable state (vehicle %d): %w", vehicle.ID, err)
		}
		if _, since, err := s.currentFSMState(ctx, vehicle.ID, pre); err == nil && since != nil {
			state.Since = since
		}
		if ctxErr := ctx.Err(); ctxErr != nil {
			return CurrentState{}, fmt.Errorf("resolve FSM state (vehicle %d): %w", vehicle.ID, ctxErr)
		}
		return CurrentState{
			State:          state,
			Live:           false,
			DataSource:     DataSourceDBFallback,
			Freshness:      FreshnessUnknown,
			VerifiedFields: []string{},
		}, nil
	}

	store := signal.New()
	var (
		hasLiveSignals bool
		observedAt     *time.Time
		liveReadErr    error
	)
	freshness := FreshnessUnknown

	values, err := s.liveSignalValues(ctx, vehicle.ID, live, pre)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return CurrentState{}, fmt.Errorf("read live signals (vehicle %d): %w", vehicle.ID, ctxErr)
		}
		// Degradation, not failure: the durable fallback below still answers.
		liveReadErr = fmt.Errorf("live signal read (vehicle %d): %w", vehicle.ID, err)
		log.Warn().Err(err).Int64("vehicle_id", vehicle.ID).
			Msg("vehicle current state: live signal read failed")
	} else if len(values) > 0 {
		store.HydrateValues(vehicle.ID, values)
		hasLiveSignals = true
		observedAt = LatestLiveSignalObservation(values)
		if observedAt != nil {
			freshness = FreshnessStale
			if signal.IsLiveSignalFresh(&signal.Value{Timestamp: *observedAt}, now) {
				freshness = FreshnessFresh
			}
		}
	}

	state, verified, err := s.buildStateFromSignalStoreWithProvenance(ctx, store, vehicle, pre)
	if err != nil {
		return CurrentState{}, fmt.Errorf("assemble current state (vehicle %d): %w", vehicle.ID, err)
	}

	// Derive the telemetry-backed operational state BEFORE the FSM overwrite
	// so the two can be compared rather than silently merged.
	telemetryState, conflictReason := telemetryDerivedState(state, verified, freshness)

	fsmState := ""
	if currentState, since, err := s.currentFSMState(ctx, vehicle.ID, pre); err == nil && currentState != "" {
		fsmState = currentState
		state.State = currentState
		state.Since = since
		if freshness == FreshnessFresh {
			verified["state"] = true
		}
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		return CurrentState{}, fmt.Errorf("resolve FSM state (vehicle %d): %w", vehicle.ID, ctxErr)
	}

	dataSource := DataSourceLiveSignalStore
	if !hasLiveSignals {
		dataSource = DataSourceDBFallback
	}

	result := CurrentState{
		State:          state,
		Live:           hasLiveSignals,
		DataSource:     dataSource,
		ObservedAt:     observedAt,
		Freshness:      freshness,
		VerifiedFields: SortedVerifiedFields(verified),
		LiveReadErr:    liveReadErr,
	}
	if telemetryState != "" && fsmState != "" && telemetryState != fsmState {
		result.Conflict = &StateConflict{
			TelemetryState: telemetryState,
			FSMState:       fsmState,
			Reason:         conflictReason,
		}
	}
	ObserveStateConflict(ctx, vehicle.ID, result.Conflict)
	return result, nil
}

// telemetryDerivedState returns the operational state that CURRENTLY-VERIFIED
// telemetry proves, plus the evidence that established it. It returns the empty
// string when telemetry makes no positive claim — the only honest answer for a
// stale stream, an unverified field, or a parked car whose last change event
// predates the freshness window.
//
// Precedence matches the frontend contract: charging wins, then motion.
func telemetryDerivedState(
	state *vehiclemodel.VehicleState,
	verified map[string]bool,
	freshness StateFreshness,
) (string, string) {
	if state == nil || freshness != FreshnessFresh {
		return "", ""
	}
	if verified["is_charging"] && state.IsCharging {
		return enums.StateCharging, "charging"
	}
	if verified["speed"] && state.Speed > 0 {
		return enums.StateDriving, "motion"
	}
	return "", ""
}

// ObserveStateConflict records (or clears) one vehicle's telemetry-vs-FSM
// disagreement.
//
// Observability contract (ADR-008):
//   - Prometheus: an IDEMPOTENT gauge keyed only by the two bounded state
//     vocabularies. Re-observing the same disagreement — which every HTTP read
//     of the same vehicle does — does not move any counter, so read volume
//     cannot inflate the signal. vehicle_id is deliberately NOT a label.
//   - Traces: a span event carrying vehicle_id. Span attribute cardinality is
//     bounded by sampling, not by a Prometheus label cartesian product.
//   - Logs: one zerolog line per TRANSITION (entering or leaving a conflict),
//     never per read, carrying the trace_id for correlation.
func ObserveStateConflict(ctx context.Context, vehicleID int64, conflict *StateConflict) {
	span := trace.SpanFromContext(ctx)
	if conflict == nil {
		if metrics.ClearVehicleStateConflict(vehicleID) {
			log.Info().
				Int64("vehicle_id", vehicleID).
				Str("trace_id", span.SpanContext().TraceID().String()).
				Msg("vehicle operational state reconverged with persisted FSM state")
		}
		return
	}

	changed := metrics.RecordVehicleStateConflict(vehicleID, conflict.TelemetryState, conflict.FSMState)
	if span.IsRecording() {
		span.AddEvent("vehicle.state_conflict", trace.WithAttributes(
			attribute.Int64("vehicle.id", vehicleID),
			attribute.String("vehicle.telemetry_state", conflict.TelemetryState),
			attribute.String("vehicle.fsm_state", conflict.FSMState),
			attribute.String("vehicle.conflict_reason", conflict.Reason),
			attribute.Bool("vehicle.conflict_new", changed),
		))
	}
	if !changed {
		// Same disagreement as the last observation: the gauge already says
		// so. Logging again would turn a poll loop into a log flood.
		return
	}
	log.Warn().
		Int64("vehicle_id", vehicleID).
		Str("telemetry_state", conflict.TelemetryState).
		Str("fsm_state", conflict.FSMState).
		Str("conflict_reason", conflict.Reason).
		Str("trace_id", span.SpanContext().TraceID().String()).
		Msg("vehicle operational state disagrees with persisted FSM state")
}

// LatestLiveSignalObservation returns the newest timestamp among REAL live
// signals — non-nil raw value, non-zero timestamp, not a synthetic warmup
// restamp. Returns nil when the vehicle has no such signal, which callers
// must render as unknown freshness rather than as a stale observation.
func LatestLiveSignalObservation(values map[string]*signal.Value) *time.Time {
	var latest time.Time
	for _, value := range values {
		if !IsObservedLiveSignal(value) {
			continue
		}
		timestamp := value.Timestamp.UTC()
		if latest.IsZero() || timestamp.After(latest) {
			latest = timestamp
		}
	}
	if latest.IsZero() {
		return nil
	}
	return &latest
}

// IsObservedLiveSignal reports whether a live value came from a real
// observation rather than a hydration/legacy restamp.
func IsObservedLiveSignal(value *signal.Value) bool {
	return value != nil &&
		value.Raw != nil &&
		!value.Timestamp.IsZero() &&
		!value.TimestampSynthetic
}

// SortedVerifiedFields flattens the provenance map into a deterministic slice
// for JSON. Never returns nil so the wire contract always carries an array.
func SortedVerifiedFields(verified map[string]bool) []string {
	fields := make([]string, 0, len(verified))
	for field, ok := range verified {
		if ok {
			fields = append(fields, field)
		}
	}
	sort.Strings(fields)
	return fields
}
