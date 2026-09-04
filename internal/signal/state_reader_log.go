// Package signal owns state-read semantics over signal_log. See ADR-002.
//
// state_reader_log.go is the signal_log-backed StateReader implementation.
// The interface assertion below keeps State, SignalAt, and Timeline aligned
// with the public contract.
package signal

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// signalLogTracerName is the OpenTelemetry tracer name for signal_log
// read spans (State / SignalAt / Timeline). The trace-coverage audit greps
// for this exact constant.
const signalLogTracerName = "signal"

// pgxQuerier is the narrow query seam consumed by LogStateReader. *pgxpool.Pool
// satisfies it directly via its Query method, so production wiring passes the
// pool unwrapped. Tests inject a fake to drive Query result and timing without
// spinning up Postgres.
type pgxQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// rowIterator is the narrow row-traversal seam used by assembleState. pgx.Rows
// satisfies it via structural typing (Next, Scan, Err, Close all match), so
// production code passes pgx.Rows directly. Tests build a fakeRowIterator
// without depending on pgx so the row-assembly logic can be exercised against
// in-memory tuples.
//
// rowIterator is unexported because it is purely the test seam between the SQL
// query above and the in-memory map assembly below.
type rowIterator interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close()
}

// LogStateReader is the signal_log-backed implementation of StateReader. It
// derives per-vehicle state by forward-folding the signal_log change feed:
// for every signal name it returns the most recent emission at-or-before the
// query timestamp.
//
// # Trusted-caller contract
//
// LogStateReader does NOT enforce per-vehicle authorization. The caller —
// typically an HTTP handler protected by Authentik ForwardAuth or the
// application identity during cmd/teslasync warmup — is responsible for
// verifying that the requesting principal is allowed to read vehicleID. This
// type only enforces correctness of the change-feed → state derivation, never
// who is allowed to ask. Any future cross-tenant deployment MUST add an
// authorization layer in front of this type, not inside it.
//
// # Concurrency contract
//
// LogStateReader is safe for concurrent use by multiple goroutines. The
// underlying *pgxpool.Pool is itself concurrency-safe and the type holds no
// mutable state (the zerolog.Logger is value-typed and copy-on-pass). Do not
// wrap with a mutex; do not allocate one per request — share a single
// instance across the process.
type LogStateReader struct {
	pool pgxQuerier
	log  zerolog.Logger
}

// NewLogStateReader returns a LogStateReader bound to the given pgx pool and
// logger. The pool MUST outlive the reader; callers are responsible for
// closing the pool during shutdown. Passing a nil pool is permitted only for
// constructing the type for compile-time interface checks; State() will panic
// on the first call if pool is nil.
func NewLogStateReader(pool *pgxpool.Pool, log zerolog.Logger) *LogStateReader {
	// Storing *pgxpool.Pool as a pgxQuerier interface lets tests substitute a
	// fake without changing the struct shape. A nil *pgxpool.Pool stored in
	// the interface field becomes a typed-nil interface — calling Query on it
	// would panic, which is the expected behavior for a misconfigured caller.
	var q pgxQuerier
	if pool != nil {
		q = pool
	}
	return &LogStateReader{pool: q, log: log}
}

// Compile-time assertion that LogStateReader satisfies the StateReader
// contract declared in state_reader.go. This forces SignalAt and Timeline to
// exist on the type.
var _ StateReader = (*LogStateReader)(nil)

