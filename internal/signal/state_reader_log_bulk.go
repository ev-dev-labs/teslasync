package signal

// L3 BULK read path (durable signal_log).
//
// The fleet batch current-state read needs the signal_log last-known-value
// fallback for EVERY vehicle in one page. One State() call per vehicle costs
// one query per car, so a 100-vehicle fleet issued 100 DISTINCT ON scans
// inside a single HTTP request. StatesAt answers all of them with ONE
// set-based query over the SAME table and the SAME index
// (signal_log_vehicle_field_ts / idx_signal_log_vehicle_field_ts, both
// (vehicle_id, field, ts DESC)).
//
// This is a signal_log read (ADR-001 / ADR-007 compliant). It introduces NO
// snapshot table, NO mirror table and NO materialised view.

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// BulkStateReader is the OPTIONAL set-based capability of a StateReader.
//
// Kept separate from StateReader so existing implementations and test fakes
// keep compiling; consumers type-assert for it and fall back to per-vehicle
// State() calls when it is absent.
//
// # Trusted-caller contract
//
// Identical to StateReader: implementations do NOT enforce per-vehicle
// authorization. The CALLER must have already decided that the requesting
// principal may read every id in vehicleIDs. Passing an id the caller has not
// authorised leaks that vehicle's state.
type BulkStateReader interface {
	// StatesAt returns the forward-folded state of every requested vehicle at
	// `at`, in ONE query. Vehicles with no signal_log rows at-or-before `at`
	// carry NO map entry (an absence, distinct from an empty state).
	StatesAt(ctx context.Context, vehicleIDs []int64, at time.Time) (map[int64]State, error)
}

var _ BulkStateReader = (*LogStateReader)(nil)

// StatesAt returns the latest value of every signal emitted at-or-before `at`
// for each requested vehicle, derived by forward-folding signal_log via
// DISTINCT ON (vehicle_id, field) in a SINGLE query.
//
// # Context contract
//
// The caller MUST pass a context with a deadline; this method does NOT impose
// an internal timeout, exactly like State.
//
// # Hot-path contract
//
// Cold path only, exactly like State: telemetry ingest, FSM and session
// boundary detection continue to read signal.Store (L1) and Redis HSET (L2).
//
// # Absence vs error
//
// A vehicle with no rows carries no map entry — the caller distinguishes "no
// durable history" from "empty state". A non-nil error means the whole query
// failed; there is no partial-failure mode for a single set-based statement,
// and pretending otherwise (returning a half-filled map plus an error) would
// let callers silently treat missing vehicles as having no history.
//
// # Slow-query observability
//
// The 500ms warn bar of State is scaled by the number of vehicles read, so a
// 100-vehicle batch is not reported as slow merely for being large. On query
// failure an Error log is emitted BEFORE returning the wrapped error.
func (r *LogStateReader) StatesAt(ctx context.Context, vehicleIDs []int64, at time.Time) (states map[int64]State, err error) {
	ids := dedupeVehicleIDs(vehicleIDs)

	ctx, span := otel.Tracer(signalLogTracerName).Start(
		ctx,
		"signal_log.read_states_bulk",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attribute.Int("vehicle_count", len(ids))),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "signal_log.read_states_bulk")
		}
		span.End()
	}()

	if at.IsZero() {
		// Same guard as State: a zero `at` is a caller bug, and answering it
		// with an empty map would be read as "no vehicle has any history".
		return nil, fmt.Errorf("states: at must be non-zero (use time.Now() for current state)")
	}
	if len(ids) == 0 {
		return map[int64]State{}, nil
	}

	// DISTINCT ON (vehicle_id, field) with a matching ORDER BY walks the
	// (vehicle_id, field, ts DESC) index and returns exactly one row per
	// (vehicle, signal) — the same forward-fold State performs, for the whole
	// set at once.
	const query = `SELECT DISTINCT ON (vehicle_id, field) vehicle_id, field,
       value_kind, str_value, bool_value, int_value, float_value, time_value
FROM signal_log
WHERE vehicle_id = ANY($1) AND ts <= $2
ORDER BY vehicle_id, field, ts DESC`

	start := time.Now()
	rows, queryErr := r.pool.Query(ctx, query, ids, at)
	if queryErr != nil {
		r.log.Error().
			Err(queryErr).
			Int("vehicle_count", len(ids)).
			Time("at", at).
			Msg("bulk state read failed")
		return nil, fmt.Errorf("states at %s for %d vehicles: %w", at.Format(time.RFC3339), len(ids), queryErr)
	}
	defer rows.Close()

	states, err = assembleStates(rows)
	elapsed := time.Since(start)
	if err != nil {
		r.log.Error().
			Err(err).
			Int("vehicle_count", len(ids)).
			Time("at", at).
			Msg("bulk state read failed")
		return nil, fmt.Errorf("states at %s for %d vehicles: %w", at.Format(time.RFC3339), len(ids), err)
	}

	if budget := time.Duration(len(ids)) * 500 * time.Millisecond; elapsed > budget {
		r.log.Warn().
			Int("vehicle_count", len(ids)).
			Time("at", at).
			Dur("duration", elapsed).
			Int("vehicles_returned", len(states)).
			Msg("slow bulk state read")
	}

	span.SetAttributes(attribute.Int("vehicles_returned", len(states)))
	return states, nil
}

// assembleStates walks a row iterator emitted by the StatesAt SQL query and
// builds one State map per vehicle.
//
// The iterator MUST be the result of a query that selects, in order:
//
//	vehicle_id, field, value_kind, str_value, bool_value, int_value,
//	float_value, time_value
//
// (matching the SQL in StatesAt). Exposed at package scope so tests can drive
// it with an in-memory iterator, exactly like assembleState.
func assembleStates(rows rowIterator) (map[int64]State, error) {
	states := make(map[int64]State)
	for rows.Next() {
		var vehicleID int64
		var fld string
		var kind int16
		var sv *string
		var bv *bool
		var iv *int64
		var fv *float64
		var tv *time.Time
		if err := rows.Scan(&vehicleID, &fld, &kind, &sv, &bv, &iv, &fv, &tv); err != nil {
			return nil, fmt.Errorf("scan signal_log row: %w", err)
		}
		state, ok := states[vehicleID]
		if !ok {
			state = make(State)
			states[vehicleID] = state
		}
		state[fld] = decodeRow(kind, sv, bv, iv, fv, tv, nil)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate signal_log rows: %w", err)
	}
	return states, nil
}
