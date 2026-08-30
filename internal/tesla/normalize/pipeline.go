// Package normalize is THE ONE PIPELINE between the codec boundary
// (raw Tesla Fleet Telemetry payload bytes) and the typed
// per-destination writers (router.Router). Per ADR-004 #2 every
// payload follows exactly one path:
//
//	bytes
//	  -> codec.Decode (unmarshal + flatten compounds to codec.Atomic)
//	  -> stable-sort atomics so every Setting*Unit precedes every
//	     non-Setting*Unit (intra-group order preserved)
//	  -> for each atomic in the sorted slice:
//	       observeSettingUnit  (Setting*Unit -> unit_history.Record)
//	       OR
//	       toSI                (lookup active unit at EmittedAt,
//	                            convert raw -> SI via units.ToSI)
//	       AND THEN
//	       router.Route        (dispatch to the typed writer)
//
// The package surface is intentionally tiny: one type (Pipeline),
// one constructor (New), and exactly two public ingest methods —
// Process (bytes-in, used by the MQTT path) and ProcessAtomics
// (atomics-in, used by the HTTP webhook adapter only; codec.Decode
// has already run on the JSON-decoded values upstream). Every other
// helper is unexported. The reflective TestSinglePipelineInvariant
// in normalize_test.go enforces this lock — adding a third public
// ingest entry breaks the test and the gate.
//
// Why the sort is correctness-critical, not a perf optimisation:
// Tesla can pack a SettingDistanceUnit change and a VehicleSpeed
// reading in the SAME Datum with the SAME CreatedAt. If the speed
// atomic is processed first, unit_history.At(EmittedAt) returns the
// PRIOR unit (or ErrNotFound for a fresh vehicle) and the speed gets
// mis-converted or dropped. Processing all Setting*Unit atomics
// first guarantees the unit context for the same wall-clock instant
// is in vehicle_unit_history BEFORE the unit-bearing atomic is
// converted.
package normalize

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/ev-dev-labs/teslasync/internal/tesla/router"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
)

// ErrPayloadDrop wraps codec.Decode failures (malformed bytes). Per
// ADR-004 #8 the MQTT subscriber is expected to treat this as a
// poison-pill candidate and apply the bounded-redelivery + DLQ
// policy. Per-atomic failures are NOT
// surfaced under this sentinel — they are observable only via the
// values_processed metric and the router's writer_failures metric,
// and they MUST NOT cause the MQTT subscriber to redeliver the
// payload.
var ErrPayloadDrop = errors.New("normalize: payload-level failure (codec or unrecoverable)")

// Routable is the subset of router.Router that Pipeline depends on.
// Concrete *router.Router satisfies this interface in production
// wiring; the test suite supplies a recording fake so per-atomic
// dispatch can be exercised without populating routing.yaml in
// lock-step (the empty-routing.yaml-on-purpose contract from
// An empty routing.yaml means a real *router.Router rejects every Route call
// with ErrNoRoute, which is correct production behaviour but useless
// for testing the dispatch loop itself).
//
// Keeping the dependency as an interface is also forward-compatible
// with a future destination-specific dispatcher (e.g. an in-process
// fan-out that splits hot vs cold writes) without rewriting the
// normalize wiring.
type Routable interface {
	Route(ctx context.Context, atomic codec.Atomic) error
}

