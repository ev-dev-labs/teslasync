package service

// Bulk current-state prefetch.
//
// The fleet batch read (GET /api/v1/vehicles/states) used to resolve each
// vehicle independently, and each resolution issued its own storage reads:
// one Redis HGETALL (L2), one signal_log DISTINCT ON scan (L3) and one
// fsm_transitions lookup. A 100-vehicle page therefore cost ~300 round trips
// inside one HTTP request.
//
// CurrentStatePrefetch performs each of those reads ONCE for the whole page
// using the bulk primitive of the layer that owns it:
//
//	L2 signal.BulkLiveSignalStore.GetAllBulk  → one pipelined Redis round trip
//	L3 signal.BulkStateReader.StatesAt        → one set-based signal_log query
//	   bulkFSMStateSource.GetCurrentStatesSince → one set-based fsm_transitions query
//
// The LAYERING is unchanged: signal.Store remains L1, Redis HSET remains L2,
// signal_log remains the durable state, and no snapshot/mirror table is read
// or introduced. Every per-vehicle verdict is still computed per vehicle from
// the same inputs, against the same request-level `now`, with the same
// provenance — the only thing that changed is how many round trips were spent
// fetching those inputs.
//
// Every layer degrades INDEPENDENTLY and EXPLICITLY: a failed bulk read is
// recorded (and logged once, with the trace id) so the affected vehicles fall
// back exactly as a single-vehicle read would, instead of the whole batch
// failing or — worse — quietly reporting an empty fleet.

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// fsmStateRecord is one vehicle's persisted FSM state plus the instant it was
// entered — the bulk counterpart of fsmStateSource.GetCurrentStateSince.
type fsmStateRecord struct {
	State string
	Since *time.Time
}

// bulkFSMStateSource is the OPTIONAL set-based capability of an
// fsmStateSource. Production is *vehicleStateProvider; the interface keeps the
// prefetch testable with a fake and lets any source without the capability
// fall back to the per-vehicle lookup.
type bulkFSMStateSource interface {
	GetCurrentStatesSince(ctx context.Context, vehicleIDs []int64) (map[int64]fsmStateRecord, error)
}

var _ bulkFSMStateSource = (*vehicleStateProvider)(nil)

// CurrentStatePrefetch carries ONE batch's bulk-read inputs.
//
// It is a request-scoped value: build it, pass it to
// ResolveCurrentStateWith for every vehicle in the page, discard it. It is
// READ-ONLY after construction, so the fleet service's worker pool can share
// one instance across goroutines without synchronisation.
type CurrentStatePrefetch struct {
	// at is the request-level instant every bulk read was taken against. It
	// is the same instant the per-vehicle freshness verdicts use.
	at time.Time

	live          map[int64]signal.LiveSignalRead
	liveAttempted bool

	durable          map[int64]signal.State
	durableErr       error
	durableAttempted bool

	fsm          map[int64]fsmStateRecord
	fsmAttempted bool
}

// At returns the instant the prefetched reads were taken against.
func (p *CurrentStatePrefetch) At() time.Time {
	if p == nil {
		return time.Time{}
	}
	return p.at
}

// LiveReadAttempted reports whether the bulk live read ran, i.e. whether
// per-vehicle resolution can skip the per-vehicle live-store round trip.
func (p *CurrentStatePrefetch) LiveReadAttempted() bool {
	return p != nil && p.liveAttempted
}

// DurableReadAttempted reports whether the bulk signal_log read ran.
func (p *CurrentStatePrefetch) DurableReadAttempted() bool {
	return p != nil && p.durableAttempted
}

// FSMReadAttempted reports whether the bulk fsm_transitions read ran.
func (p *CurrentStatePrefetch) FSMReadAttempted() bool {
	return p != nil && p.fsmAttempted
}

// liveFor returns the prefetched live read for one vehicle. ok is false when
// no bulk live read was performed, which tells the caller to do its own
// per-vehicle read rather than treating the absence as "no signals".
func (p *CurrentStatePrefetch) liveFor(vehicleID int64) (signal.LiveSignalRead, bool) {
	if p == nil || !p.liveAttempted {
		return signal.LiveSignalRead{}, false
	}
	read, ok := p.live[vehicleID]
	if !ok {
		// The bulk reader owes an entry per requested vehicle. A hole means
		// this vehicle was not part of the prefetch, so the caller must read
		// it itself rather than silently see an empty live store.
		return signal.LiveSignalRead{}, false
	}
	return read, true
}

