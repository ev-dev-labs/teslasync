// Package signal owns state-read semantics over signal_log. See ADR-002.
package signal

import (
	"context"
	"encoding/json"
	"time"
)

// SignalValue is the opaque payload of a single change-feed observation. Tesla
// Fleet Telemetry signals can be numeric, string, boolean, or JSON-structured
// (e.g. per-brick voltage arrays), so the reader cannot type the payload at
// the contract boundary; concrete typing happens at the call site via the
// FieldMapping output schema. See ADR-002.
//
// NOTE: this is distinct from the in-process L1-cache `signal.Value` struct
// declared in store.go, which carries (Raw, Timestamp) for hot-path consumers.
// SignalValue names only the opaque payload — the timestamp lives on
// TimelineRow.Timestamp and is implicit in State / SignalAt return semantics
// ("value as of `at`").
type SignalValue any

// State is the per-vehicle, per-signal latest derived value at a point in time.
// It is the result of forward-folding the signal_log change feed: for each
// signal name present, the value is the most recent emission at-or-before the
// query timestamp. Signals never emitted before the query time carry no map
// entry. See ADR-002.
type State map[string]SignalValue

// FieldMapping maps a Tesla Fleet Telemetry signal name to the output field
// name expected by the caller's JSON shape. For example,
// {Signal: "VehicleSpeed", Field: "speed_mph"} tells Timeline to project the
// VehicleSpeed signal and emit it under key "speed_mph" in TimelineRow.Fields.
//
// The mapping is per-call: callers pass a []FieldMapping to Timeline so the
// reader knows which signals to project and how to name them in the output.
// See ADR-002.
type FieldMapping struct {
	// Signal is the Tesla Fleet Telemetry signal name (e.g. "VehicleSpeed").
	Signal string
	// Field is the output JSON field name (e.g. "speed_mph").
	Field string
}

// TimelineRow is one row in the result of Timeline: a single point in time
// with a flat map of projected fields. The custom MarshalJSON implementation
// flattens the Fields map to top-level JSON keys alongside "ts", preserving
// the legacy handler shape consumed by existing frontend chart components.
// See ADR-002.
type TimelineRow struct {
	// Timestamp is the change-feed emission time. This is authoritative; if
	// Fields contains a colliding key "ts" it is dropped during JSON marshaling.
	Timestamp time.Time
	// Fields maps output field name (per FieldMapping.Field) to the value
	// observed at Timestamp.
	Fields map[string]SignalValue
}

// MarshalJSON flattens TimelineRow to the legacy JSON shape:
//
//	{"ts": "<RFC3339Nano>", "<field1>": <value1>, "<field2>": <value2>, ...}
//
// The "ts" key from Fields (if any) is dropped: TimelineRow.Timestamp is the
// authoritative emission time. Existing frontend chart components consume
// this flat shape, so changing it would be a frontend-breaking change.
// See ADR-002.
func (r TimelineRow) MarshalJSON() ([]byte, error) {
	out := make(map[string]any, len(r.Fields)+1)
	for k, v := range r.Fields {
		if k == "ts" {
			// Authoritative timestamp wins; drop any colliding Fields entry.
			continue
		}
		out[k] = v
	}
	out["ts"] = r.Timestamp
	return json.Marshal(out)
}

// TimelineOptions controls how Timeline collapses consecutive identical rows.
//
// Empty CollapseBy means CHART MODE: every change-feed emission becomes one
// row, even if the projected fields are identical to the previous row. This
// is what stepped-line / time-series chart components expect. See ADR-002.
//
// Non-empty CollapseBy means LIST MODE: consecutive rows whose values for
// the listed Field names (per FieldMapping.Field) are equal are collapsed
// to a single row (the earliest of the run is kept). This is what tabular
// history views expect when you do not want to render duplicate
// "still on D, still 65 mph" rows.
type TimelineOptions struct {
	// CollapseBy lists output Field names whose value-tuple identifies a
	// distinct row in list mode. Empty = chart mode (no collapsing).
	CollapseBy []string
	// MaxRows caps rows returned after collapse. Zero means unlimited.
	// The cap keeps the oldest prefix of the window; callers that need
	// the newest data must choose a window that fits.
	MaxRows int
}

// StateReader is the canonical state-read interface for cold-path callers
// (HTTP handlers, the cmd/teslasync/main.go warmup path, chatbot/RAG state
// lookups). It derives state from the signal_log change feed by
// forward-folding emissions. See ADR-002.
//
// # Trusted-caller contract
//
// StateReader does NOT enforce per-vehicle authorization. The caller —
// HTTP middleware (Authentik ForwardAuth + vehicle-scoped routing in
// internal/api/router.go) or the application identity during warmup — owns
// the decision of whether the requesting principal may read vehicleID.
// Implementations enforce ONLY the correctness of the change-feed → state
// derivation, never who is allowed to ask. Any future cross-tenant
// deployment MUST add an authorization layer in front of this interface,
// not inside implementations.
//
// # Concurrency contract
//
// Implementations MUST be safe for concurrent use by multiple goroutines.
// The reference signal.LogStateReader implementation satisfies this via a
// shared *pgxpool.Pool, which is itself concurrency-safe. Test
// fakes — including any future shared signaltest package — MUST also be
// concurrency-safe.
//
// # Hot-path contract
//
// StateReader is COLD-PATH ONLY. Telemetry ingest, FSM/reconciliation, and
// session boundary detection MUST continue to read from the in-process
// signal.Store (L1) and Redis HSET (L2) per ADR-007. Wiring StateReader
// into the hot path couples every signal write to a synchronous DB read
// and defeats the L1/L2 cache architecture.
type StateReader interface {
	// State returns the latest value of every signal emitted at-or-before `at`
	// for vehicleID, derived by forward-folding signal_log. Signals never
	// emitted before `at` carry no map entry. The returned map is owned by
	// the caller and safe to mutate. See ADR-002.
	State(ctx context.Context, vehicleID int64, at time.Time) (State, error)

	// SignalAt returns the latest value of `signal` at-or-before `at` for
	// vehicleID. Returns (nil, nil) when the signal has never been emitted
	// before `at`; returns a non-nil error only on transport / query failure.
	// See ADR-002.
	SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (SignalValue, error)

	// Timeline returns ordered TimelineRows over the half-open interval
	// [from, to) for vehicleID, projecting only the signals listed in
	// `fields`. Rows are ordered by Timestamp ascending. The semantics of
	// opts.CollapseBy are documented on TimelineOptions: empty = chart mode
	// (one row per emission), non-empty = list mode (collapse consecutive
	// duplicates of the listed field tuple). See ADR-002.
	Timeline(ctx context.Context, vehicleID int64, fields []FieldMapping, from, to time.Time, opts TimelineOptions) ([]TimelineRow, error)
}
