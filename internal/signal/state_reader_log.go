// Package signal owns state-read semantics over signal_log. See ADR-002.
//
// state_reader_log.go is the signal_log-backed implementation of the
// StateReader interface declared in state_reader.go. This file provides
// LogStateReader, State() (Prompt 05), SignalAt() (Prompt 06), and
// Timeline() chart mode (Prompt 07). Timeline list-mode (collapse) is
// deferred to Prompt 08; calling Timeline with a non-empty CollapseBy
// returns a phase-39-08 error rather than panicking, so the type can be
// safely wired into chart-mode handlers before Prompt 08 lands.
// The interface assertion at the bottom forces every method on
// StateReader to exist on this type so the package compiles.
package signal

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

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
// exist on the type even before Prompts 06/07/08 implement them.
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
// signal_log stores values across four typed columns (value_num, value_str,
// value_bool, value_jsonb). State decodes them into a single SignalValue
// per signal using the canonical priority num → bool → jsonb → str.
// Historical Location compounds (stored as JSONB {Lat, Lng}) are flattened
// into Latitude/Longitude keys on the returned map via
// unpackLocationCompounds.
func (r *LogStateReader) State(ctx context.Context, vehicleID int64, at time.Time) (State, error) {
	if at.IsZero() {
		// A zero `at` would silently match no rows because every created_at
		// is after time.Time{} when serialized through pgx — but worse, a
		// zero `at` is almost always a programming error (forgot to pass
		// time.Now() at the call site). Fail loud instead of returning an
		// empty State that callers will mistake for "no signals ever".
		return nil, fmt.Errorf("state: at must be non-zero (use time.Now() for current state)")
	}

	const query = `SELECT DISTINCT ON (signal) signal,
       value_num, value_str, value_bool, value_jsonb,
       created_at
FROM signal_log
WHERE vehicle_id = $1 AND created_at <= $2
ORDER BY signal, created_at DESC`

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

	state = unpackLocationCompounds(state)

	if elapsed > 500*time.Millisecond {
		r.log.Warn().
			Int64("vehicle_id", vehicleID).
			Time("at", at).
			Dur("duration", elapsed).
			Int("rows", len(state)).
			Msg("slow state read")
	}

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
// signal_log stores values across four typed columns (value_num, value_str,
// value_bool, value_jsonb). SignalAt selects all four and decodes them
// into a single SignalValue using the same canonical priority as State
// (num → bool → jsonb → str). When `signal == "Location"` the returned
// value is the raw decoded compound (typically map[string]any{"Lat", "Lng"});
// callers who want flattened Latitude/Longitude scalars MUST use State,
// which performs the unpack at the State-map level.
func (r *LogStateReader) SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (SignalValue, error) {
	if at.IsZero() {
		// A zero `at` would silently match no rows because every created_at
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

	const query = `SELECT value_num, value_str, value_bool, value_jsonb
FROM signal_log
WHERE vehicle_id = $1 AND signal = $2 AND created_at <= $3
ORDER BY created_at DESC
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
		var vNum *float64
		var vStr *string
		var vBool *bool
		var vJsonb []byte
		if err := rows.Scan(&vNum, &vStr, &vBool, &vJsonb); err != nil {
			r.log.Error().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Str("signal", signal).
				Time("at", at).
				Msg("signal_at read failed")
			return nil, fmt.Errorf("signal_at %s for vehicle %d: %w", signal, vehicleID, err)
		}
		value = decodeSignalLogRow(vNum, vStr, vBool, vJsonb)
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
// Prompt 07 implements CHART MODE only: opts.CollapseBy MUST be empty/nil.
// Passing a non-empty CollapseBy returns a phase-39-08 error rather than
// panicking, so callers can safely wire Timeline into chart-mode handlers
// before list-mode collapse is implemented.
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
// signal_log stores values across four typed columns (value_num, value_str,
// value_bool, value_jsonb). Both the seed query and the window query
// select all four and decode each row into a SignalValue using the
// canonical priority num → bool → jsonb → str. When "Location" is in
// the projected signal set the seed map is post-processed via
// unpackLocationCompounds so callers asking for the Location compound
// also see flattened Latitude/Longitude in the seed.
func (r *LogStateReader) Timeline(ctx context.Context, vehicleID int64, fields []FieldMapping, from, to time.Time, opts TimelineOptions) ([]TimelineRow, error) {
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

	// Build the unique signal set the SQL needs to filter by. Preserve
	// the first-seen order from `fields` for deterministic logging, but
	// dedupe so the SQL ANY($) array stays minimal when callers map
	// several output Fields off the same source Signal.
	seen := make(map[string]struct{}, len(fields))
	signals := make([]string, 0, len(fields))
	hasLocation := false
	for _, f := range fields {
		if _, ok := seen[f.Signal]; ok {
			continue
		}
		seen[f.Signal] = struct{}{}
		signals = append(signals, f.Signal)
		if f.Signal == "Location" {
			hasLocation = true
		}
	}

	start := time.Now()

	// Seed query: DISTINCT ON (signal) over the at-or-before-from slice.
	// Mirrors the pattern in State() but constrained to the requested
	// signal set so the planner can pick the (vehicle_id, signal,
	// created_at) composite index for a tight backward scan.
	const seedQuery = `SELECT DISTINCT ON (signal) signal,
       value_num, value_str, value_bool, value_jsonb
FROM signal_log
WHERE vehicle_id = $1 AND created_at <= $2 AND signal = ANY($3)
ORDER BY signal, created_at DESC`

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
		var sig string
		var vNum *float64
		var vStr *string
		var vBool *bool
		var vJsonb []byte
		if err := seedRows.Scan(&sig, &vNum, &vStr, &vBool, &vJsonb); err != nil {
			seedRows.Close()
			r.log.Error().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Time("from", from).
				Time("to", to).
				Msg("timeline seed read failed")
			return nil, fmt.Errorf("timeline seed %s..%s for vehicle %d: %w", from.Format(time.RFC3339), to.Format(time.RFC3339), vehicleID, err)
		}
		seed[sig] = decodeSignalLogRow(vNum, vStr, vBool, vJsonb)
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

	if hasLocation {
		// Treat seed as a State to reuse the canonical Location flatten;
		// after this call the seed exposes Latitude/Longitude scalars in
		// addition to (or replacing) the original Location compound.
		seed = map[string]SignalValue(unpackLocationCompounds(State(seed)))
	}

	// Window query: every emission in (from, to] for the requested
	// signals, ordered ascending so forwardFold can stream events in
	// chronological order without an in-memory sort.
	const windowQuery = `SELECT created_at, signal,
       value_num, value_str, value_bool, value_jsonb
FROM signal_log
WHERE vehicle_id = $1 AND created_at > $2 AND created_at <= $3 AND signal = ANY($4)
ORDER BY created_at ASC`

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

	var events []rawEvent
	for windowRows.Next() {
		var eventTs time.Time
		var sig string
		var vNum *float64
		var vStr *string
		var vBool *bool
		var vJsonb []byte
		if err := windowRows.Scan(&eventTs, &sig, &vNum, &vStr, &vBool, &vJsonb); err != nil {
			r.log.Error().
				Err(err).
				Int64("vehicle_id", vehicleID).
				Time("from", from).
				Time("to", to).
				Msg("timeline window read failed")
			return nil, fmt.Errorf("timeline window %s..%s for vehicle %d: %w", from.Format(time.RFC3339), to.Format(time.RFC3339), vehicleID, err)
		}
		events = append(events, rawEvent{
			Ts:     eventTs,
			Signal: sig,
			Value:  decodeSignalLogRow(vNum, vStr, vBool, vJsonb),
		})
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

	rows := forwardFold(seed, events, fields, from, to)

	if elapsed := time.Since(start); elapsed > time.Second {
		r.log.Warn().
			Int64("vehicle_id", vehicleID).
			Time("from", from).
			Time("to", to).
			Dur("duration", elapsed).
			Int("rows", len(rows)).
			Int("events", len(events)).
			Int("seed", len(seed)).
			Msg("slow timeline read")
	}

	if len(opts.CollapseBy) > 0 {
		// Prompt 08 will swap this for `collapseTimeline(rows, opts.CollapseBy), nil`.
		// Until then the contract is "chart mode works, list mode is an
		// explicit not-implemented error" so callers wired up early do
		// not silently fall through to chart-mode behavior.
		return nil, fmt.Errorf("phase-39-08 not yet implemented: TimelineOptions.CollapseBy")
	}

	return rows, nil
}

// assembleState walks a row iterator emitted by the State SQL query and
// builds a State map by decoding each row's typed value columns into a
// single SignalValue. Used internally by State; exposed at package scope so
// tests can drive it via a fakeRowIterator without spinning up Postgres.
//
// The iterator MUST be the result of a query that selects, in order:
//
//	signal, value_num, value_str, value_bool, value_jsonb, created_at
//
// (matching the SQL in State). created_at is read for completeness but not
// projected into the returned State — the State map's contract is "latest
// per signal", not "latest per (signal, ts)".
func assembleState(rows rowIterator) (State, error) {
	state := make(State)
	for rows.Next() {
		var signal string
		var vNum *float64
		var vStr *string
		var vBool *bool
		var vJsonb []byte
		var createdAt time.Time
		if err := rows.Scan(&signal, &vNum, &vStr, &vBool, &vJsonb, &createdAt); err != nil {
			return nil, fmt.Errorf("scan signal_log row: %w", err)
		}
		state[signal] = decodeSignalLogRow(vNum, vStr, vBool, vJsonb)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate signal_log rows: %w", err)
	}
	return state, nil
}

// decodeSignalLogRow applies the canonical priority for multi-typed signal
// values stored across signal_log's four typed columns:
//
//	value_num (float64) → value_bool (bool) → value_jsonb (any) → value_str (string).
//
// Returns nil when every column is NULL. Malformed JSONB falls through to
// value_str so a corrupt JSONB blob never silently drops a value that
// another column captured correctly.
//
// Named decodeSignalLogRow (not decodeSignalValue) to avoid collision with
// the Redis-envelope decoder of the same conceptual purpose in redis_cache.go,
// which operates on the L2 cache's string-encoded payload format.
func decodeSignalLogRow(vNum *float64, vStr *string, vBool *bool, vJsonb []byte) SignalValue {
	if vNum != nil {
		return *vNum
	}
	if vBool != nil {
		return *vBool
	}
	if len(vJsonb) > 0 {
		var v any
		if err := json.Unmarshal(vJsonb, &v); err == nil {
			return v
		}
		// Malformed JSONB falls through to value_str on purpose.
	}
	if vStr != nil {
		return *vStr
	}
	return nil
}

// unpackLocationCompounds flattens historical Location compound blobs
// (stored as JSONB {Lat, Lng}) into top-level Latitude/Longitude keys,
// removing the original Location key so callers see a flat lat/lng pair
// regardless of the compound shape used at write time. Returns the same map
// for chaining; if Location is absent or not a map[string]any, returns the
// input unchanged.
func unpackLocationCompounds(s State) State {
	raw, ok := s["Location"]
	if !ok {
		return s
	}
	locMap, ok := raw.(map[string]any)
	if !ok {
		return s
	}
	if lat, ok := locMap["Lat"]; ok {
		s["Latitude"] = lat
	}
	if lng, ok := locMap["Lng"]; ok {
		s["Longitude"] = lng
	}
	delete(s, "Location")
	return s
}