// State returns the latest value of every signal emitted at-or-before `at`
// for vehicleID, derived by forward-folding signal_log via DISTINCT ON
// (signal). Signals never emitted before `at` carry no map entry; signals
// whose latest emission was an explicit nil carry an entry with a nil value
// (this distinction matters to forward-fold semantics in pivot.go).
//
// # Context contract
//
// The caller MUST pass a context with a deadline; this method does NOT
// impose an internal timeout. The deadline policy is the caller's (handler
// vs warmup vs background reconciliation), and adding an internal timeout
// here would silently shorten the caller's deadline.
//
// # Hot-path contract
//
// Hot-path callers MUST NOT use this method. Telemetry ingest, FSM, and
// session boundary detection MUST continue to read from signal.Store (L1)
// and Redis HSET (L2) per ADR-007. This method is intended for cold-path
// HTTP handler reads, warmup reconstruction, and chatbot/RAG state lookups.
//
// # Slow-query observability
//
// If the underlying query takes longer than 500ms, a Warn log is emitted
// with vehicle_id, at, duration, and rows. On query failure an Error log is
// emitted BEFORE returning the wrapped error, so operators see the failure
// even if the caller swallows the error. The success-fast-path emits no
// logs (zero noise for the cold path's own latency budget).
//
// # Schema
//
// signal_log stores values in typed columns dictated by value_kind (per
// migration 000186): str_value, bool_value, int_value, float_value,
// time_value. State decodes each row into the typed Go primitive
// (string, bool, int64, float64, time.Time) — callers do val.(float64)
// etc. and receive the correct Go type, matching the typed-value contract
// Store.GetFloat/GetBool/GetString already provide on the L1 hot path.
// Location compounds are flattened by the codec into Latitude/Longitude
// atomics before they reach signal_log; the cold path
// never sees a compound row. See ADR-002 + ADR-004.
func (r *LogStateReader) State(ctx context.Context, vehicleID int64, at time.Time) (s State, err error) {
	ctx, span := otel.Tracer(signalLogTracerName).Start(
		ctx,
		"signal_log.read_state",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(attribute.Int64("vehicle_id", vehicleID)),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "signal_log.read_state")
		}
		span.End()
	}()

	if at.IsZero() {
		// A zero `at` would silently match no rows because every ts
		// is after time.Time{} when serialized through pgx — but worse, a
		// zero `at` is almost always a programming error (forgot to pass
		// time.Now() at the call site). Fail loud instead of returning an
		// empty State that callers will mistake for "no signals ever".
		return nil, fmt.Errorf("state: at must be non-zero (use time.Now() for current state)")
	}

	const query = `SELECT DISTINCT ON (field) field,
       value_kind, str_value, bool_value, int_value, float_value, time_value
FROM signal_log
WHERE vehicle_id = $1 AND ts <= $2
ORDER BY field, ts DESC`

	start := time.Now()
	rows, err := r.pool.Query(ctx, query, vehicleID, at)
	if err != nil {
		// Log BEFORE returning so operators see the failure even if the
		// caller swallows the error in a `_ = err` or aggregated handler.
		r.log.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Time("at", at).
			Msg("state read failed")
		return nil, fmt.Errorf("state at %s for vehicle %d: %w", at.Format(time.RFC3339), vehicleID, err)
	}
	defer rows.Close()

	state, err := assembleState(rows)
	elapsed := time.Since(start)
	if err != nil {
		r.log.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Time("at", at).
			Msg("state read failed")
		return nil, fmt.Errorf("state at %s for vehicle %d: %w", at.Format(time.RFC3339), vehicleID, err)
	}

	if elapsed > 500*time.Millisecond {
		r.log.Warn().
			Int64("vehicle_id", vehicleID).
			Time("at", at).
			Dur("duration", elapsed).
			Int("rows", len(state)).
			Msg("slow state read")
	}

	span.SetAttributes(attribute.Int("signals_returned", len(state)))
	return state, nil
}