// Pipeline is THE ONE entry between the codec boundary and the
// typed per-destination writers. Construct one per process via New
// and share it across MQTT subscriber goroutines: every method is
// safe for concurrent use because every dependency (the Repo, the
// Routable, the logger, the Metrics) is itself goroutine-safe.
type Pipeline struct {
	// histRepo is the unit-history persistence layer. Reads happen
	// once per unit-bearing atomic via At; writes happen once per
	// Setting*Unit atomic via Record. Both calls go through the
	// Repo's cache fast path — no per-atomic database round-trip on
	// the hot path once the cache is warm.
	histRepo unithistory.Repo

	// router is the typed-writer dispatcher. Stored as the Routable
	// interface (not *router.Router) so tests can substitute a
	// recording fake that bypasses the empty-routing.yaml constraint.
	// Production wiring passes a *router.Router constructed from the
	// embedded routing.yaml + a writers map.
	router Routable

	// log is the per-Pipeline structured logger. Per-atomic fields
	// (field, vehicle_id, emitted_at) are added with sub-events so
	// the surrounding context (component, host, etc.) survives.
	log zerolog.Logger

	// metrics is the (CounterVec, CounterVec) bundle for per-atomic
	// outcomes. Defaults to defaultMetrics (registered against
	// prometheus.DefaultRegisterer at package init via promauto) but
	// is exposed as a struct field so a future test or out-of-process
	// renderer can substitute its own registry.
	metrics *Metrics

	// observers is the registered AtomicsObserver list invoked once
	// per successful payload AFTER the route loop in processAtomics
	// has drained every atomic. Per ADR-004 #11, this is the seam for
	// cross-cutting effects (live store, history append, FSM dispatch,
	// sessions+alerts, SSE fanout) that do not belong inside a
	// per-destination router.Writer. Production wiring
	// registers exactly one observer (tesla_pipeline.SideEffectsObserver);
	// test wiring may register multiple to assert ordering or
	// isolation.
	//
	// Stored as a slice (rather than a single observer) so the test
	// suite can assert registration-order semantics without an
	// indirection layer, and so a future observer (e.g. a metrics
	// shim or an audit-log tap) can be added without rewriting the
	// production wiring.
	observers []AtomicsObserver
}

// New constructs a Pipeline. histRepo and r MUST be non-nil; a
// zero-value zerolog.Logger is acceptable (logs go to /dev/null).
// Zero or more AtomicsObserver values may be registered; they are
// invoked sequentially in registration order at the bottom of
// processAtomics — see the AtomicsObserver doc comment in
// observer.go for the full contract.
//
// Returning a non-pointer error here would be a constructor-time
// invariant violation, but Pipeline has no fallible setup, so New
// is total: misuse panics. This matches the bootstrap.New + router.New
// contracts in the same family of packages.
//
// The variadic observers tail keeps existing test fixtures and production
// call sites source-compatible without a separate NewWithObservers shim.
func New(histRepo unithistory.Repo, r Routable, log zerolog.Logger, observers ...AtomicsObserver) *Pipeline {
	if histRepo == nil {
		panic("normalize: New: histRepo must be non-nil")
	}
	if r == nil {
		panic("normalize: New: router must be non-nil")
	}
	// Defensively copy the variadic slice so a caller that mutates
	// its own backing array after construction cannot reorder our
	// observer registration. The cost is one allocation at process
	// startup; the safety property is worth it because observer
	// ordering is part of the public contract documented on
	// AtomicsObserver.
	var registered []AtomicsObserver
	if len(observers) > 0 {
		registered = make([]AtomicsObserver, len(observers))
		copy(registered, observers)
	}
	return &Pipeline{
		histRepo:  histRepo,
		router:    r,
		log:       withHotPathSampling(log),
		metrics:   defaultMetrics,
		observers: registered,
	}
}

// Process is THE ONE BYTES-IN ENTRY (the MQTT subscriber's path).
// For the HTTP webhook adapter that already has decoded
// []codec.Atomic in hand, see ProcessAtomics — it is the second and
// only other public ingest method. The reflective
// TestSinglePipelineInvariant in normalize_test.go fails the build
// if any THIRD public ingest method is added.
//
// Return contract (LOCKED by ADR-004 #8):
//
//   - nil if codec.Decode succeeded, regardless of how many per-atomic
//     writers failed. Per-atomic failures are observable via
//     ValuesProcessed{outcome="error"} and via the router's
//     tesla_router_writer_failures_total counter — they do NOT cause
//     the MQTT subscriber to redeliver the payload.
//
//   - ErrPayloadDrop (wrapped via fmt.Errorf %w) if codec.Decode failed
//     (malformed bytes). The MQTT subscriber treats this as a
//     poison-pill candidate and applies the bounded-redelivery + DLQ
//     policy.
//
//   - any other error is reserved for unrecoverable infrastructure
//     failures (e.g. context cancelled mid-batch). Caller should NOT
//     retry; the surrounding shutdown path is responsible for
//     draining in-flight work.
func (p *Pipeline) Process(ctx context.Context, payload []byte, vehicleIntID int64) error {
	ctx, batch := startProcessSpan(ctx, "normalize.process", vehicleIntID)
	defer batch.stop()

	_, endParse := startChildSpan(ctx, "normalize.parse")
	atomics, err := codec.Decode(payload)
	endParse()
	if err != nil {
		wrapped := fmt.Errorf("%w: %v", ErrPayloadDrop, err)
		batch.recordError(wrapped)
		return wrapped
	}
	dropped, errs, perr := p.processAtomicsWithCounts(ctx, atomics, vehicleIntID)
	batch.addCounts(len(atomics), dropped, errs)
	if perr != nil {
		batch.recordError(perr)
		return perr
	}
	return nil
}