// durableFor returns the prefetched signal_log snapshot for one vehicle.
// ok is false when no bulk durable read was performed.
func (p *CurrentStatePrefetch) durableFor(vehicleID int64) (signal.State, error, bool) {
	if p == nil || !p.durableAttempted {
		return nil, nil, false
	}
	if p.durableErr != nil {
		return nil, p.durableErr, true
	}
	// A vehicle with no signal_log rows carries no entry; that is an
	// authoritative absence of durable history, not a failure.
	return p.durable[vehicleID], nil, true
}

// fsmFor returns the prefetched FSM state for one vehicle. ok is false when no
// bulk FSM read was performed. A vehicle with no transition row yields a zero
// record, which callers read as "unknown" exactly as the per-vehicle lookup
// does.
func (p *CurrentStatePrefetch) fsmFor(vehicleID int64) (fsmStateRecord, bool) {
	if p == nil || !p.fsmAttempted {
		return fsmStateRecord{}, false
	}
	return p.fsm[vehicleID], true
}

// PrefetchCurrentStates performs every bulk storage read the supplied
// vehicles' current states need.
//
// It NEVER fails the batch: each layer that cannot answer is recorded so the
// per-vehicle resolution degrades exactly as it would have on its own (live
// error → durable fallback; durable error → live-only assembly; FSM error →
// unknown state). The only returned error is a context that is already done,
// because in that case no honest answer can be produced at all.
//
// A layer whose bulk capability is absent is simply left un-prefetched, and
// ResolveCurrentStateWith performs that layer's per-vehicle read as before.
func (s *VehicleService) PrefetchCurrentStates(
	ctx context.Context,
	vehicleIDs []int64,
	live signal.LiveSignalStore,
	now time.Time,
) (*CurrentStatePrefetch, error) {
	if s == nil {
		return nil, fmt.Errorf("prefetch current states: nil vehicle service")
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("prefetch current states: %w", err)
	}
	if now.IsZero() {
		now = time.Now().UTC()
	} else {
		now = now.UTC()
	}

	pre := &CurrentStatePrefetch{at: now}
	ids := uniquePositiveIDs(vehicleIDs)
	if len(ids) == 0 {
		return pre, nil
	}
	traceID := trace.SpanFromContext(ctx).SpanContext().TraceID().String()

	// ── L1+L2: one pipelined live read for the whole page ───────────────
	// A nil live store type-asserts to ok=false, so the no-telemetry
	// deployment simply leaves this layer un-prefetched.
	if bulk, ok := live.(signal.BulkLiveSignalStore); ok {
		reads, err := bulk.GetAllBulk(ctx, ids, signal.LiveSignalReadDistributed)
		if err != nil {
			// Whole-call failure of the bulk primitive (never a transport
			// error — those arrive per vehicle). Leave the layer
			// un-prefetched so each vehicle falls back to its own read.
			log.Warn().Err(err).
				Int("vehicle_count", len(ids)).
				Str("trace_id", traceID).
				Msg("current state prefetch: bulk live read unavailable; falling back to per-vehicle reads")
		} else {
			pre.live = reads
			pre.liveAttempted = true
		}
	}

	// ── L3: one set-based signal_log read for the whole page ────────────
	if bulk, ok := s.state.(signal.BulkStateReader); ok {
		states, err := bulk.StatesAt(ctx, ids, now)
		if err != nil {
			// Recorded, not swallowed: every vehicle sees this error and logs
			// its own degradation warning exactly as the single-vehicle path
			// does when signal_log is unavailable.
			pre.durableErr = fmt.Errorf("bulk signal_log fallback for %d vehicles: %w", len(ids), err)
			log.Warn().Err(err).
				Int("vehicle_count", len(ids)).
				Str("trace_id", traceID).
				Msg("current state prefetch: bulk signal_log read failed; assembling from live values only")
		} else {
			pre.durable = states
		}
		pre.durableAttempted = true
	}

	// ── FSM: one set-based fsm_transitions read for the whole page ──────
	if bulk, ok := s.fsmStateLookup().(bulkFSMStateSource); ok {
		records, err := bulk.GetCurrentStatesSince(ctx, ids)
		if err != nil {
			// The per-vehicle lookup reports an unreadable FSM as "unknown".
			// Keep that verdict but make the cause visible once per batch
			// instead of silently per vehicle.
			log.Warn().Err(err).
				Int("vehicle_count", len(ids)).
				Str("trace_id", traceID).
				Msg("current state prefetch: bulk FSM state read failed; vehicle states reported as unknown")
			pre.fsm = map[int64]fsmStateRecord{}
		} else {
			pre.fsm = records
		}
		pre.fsmAttempted = true
	}

	return pre, nil
}