// SignalAt returns the latest value of `signal` at-or-before `at` for
// vehicleID by issuing a single LIMIT 1 lookup against signal_log. It is
// the cheap counterpart to State when the caller only needs one signal —
// no DISTINCT ON, no in-process map assembly, no Location flatten.
//
// # Context contract
//
// The caller MUST pass a context with a deadline; this method does NOT
// impose an internal timeout. The deadline policy is the caller's (handler
// vs warmup vs background reconciliation), and adding an internal timeout
// here would silently shorten the caller's deadline.
//
// # Hot-path contract
//
// Hot-path callers MUST NOT use this method. Telemetry ingest, FSM, and
// session boundary detection MUST continue to read from signal.Store (L1)
// and Redis HSET (L2) per ADR-007. This method is intended for cold-path
// HTTP handler reads, warmup reconstruction, and chatbot/RAG state lookups.
//
// # Absence vs error
//
// A signal that has never been emitted at-or-before `at` returns
// (nil, nil). The absence of a value is NOT an error — the caller decides
// how to interpret a missing observation (forward-fill from earlier state,
// treat as unknown, etc.). A non-nil error means transport / query failure
// only.
//
// # Slow-query observability
//
// If the underlying query takes longer than 200ms, a Warn log is emitted
// (the bar is lower than State's 500ms because SignalAt is a single-row
// LIMIT 1 lookup against the same composite index). On query failure an
// Error log is emitted BEFORE returning the wrapped error, so operators
// see the failure even if the caller swallows the error. The
// success-fast-path emits no logs.
//
// # Schema
//
// signal_log stores values in typed columns dictated by value_kind (per
// migration 000186): str_value, bool_value, int_value, float_value,
// time_value. SignalAt selects value_kind plus all five typed columns and
// decodes them via decodeSignalLogRow into the typed Go primitive
// (string, bool, int64, float64, time.Time). Location is flattened by
// the codec into Latitude/Longitude atomics before reaching signal_log, so
// callers asking for "Location" via SignalAt will see no
// row; they must request "Latitude"/"Longitude" individually.
func (r *LogStateReader) SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (val SignalValue, err error) {
	ctx, span := otel.Tracer(signalLogTracerName).Start(
		ctx,
		"signal_log.read_signal_at",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.Int64("vehicle_id", vehicleID),
			attribute.String("field", signal),
		),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "signal_log.read_signal_at")
		}
		span.End()
	}()

	if at.IsZero() {
		// A zero `at` would silently match no rows because every ts
		// is after time.Time{} when serialized through pgx — but worse, a
		// zero `at` is almost always a programming error (forgot to pass
		// time.Now() at the call site). Fail loud instead of returning
		// (nil, nil) which the caller would mistake for "never emitted".
		return nil, fmt.Errorf("signal_at: at must be non-zero (use time.Now())")
	}
	if signal == "" {
		// An empty signal name would scan the whole vehicle's history with
		// no matching rows (cheap on the index) but is unambiguously a
		// programming error (typo, uninitialized string). Fail loud so
		// callers catch it in tests, not in latency graphs.
		return nil, fmt.Errorf("signal_at: signal name must not be empty")
	}

	const query = `SELECT value_kind, str_value, bool_value, int_value, float_value, time_value
FROM signal_log
WHERE vehicle_id = $1 AND field = $2 AND ts <= $3
ORDER BY ts DESC
LIMIT 1`

	start := time.Now()
	rows, err := r.pool.Query(ctx, query, vehicleID, signal, at)
	if err != nil {
		// Log BEFORE returning so operators see the failure even if the
		// caller swallows the error in a `_ = err` or aggregated handler.
		r.log.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Str("signal", signal).
			Time("at", at).
			Msg("signal_at read failed")
		return nil, fmt.Errorf("signal_at %s for vehicle %d: %w", signal, vehicleID, err)
	}
	defer rows.Close()

	var value SignalValue
	if rows.Next() {
		var kind int16
		var sv *string
		var bv *bool
		var iv *int64
		var fv *float64
		var tv *time.Time
		if err := rows.Scan(&kind, &sv, &bv, &iv, &fv, &tv); err != nil {
			r.log.Error().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Str("signal", signal).
				Time("at", at).
				Msg("signal_at read failed")
			return nil, fmt.Errorf("signal_at %s for vehicle %d: %w", signal, vehicleID, err)
		}
		value = r.decodeSignalLogRow(kind, sv, bv, iv, fv, tv)
	}
	if err := rows.Err(); err != nil {
		r.log.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Str("signal", signal).
			Time("at", at).
			Msg("signal_at read failed")
		return nil, fmt.Errorf("signal_at %s for vehicle %d: %w", signal, vehicleID, err)
	}

	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		r.log.Warn().
			Int64("vehicle_id", vehicleID).
			Str("signal", signal).
			Time("at", at).
			Dur("duration", elapsed).
			Msg("slow signal_at read")
	}

	span.SetAttributes(attribute.Bool("found", value != nil))
	return value, nil
}