// ProcessAtomics is the SECOND public ingest entry, used by the HTTP webhook
// path and the MQTT per-field path.
// It accepts pre-decoded []codec.Atomic — the JSON-decoded webhook
// values are already past the codec.Decode boundary by the time the
// HTTP handler has them in hand, so re-encoding to proto bytes just
// to round-trip back through Process would waste CPU and (worse)
// hide JSON-typing concerns under a fake codec.Decode success.
//
// The contract is the same as Process beyond the codec.Decode step:
// nil on success regardless of per-atomic writer failures (which are
// observable via ValuesProcessed and tesla_router_writer_failures_total),
// and any returned error is reserved for unrecoverable infrastructure
// failures (e.g. context cancelled mid-batch).
//
// Note: ErrPayloadDrop is NEVER returned from ProcessAtomics because
// codec.Decode is not invoked here — there is no malformed-bytes
// failure mode at this entry. HTTP-side input validation (e.g. JSON
// schema) is the caller's responsibility BEFORE constructing the
// []codec.Atomic.
//
// Per ADR-004 #2 + the reflective TestSinglePipelineInvariant, this
// is the LAST public ingest entry that may be added to *Pipeline.
// Any future "third entry" must instead route its bytes/atomics
// through one of these two methods.
func (p *Pipeline) ProcessAtomics(ctx context.Context, atomics []codec.Atomic, vehicleIntID int64) error {
	ctx, batch := startProcessSpan(ctx, "normalize.process_atomics", vehicleIntID)
	defer batch.stop()
	dropped, errs, perr := p.processAtomicsWithCounts(ctx, atomics, vehicleIntID)
	batch.addCounts(len(atomics), dropped, errs)
	if perr != nil {
		batch.recordError(perr)
	}
	return perr
}

// processAtomics is the dispatch loop, split out so the test suite
// can exercise it without round-tripping through proto bytes. It is
// unexported because the public contract is bytes-in (Process) and
// adding a public []codec.Atomic entry would let callers bypass the
// codec layer's invalid/unset/decode-error counters.
//
// The stable sort is the correctness-critical reordering: every
// Setting*Unit atomic precedes every non-Setting*Unit atomic so the
// unit context for the current EmittedAt is recorded BEFORE any
// sibling unit-bearing atomic with the same EmittedAt is converted.
// See the package doc comment for the full rationale.
//
// AtomicsObserver fan-out: AFTER the dispatch loop drains every
// atomic, every registered observer's OnPayloadProcessed is invoked
// once with the accepted atomics only. Values that fail unit conversion
// or routing are excluded so raw, non-SI data cannot reach live state,
// FSMs, or session tracking. Observers run in registration
// order; a panic in any observer is recovered + logged inside
// notifyObserver so a buggy observer cannot kill ingest. Observers
// are NOT invoked when codec.Decode fails because in that case
// processAtomics is never reached — Process returns ErrPayloadDrop
// and the MQTT subscriber's poison-pill path takes over.
func (p *Pipeline) processAtomics(ctx context.Context, atomics []codec.Atomic, vehicleIntID int64) error {
	_, _, err := p.processAtomicsWithCounts(ctx, atomics, vehicleIntID)
	return err
}