// GetCurrentStatesSince returns the most recent 'vehicle' FSM state and its
// entry timestamp for every requested vehicle in ONE query.
//
// It is the set-based counterpart of GetCurrentStateSince and uses the same
// (vehicle_id, ts DESC) index. Vehicles with no transition row carry no map
// entry, which callers read as "unknown" — the same verdict the per-vehicle
// lookup returns for a missing row.
//
// Unlike GetCurrentStateSince (which folds every failure into "unknown" for
// backwards compatibility), this method RETURNS its error so the caller can
// log the cause once per batch instead of silently degrading every vehicle.
func (p *vehicleStateProvider) GetCurrentStatesSince(ctx context.Context, vehicleIDs []int64) (map[int64]fsmStateRecord, error) {
	out := make(map[int64]fsmStateRecord)
	if p == nil || p.db == nil || p.db.Pool == nil {
		return out, nil
	}
	ids := uniquePositiveIDs(vehicleIDs)
	if len(ids) == 0 {
		return out, nil
	}

	const query = `SELECT DISTINCT ON (vehicle_id) vehicle_id, to_state, ts
FROM fsm_transitions
WHERE vehicle_id = ANY($1) AND fsm_name = 'vehicle'
ORDER BY vehicle_id, ts DESC`

	rows, err := p.db.Pool.Query(ctx, query, ids)
	if err != nil {
		return nil, fmt.Errorf("read current FSM states for %d vehicles: %w", len(ids), err)
	}
	defer rows.Close()

	for rows.Next() {
		var vehicleID int64
		var state string
		var since time.Time
		if err := rows.Scan(&vehicleID, &state, &since); err != nil {
			return nil, fmt.Errorf("scan fsm_transitions row: %w", err)
		}
		entered := since
		out[vehicleID] = fsmStateRecord{State: state, Since: &entered}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate fsm_transitions rows: %w", err)
	}
	return out, nil
}

// uniquePositiveIDs preserves first-seen order and drops non-positive ids.
func uniquePositiveIDs(vehicleIDs []int64) []int64 {
	if len(vehicleIDs) == 0 {
		return nil
	}
	seen := make(map[int64]struct{}, len(vehicleIDs))
	out := make([]int64, 0, len(vehicleIDs))
	for _, id := range vehicleIDs {
		if id <= 0 {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// ── Per-vehicle accessors used by ResolveCurrentStateWith ───────────────────
//
// Each helper answers from the batch prefetch when that layer was read in
// bulk, and performs the ORIGINAL per-vehicle read otherwise. There is no
// third behaviour: a layer is either prefetched (and its result — including
// its failure — is used verbatim) or read exactly as it always was.

// liveSignalValues returns one vehicle's merged L1+L2 live signals.
func (s *VehicleService) liveSignalValues(
	ctx context.Context,
	vehicleID int64,
	live signal.LiveSignalStore,
	pre *CurrentStatePrefetch,
) (map[string]*signal.Value, error) {
	if read, ok := pre.liveFor(vehicleID); ok {
		return read.Values, read.Err
	}
	return live.GetAll(ctx, vehicleID, signal.LiveSignalReadDistributed)
}

// currentFSMState returns one vehicle's persisted FSM state and entry instant.
func (s *VehicleService) currentFSMState(
	ctx context.Context,
	vehicleID int64,
	pre *CurrentStatePrefetch,
) (string, *time.Time, error) {
	if record, ok := pre.fsmFor(vehicleID); ok {
		return record.State, record.Since, nil
	}
	return s.fsmStateLookup().GetCurrentStateSince(ctx, vehicleID)
}

// durableSnapshot returns one vehicle's signal_log last-known-value snapshot.
//
// `attempted` is false only when NO durable reader is configured at all; it
// keeps the "no fallback wired" case distinguishable from "the fallback ran
// and found nothing", which is exactly the distinction the assembler needs to
// avoid reporting an unwired deployment as an empty history.
func (s *VehicleService) durableSnapshot(
	ctx context.Context,
	vehicleID int64,
	pre *CurrentStatePrefetch,
) (snap signal.State, err error, attempted bool) {
	if snap, err, ok := pre.durableFor(vehicleID); ok {
		return snap, err, true
	}
	if s.state == nil {
		return nil, nil, false
	}
	snap, err = s.state.State(ctx, vehicleID, time.Now().UTC())
	return snap, err, true
}

// fallbackFSMState returns the FSM state used to fill an empty state string
// during assembly. It deliberately consults only the persisted provider (or
// the batch prefetch of it), matching the pre-existing assembler behaviour.
func (s *VehicleService) fallbackFSMState(
	ctx context.Context,
	vehicleID int64,
	pre *CurrentStatePrefetch,
) (string, error) {
	if record, ok := pre.fsmFor(vehicleID); ok {
		return record.State, nil
	}
	if s.stateProvider == nil {
		return "", nil
	}
	state, _, err := s.stateProvider.GetCurrentStateSince(ctx, vehicleID)
	return state, err
}