// Timeline returns one TimelineRow per change-feed emission timestamp in
// the half-open interval (from, to] for vehicleID, projecting only the
// signals named in `fields`. Rows are sorted ascending by Timestamp. Each
// row's Fields map carries every mapping.Field key, with the value
// forward-filled from the most recent emission at-or-before that row's
// timestamp (the "seed" comes from a DISTINCT ON lookup at-or-before
// `from`). This is the shape every chart endpoint expects.
//
// # Mode
//
// CHART MODE (opts.CollapseBy empty/nil): every change-feed emission
// becomes one TimelineRow. This is the stepped-line / time-series shape
// chart components consume.
//
// LIST MODE (opts.CollapseBy non-empty): consecutive rows whose
// projections over the listed Field names are equal collapse to the
// earliest row of the run. Use this for tabular history endpoints
// (/media/playback-history, /security/events, etc.) that should not
// render duplicate "still on D, still 65 mph" rows. Each entry in
// opts.CollapseBy MUST appear as a mapping.Field in `fields`; otherwise
// Timeline returns an error BEFORE issuing SQL so typos at the call
// site do not silently produce duplicate rows.
//
// # Context contract
//
// The caller MUST pass a context with a deadline; this method does NOT
// impose an internal timeout. The deadline policy is the caller's (handler
// vs warmup vs background reconciliation), and adding an internal timeout
// here would silently shorten the caller's deadline.
//
// # Hot-path contract
//
// Hot-path callers MUST NOT use this method. Telemetry ingest, FSM, and
// session boundary detection MUST continue to read from signal.Store (L1)
// and Redis HSET (L2) per ADR-007. This method is intended for cold-path
// HTTP chart handlers, history endpoints, and chatbot/RAG range queries.
//
// # Edge guards
//
// Bad inputs are rejected BEFORE any SQL executes so a misconfigured
// caller cannot accidentally scan signal_log unbounded:
//
//   - Zero from or zero to: rejected (almost always a programming error;
//     a zero time would silently match every row through pgx).
//   - from after to: rejected (an inverted window is unambiguously a bug
//     and would silently yield zero rows).
//   - len(fields) == 0: returns (nil, nil) immediately. There is nothing
//     to project, so the cheapest correct answer is no SQL and no rows.
//   - to-from greater than 366 days: rejected. Defensive guard against an
//     accidental whole-history scan that would slip past the zero/from-to
//     guards (e.g. callers computing from=time.Now().AddDate(-100, 0, 0)).
//     A year is the largest legitimate chart window we ship.
//
// # Slow-query observability
//
// If either underlying query takes longer than 1s, a Warn log is emitted
// with vehicle_id, from, to, duration, and rows. On query failure an Error
// log is emitted BEFORE returning the wrapped error so operators see the
// failure even if the caller swallows it. The success-fast-path emits no
// logs (zero noise for the cold path's own latency budget).
//
// # Schema
//
// signal_log stores values in typed columns dictated by value_kind (per
// migration 000186): str_value, bool_value, int_value, float_value,
// time_value. Both the seed query and the window query select value_kind
// plus all five typed columns and decode each row via decodeSignalLogRow.
// Location compounds are flattened by the codec into Latitude/Longitude
// atomics before signal_log writes; the cold path
// never observes a Location compound row.
func (r *LogStateReader) Timeline(ctx context.Context, vehicleID int64, fields []FieldMapping, from, to time.Time, opts TimelineOptions) (rowsOut []TimelineRow, err error) {
	ctx, span := otel.Tracer(signalLogTracerName).Start(
		ctx,
		"signal_log.read_timeline",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.Int64("vehicle_id", vehicleID),
			attribute.Int("field_count", len(fields)),
			attribute.Float64("window_seconds", to.Sub(from).Seconds()),
		),
	)
	defer func() {
		if err != nil {
			span.RecordError(err)
			span.SetStatus(codes.Error, "signal_log.read_timeline")
		}
		span.End()
	}()

	// Edge guards run BEFORE any SQL. A misconfigured caller (zero `at`,
	// inverted window, accidental whole-history scan) must be a loud error
	// at the contract boundary, not a silent zero-row result or an
	// unbounded sequential scan against signal_log.
	if from.IsZero() || to.IsZero() {
		return nil, fmt.Errorf("timeline: from/to must be non-zero")
	}
	if from.After(to) {
		return nil, fmt.Errorf("timeline: from (%s) must be <= to (%s)", from.Format(time.RFC3339), to.Format(time.RFC3339))
	}
	if len(fields) == 0 {
		// No projection requested → nothing to read or fold. Returning a
		// typed nil slice (rather than an empty slice) is the cheapest
		// correct answer and is range-safe in Go.
		return nil, nil
	}
	if window := to.Sub(from); window > 366*24*time.Hour {
		return nil, fmt.Errorf("timeline: window > 366 days is not supported (got %s)", window)
	}
	// Validate opts.CollapseBy entries reference declared output Field
	// names. Run BEFORE any SQL so a misconfigured caller (typo in a
	// collapse-key name) fails loudly at the contract boundary instead
	// of silently issuing a window scan whose rows then collapse on a
	// non-existent key (which projectCollapseKey would treat as nil for
	// every row, producing exactly one collapsed output row).
	if len(opts.CollapseBy) > 0 {
		fieldSet := make(map[string]struct{}, len(fields))
		for _, f := range fields {
			fieldSet[f.Field] = struct{}{}
		}
		for _, c := range opts.CollapseBy {
			if _, ok := fieldSet[c]; !ok {
				return nil, fmt.Errorf("timeline: collapse field %q not in mappings", c)
			}
		}
	}

	// Build the unique signal set the SQL needs to filter by. Preserve
	// the first-seen order from `fields` for deterministic logging, but
	// dedupe so the SQL ANY($) array stays minimal when callers map
	// several output Fields off the same source Signal.
	seen := make(map[string]struct{}, len(fields))
	signals := make([]string, 0, len(fields))
	for _, f := range fields {
		if _, ok := seen[f.Signal]; ok {
			continue
		}
		seen[f.Signal] = struct{}{}
		signals = append(signals, f.Signal)
	}

	start := time.Now()

	// Seed query: DISTINCT ON (field) over the at-or-before-from slice.
	// Mirrors the pattern in State() but constrained to the requested
	// signal set so the planner can pick the (vehicle_id, field, ts)
	// composite index for a tight backward scan.
	const seedQuery = `SELECT DISTINCT ON (field) field,
       value_kind, str_value, bool_value, int_value, float_value, time_value
FROM signal_log
WHERE vehicle_id = $1 AND ts <= $2 AND field = ANY($3)
ORDER BY field, ts DESC`

	seedRows, err := r.pool.Query(ctx, seedQuery, vehicleID, from, signals)
	if err != nil {
		r.log.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Time("from", from).
			Time("to", to).
			Msg("timeline seed read failed")
		return nil, fmt.Errorf("timeline seed %s..%s for vehicle %d: %w", from.Format(time.RFC3339), to.Format(time.RFC3339), vehicleID, err)
	}

	seed := make(map[string]SignalValue, len(signals))
	for seedRows.Next() {
		var fld string
		var kind int16
		var sv *string
		var bv *bool
		var iv *int64
		var fv *float64
		var tv *time.Time
		if err := seedRows.Scan(&fld, &kind, &sv, &bv, &iv, &fv, &tv); err != nil {
			seedRows.Close()
			r.log.Error().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Time("from", from).
				Time("to", to).
				Msg("timeline seed read failed")
			return nil, fmt.Errorf("timeline seed %s..%s for vehicle %d: %w", from.Format(time.RFC3339), to.Format(time.RFC3339), vehicleID, err)
		}
		seed[fld] = r.decodeSignalLogRow(kind, sv, bv, iv, fv, tv)
	}
	seedErr := seedRows.Err()
	// Close the seed connection BEFORE issuing the window query so a
	// pool of size 1 (test/CI configs) does not deadlock waiting for a
	// connection that this method itself is holding.
	seedRows.Close()
	if seedErr != nil {
		r.log.Error().
			Err(seedErr).
			Int64("vehicle_id", vehicleID).
			Time("from", from).
			Time("to", to).
			Msg("timeline seed read failed")
		return nil, fmt.Errorf("timeline seed %s..%s for vehicle %d: %w", from.Format(time.RFC3339), to.Format(time.RFC3339), vehicleID, seedErr)
	}

	// Location compounds are flattened by the codec into Latitude/Longitude
	// atomics; signal_log never stores compound rows. Callers that want lat/lng
	// should map them as
	// individual signals in `fields`.

	// Window query: every emission in (from, to] for the requested
	// signals, ordered ascending so forwardFold can stream events in
	// chronological order without an in-memory sort.
	const windowQuery = `SELECT ts, field,
       value_kind, str_value, bool_value, int_value, float_value, time_value
FROM signal_log
WHERE vehicle_id = $1 AND ts > $2 AND ts <= $3 AND field = ANY($4)
ORDER BY ts ASC`

	windowRows, err := r.pool.Query(ctx, windowQuery, vehicleID, from, to, signals)
	if err != nil {
		r.log.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Time("from", from).
			Time("to", to).
			Msg("timeline window read failed")
		return nil, fmt.Errorf("timeline window %s..%s for vehicle %d: %w", from.Format(time.RFC3339), to.Format(time.RFC3339), vehicleID, err)
	}
	defer windowRows.Close()

	folder := newTimelineFolder(seed, fields, opts.CollapseBy, opts.MaxRows)
	for windowRows.Next() {
		var eventTs time.Time
		var fld string
		var kind int16
		var sv *string
		var bv *bool
		var iv *int64
		var fv *float64
		var tv *time.Time
		if err := windowRows.Scan(&eventTs, &fld, &kind, &sv, &bv, &iv, &fv, &tv); err != nil {
			r.log.Error().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Time("from", from).
				Time("to", to).
				Msg("timeline window read failed")
			return nil, fmt.Errorf("timeline window %s..%s for vehicle %d: %w", from.Format(time.RFC3339), to.Format(time.RFC3339), vehicleID, err)
		}
		if !folder.Add(rawEvent{
			Ts:     eventTs,
			Signal: fld,
			Value:  r.decodeSignalLogRow(kind, sv, bv, iv, fv, tv),
		}) {
			break
		}
	}
	if err := windowRows.Err(); err != nil {
		r.log.Error().
			Err(err).
			Int64("vehicle_id", vehicleID).
			Time("from", from).
			Time("to", to).
			Msg("timeline window read failed")
		return nil, fmt.Errorf("timeline window %s..%s for vehicle %d: %w", from.Format(time.RFC3339), to.Format(time.RFC3339), vehicleID, err)
	}

	rows := folder.Finish()

	if elapsed := time.Since(start); elapsed > time.Second || folder.truncated {
		event := r.log.Warn()
		if elapsed <= time.Second {
			event = r.log.Info()
		}
		event.
			Int64("vehicle_id", vehicleID).
			Time("from", from).
			Time("to", to).
			Dur("duration", elapsed).
			Int("rows", len(rows)).
			Int("events", folder.events).
			Int("seed", len(seed)).
			Bool("truncated", folder.truncated).
			Msg("slow timeline read")
	}

	span.SetAttributes(attribute.Int("rows_returned", len(rows)))
	return rows, nil
}