// processAtomicsWithCounts is the internal dispatch loop that returns the
// per-batch counters used by Process / ProcessAtomics to stamp the parent
// normalize.process span. Test fixtures continue to call processAtomics
// (no count return) for backwards compatibility — the counters stay an
// implementation detail of the production hot path.
func (p *Pipeline) processAtomicsWithCounts(ctx context.Context, atomics []codec.Atomic, vehicleIntID int64) (dropped, errs int, _ error) {
	sortAtomicsSettingUnitFirst(atomics)
	routeCtx, endRoute := startChildSpan(ctx, "normalize.route")
	accepted := make([]codec.Atomic, 0, len(atomics))
	// Index-based loop so processOne can mutate atomics[i].Value in
	// place after a successful toSI conversion. The mutation is
	// observable to the AtomicsObserver fan-out below — observers
	// see SI values for fields that converted successfully and the
	// codec-original Value for everything else (Setting*Unit,
	// pass-through, conversion failures).
	for i := range atomics {
		// Honor cancellation between atomics. A cancelled context is
		// the only "unrecoverable" path the contract permits — every
		// other per-atomic failure is logged + counted + skipped.
		if err := ctx.Err(); err != nil {
			endRoute()
			return dropped, errs, err
		}
		switch p.processOne(routeCtx, &atomics[i], vehicleIntID) {
		case atomicOutcomeDropped:
			dropped++
		case atomicOutcomeError:
			errs++
		default:
			accepted = append(accepted, atomics[i])
		}
	}
	endRoute()

	_, endWrite := startChildSpan(ctx, "normalize.write")
	for _, obs := range p.observers {
		p.notifyObserver(ctx, obs, vehicleIntID, accepted)
	}
	endWrite()

	return dropped, errs, nil
}

// atomicOutcome is a coarse summary of a single processOne result, used
// only to feed the parent normalize.process span's count attributes
// (signal.count / normalize.dropped / normalize.errors). The full per-field
// outcome label set still flows through p.metrics.ValuesProcessed.
type atomicOutcome int

const (
	atomicOutcomeOK atomicOutcome = iota
	atomicOutcomeDropped
	atomicOutcomeError
)

// processOne handles a single atomic: observe Setting*Unit OR
// convert + route. Errors are NOT propagated; they are logged and
// counted via p.metrics.ValuesProcessed so the dispatch loop in
// processAtomics can keep draining the rest of the payload.
//
// Pointer receiver on the atomic argument: when toSI succeeds, the
// converted SI value is written back into atomic.Value so the
// AtomicsObserver fan-out at the bottom of processAtomics observes
// SI values rather than codec-original wire-format values. The
// pointer is otherwise unused — this is purely the
// observer-handoff substitution, not a wider mutation API.
func (p *Pipeline) processOne(ctx context.Context, atomic *codec.Atomic, vehicleIntID int64) atomicOutcome {
	meta := protomodel.SignalsByName[atomic.Field]

	// Setting*Unit atomics short-circuit the toSI + router.Route
	// path. They land in vehicle_unit_history and stop there; per
	// ADR-004 #8 the SettingDistanceUnit / SettingTemperatureUnit /
	// SettingTirePressureUnit / SettingChargeUnit Fields are not
	// routed to any hot table. Value is intentionally NOT mutated
	// for Setting*Unit atomics — the proto enum form is what the
	// observer (and the Setting*Unit history entry) records.
	if meta != nil && meta.IsSettingUnit {
		if err := p.observeSettingUnit(ctx, *atomic, vehicleIntID); err != nil {
			p.metrics.ValuesProcessed.WithLabelValues(atomic.Field, outcomeError).Inc()
			p.log.Warn().
				Err(err).
				Str("field", atomic.Field).
				Int64("vehicle_id", vehicleIntID).
				Time("emitted_at", atomic.EmittedAt).
				Msg("normalize: setting-unit observer failed")
			return atomicOutcomeError
		}
		p.metrics.ValuesProcessed.WithLabelValues(atomic.Field, outcomeOK).Inc()
		return atomicOutcomeOK
	}

	converted, err := p.toSI(ctx, *atomic, vehicleIntID)
	if err != nil {
		outcome := outcomeFor(err)
		p.metrics.ValuesProcessed.WithLabelValues(atomic.Field, outcome).Inc()
		p.log.Warn().
			Err(err).
			Str("field", atomic.Field).
			Int64("vehicle_id", vehicleIntID).
			Time("emitted_at", atomic.EmittedAt).
			Msg("normalize: toSI failed; dropping atomic")
		if outcome == outcomeError {
			return atomicOutcomeError
		}
		return atomicOutcomeDropped
	}

	// Mutate the slice element in place so the AtomicsObserver
	// fan-out sees the SI value. Pass-through atomics (where toSI
	// returns the input unchanged) write back the same Value — the
	// extra assignment is harmless and keeps the call shape uniform.
	atomic.Value = converted.Value

	if err := p.router.Route(ctx, converted); err != nil {
		outcome := outcomeError
		if errors.Is(err, router.ErrNoRoute) {
			outcome = outcomeDroppedNoRoute
		}
		p.metrics.ValuesProcessed.WithLabelValues(atomic.Field, outcome).Inc()
		p.log.Warn().
			Err(err).
			Str("field", atomic.Field).
			Int64("vehicle_id", vehicleIntID).
			Time("emitted_at", atomic.EmittedAt).
			Msg("normalize: router.Route failed; atomic not persisted")
		if outcome == outcomeDroppedNoRoute {
			return atomicOutcomeDropped
		}
		return atomicOutcomeError
	}
	p.metrics.ValuesProcessed.WithLabelValues(atomic.Field, outcomeOK).Inc()
	return atomicOutcomeOK
}