// assembleState walks a row iterator emitted by the State SQL query and
// builds a State map by decoding each row's typed value columns into a
// single SignalValue. Used internally by State; exposed at package scope so
// tests can drive it via a fakeRowIterator without spinning up Postgres.
//
// The iterator MUST be the result of a query that selects, in order:
//
//	field, value_kind, str_value, bool_value, int_value, float_value, time_value
//
// (matching the SQL in State).
func assembleState(rows rowIterator) (State, error) {
	state := make(State)
	for rows.Next() {
		var fld string
		var kind int16
		var sv *string
		var bv *bool
		var iv *int64
		var fv *float64
		var tv *time.Time
		if err := rows.Scan(&fld, &kind, &sv, &bv, &iv, &fv, &tv); err != nil {
			return nil, fmt.Errorf("scan signal_log row: %w", err)
		}
		state[fld] = decodeRow(kind, sv, bv, iv, fv, tv, nil)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate signal_log rows: %w", err)
	}
	return state, nil
}

// decodeSignalLogRow decodes one signal_log row's typed columns into a
// SignalValue dictated by value_kind. Returns the typed Go primitive
// directly (string/bool/int64/float64/time.Time) so callers receive the
// correct Go type via the existing SignalValue=any contract.
//
// value_kind acts as the discriminator (per migration 000186):
//   - ValueKindString               -> str_value
//   - ValueKindBool                 -> bool_value
//   - ValueKindInt32/Int64/Enum     -> int_value (BIGINT widens int32/enum)
//   - ValueKindFloat/Double         -> float_value
//   - ValueKindTime                 -> time_value
//
// ValueKindUnknown / ValueKindCompound / ValueKindInvalid are NOT
// representable in signal_log per the migration COMMENT block — the
// codec drops invalid samples and the router rejects unknown kinds before
// the cold-path writer ever sees them. Any such row is a defensive Warn
// log + nil return rather than a panic.
//
// Named decodeSignalLogRow (not decodeSignalValue) to avoid collision with
// the Redis-envelope decoder of the same conceptual purpose in
// redis_cache.go, which operates on the L2 cache's string-encoded payload
// format.
func (r *LogStateReader) decodeSignalLogRow(kind int16, sv *string, bv *bool, iv *int64, fv *float64, tv *time.Time) SignalValue {
	return decodeRow(kind, sv, bv, iv, fv, tv, &r.log)
}

// decodeRow is the package-scoped pure decoder shared by assembleState
// (which has no logger) and LogStateReader.decodeSignalLogRow (which
// passes its zerolog.Logger so unexpected kinds are observable). Pass
// log==nil to skip the warn path.
func decodeRow(kind int16, sv *string, bv *bool, iv *int64, fv *float64, tv *time.Time, log *zerolog.Logger) SignalValue {
	switch protomodel.ValueKind(kind) {
	case protomodel.ValueKindString, protomodel.ValueKindEnum:
		// Enum is stored in int_value as the parsed proto enum number;
		// when the writer falls back to a string label (no numeric
		// route), str_value carries it. Prefer the int when present.
		if iv != nil {
			return *iv
		}
		if sv != nil {
			return *sv
		}
		return nil
	case protomodel.ValueKindBool:
		if bv != nil {
			return *bv
		}
		return nil
	case protomodel.ValueKindInt32, protomodel.ValueKindInt64:
		if iv != nil {
			return *iv
		}
		return nil
	case protomodel.ValueKindFloat, protomodel.ValueKindDouble:
		if fv != nil {
			return *fv
		}
		return nil
	case protomodel.ValueKindTime:
		if tv != nil {
			return *tv
		}
		return nil
	default:
		// ValueKindUnknown / ValueKindCompound / ValueKindInvalid never
		// appear in signal_log per migration 000186. Defensive log +
		// nil return rather than panic so a stray bad row doesn't take
		// down the cold path.
		if log != nil {
			log.Warn().
				Int16("value_kind", kind).
				Msg("state_reader: unexpected value_kind in signal_log row")
		}
		return nil
	}
}