// notifyObserver invokes a single AtomicsObserver in a panic-safe
// wrapper. A panic in the observer is recovered + logged at WARN so
// a buggy observer cannot fail the payload or interrupt the rest of
// the observer registration list. The contract is documented on
// AtomicsObserver.OnPayloadProcessed.
//
// We deliberately do NOT bump a Prometheus counter here: observer
// implementations own their own metrics (e.g. SideEffectsObserver
// records per-callback success/failure inside the observer body).
// A pipeline-level "observer panicked" counter would be redundant
// with the WARN log and would bloat the cardinality budget for a
// failure mode that should be a programming bug fixed in tests, not
// a steady-state production signal.
func (p *Pipeline) notifyObserver(ctx context.Context, obs AtomicsObserver, vehicleIntID int64, atomics []codec.Atomic) {
	defer func() {
		if r := recover(); r != nil {
			p.log.Warn().
				Interface("recover", r).
				Int64("vehicle_id", vehicleIntID).
				Int("atomic_count", len(atomics)).
				Msg("normalize: AtomicsObserver panicked; payload effects partially applied")
		}
	}()
	obs.OnPayloadProcessed(ctx, vehicleIntID, atomics)
}

// outcomeFor maps a toSI error to the LOCKED outcome label set
// {ok, dropped_no_unit, dropped_invalid, dropped_no_route, error}.
// Membership in the closed set is asserted nowhere because
// outcome label values are concatenated from package-private
// constants, not user input — a typo would be a compile-time error.
func outcomeFor(err error) string {
	switch {
	case errors.Is(err, ErrNoUnitContext):
		return outcomeDroppedNoUnit
	case errors.Is(err, units.ErrUnsupportedField), errors.Is(err, units.ErrUnsupportedUnit):
		return outcomeDroppedInvalid
	default:
		return outcomeError
	}
}

// sortAtomicsSettingUnitFirst stable-sorts the slice in place so
// every Setting*Unit atomic precedes every non-Setting*Unit atomic.
// Within each group the original order is preserved
// (sort.SliceStable). This is the SettingUnitFirst correctness
// invariant locked by TestSettingUnitProcessedFirstInSamePayload —
// the comment names the ordering explicitly so a future refactor
// that swaps in a different sort knows it cannot break this
// property.
func sortAtomicsSettingUnitFirst(atomics []codec.Atomic) {
	sort.SliceStable(atomics, func(i, j int) bool {
		return isSettingUnitAtomic(atomics[i]) && !isSettingUnitAtomic(atomics[j])
	})
}

// isSettingUnitAtomic reports whether the atomic's Field is one of
// the four IsSettingUnit signals (SettingDistanceUnit,
// SettingTemperatureUnit, SettingTirePressureUnit, SettingChargeUnit).
// An atomic whose Field has no SignalMeta entry returns false; the
// router will then surface that as ErrNoRoute downstream and the
// generator-drift alert fires.
func isSettingUnitAtomic(a codec.Atomic) bool {
	meta, ok := protomodel.SignalsByName[a.Field]
	if !ok {
		return false
	}
	return meta.IsSettingUnit
}

// Compile-time interface assertion: a *router.Router MUST satisfy
// Routable so production wiring (cmd/teslasync) can pass the
// concrete router into normalize.New without an explicit cast. The
// blank-identifier var triggers a build error if the surface ever
// drifts.
var _ Routable = (*router.Router)(nil)

// Compile-time guard: the time package is part of the public Process
// timestamp contract (atomic.EmittedAt). Reference it in a no-op so
// `goimports` does not strip the import on a future hand-edit that
// removes the only consumer in this file. The other files in the
// package do consume time.Time (the Repo signature), but reordering
// of the dispatch loop into pipeline.go made this file the natural
// owner of the package contract, so the import lives here.
var _ = time.Time{}
