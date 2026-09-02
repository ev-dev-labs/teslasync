// Package signal owns state-read semantics over signal_log. See ADR-002.
//
// pivot.go is the DB-agnostic core of the forward-fold algorithm consumed by
// the signal_log-backed StateReader implementation. Splitting the
// algorithm out of the SQL impl keeps it unit-testable without a live
// TimescaleDB instance: callers feed in a seed map plus a time-ordered slice
// of (ts, signal, value) tuples, and the helpers return the projected
// TimelineRow slice expected by Timeline.
//
// Typed-primitive contract: values flowing into forwardFold are the
// typed primitives produced by the Tesla codec (codec.Atomic.Value: float64,
// float32, int32, int64, bool, string, time.Time, etc.) and persisted by the
// SI-canonical signal_log row decoder. pivot.go does NO string parsing and
// NO compound flattening — the codec emits already-flattened atomic names
// (e.g. "LocationLatitude", "DoorStateDriverFront", "TpmsHardWarningsFrontLeft")
// with already-typed values. Compound expansion of historical Location blobs
// (legacy JSONB rows) is the responsibility of state_reader_log.go's
// unpackLocationCompounds helper, NOT this file. See ADR-004 §2.
package signal

import (
	"fmt"
	"strings"
	"time"
)

// rawEvent is the internal change-feed shape consumed by forwardFold. It is
// the trivially decoded form of a single signal_log row: the emission
// timestamp, the Tesla Fleet Telemetry signal name, and the opaque payload
// value. Pivot helpers never round-trip through SQL types, so this struct is
// the entire algorithm boundary.
//
// rawEvent is unexported because it is purely an internal handoff between
// the SQL implementation and the pivot helpers. Public callers go through
// the StateReader interface.
type rawEvent struct {
	// Ts is the change-feed emission time. Callers MUST sort events by Ts
	// ascending before invoking forwardFold.
	Ts time.Time
	// Signal is the Tesla Fleet Telemetry signal name (e.g. "VehicleSpeed").
	// The codec emits already-flattened atomic names
	// (e.g. "LocationLatitude", "DoorStateDriverFront",
	// "TpmsHardWarningsFrontLeft") rather than parent compound names —
	// pivot does not split or rejoin these.
	Signal string
	// Value is the opaque payload observed at Ts. This is a
	// typed primitive emitted by the codec: float64/float32, int32/int64,
	// bool, string, or time.Time, plus JSON-decoded slices/maps for the
	// few signals that are still structured at the wire. forwardFold treats
	// it as opaque (any) — equality, marshaling, and downstream coercion
	// happen at the call site.
	//
	// May be nil when the upstream change feed records an explicit "no value"
	// emission, in which case the projected field for any mapping pointing
	// at this signal will be nil for this row and any subsequent
	// carry-forward row.
	Value SignalValue
}

// forwardFold derives a slice of TimelineRow from a seed state plus a
// time-ordered slice of change-feed events.
//
// Inputs:
//
//   - seed: the per-signal latest value at-or-before the first event's
//     timestamp, typically supplied by a StateReader.State call at `from`.
//     A nil or empty map is permitted; in that case rows where every
//     projected field is nil at the head of the result are dropped (see
//     "leading all-nil drop" below). The seed map is NOT mutated; an
//     internal copy is taken.
//   - events: change-feed observations in the half-open interval the caller
//     queried. MUST be sorted ascending by Ts. Multiple events at the
//     exact same Ts are merged into a single output row.
//   - mappings: the projection schema. The output TimelineRow.Fields map
//     contains exactly one entry per mapping, keyed by mapping.Field, with
//     value = the running state's value for mapping.Signal (nil if the
//     signal has never been emitted and is not in the seed).
//   - from, to: advisory window bounds. forwardFold does NOT filter events
//     by these bounds; the caller has already restricted the SQL query.
//     They are accepted in the signature so future debug logging or
//     window-aware behavior can be added without changing the signature.
//
// Output semantics:
//
//   - Returns a non-nil slice (possibly empty) of TimelineRow, ordered by
//     Timestamp ascending.
//   - Each row's Fields map contains every mapping.Field key, with value
//     pulled from the running state via mapping.Signal. Missing signals
//     surface as nil values, NOT as missing keys, so downstream marshaling
//     produces a stable JSON shape.
//   - LEADING all-nil rows are dropped: while the running state has produced
//     no non-nil projection for any mapping, rows are skipped. Once any row
//     yields at least one non-nil field, all subsequent rows are kept,
//     including any that happen to be entirely nil after that point. This
//     matches the chart-mode contract: nothing to show before the first
//     real datapoint, but explicit "value cleared to nil" emissions after
//     that are real datapoints worth showing.
//
// Concurrency: forwardFold is pure; safe to call concurrently provided the
// caller does not mutate the input slices/maps during the call.
func forwardFold(seed map[string]SignalValue, events []rawEvent, mappings []FieldMapping, from, to time.Time) []TimelineRow {
	_ = from
	_ = to
	folder := newTimelineFolder(seed, mappings, nil, 0)
	for i := range events {
		if !folder.Add(events[i]) {
			break
		}
	}
	return folder.Finish()
}

// timelineFolder forward-folds one event at a time and optionally collapses
// consecutive list-mode keys. Callers must not buffer the whole window.
type timelineFolder struct {
	mappings   []FieldMapping
	collapseBy []string
	maxRows    int
	state      map[string]SignalValue
	groupTs    time.Time
	grouping   bool
	leadingNil bool
	hasPrev    bool
	prevKey    string
	rows       []TimelineRow
	truncated  bool
	events     int
}

func newTimelineFolder(seed map[string]SignalValue, mappings []FieldMapping, collapseBy []string, maxRows int) *timelineFolder {
	state := make(map[string]SignalValue, len(seed)+len(mappings))
	for k, v := range seed {
		state[k] = v
	}
	return &timelineFolder{
		mappings:   mappings,
		collapseBy: collapseBy,
		maxRows:    maxRows,
		state:      state,
		leadingNil: true,
	}
}

func (f *timelineFolder) Add(ev rawEvent) bool {
	if f.truncated {
		return false
	}
	f.events++
	if f.grouping && !ev.Ts.Equal(f.groupTs) {
		if !f.flush() {
			return false
		}
	}
	f.state[ev.Signal] = ev.Value
	f.groupTs = ev.Ts
	f.grouping = true
	return true
}

func (f *timelineFolder) Finish() []TimelineRow {
	if f.grouping && !f.truncated {
		_ = f.flush()
	}
	if f.rows == nil {
		return []TimelineRow{}
	}
	return f.rows
}

func (f *timelineFolder) flush() bool {
	fields := make(map[string]SignalValue, len(f.mappings))
	anyNonNil := false
	for _, m := range f.mappings {
		v, ok := f.state[m.Signal]
		if ok && v != nil {
			fields[m.Field] = v
			anyNonNil = true
		} else {
			fields[m.Field] = nil
		}
	}
	if f.leadingNil && !anyNonNil {
		return true
	}
	f.leadingNil = false
	row := TimelineRow{Timestamp: f.groupTs, Fields: fields}
	if len(f.collapseBy) > 0 {
		key := projectCollapseKey(row, f.collapseBy)
		if f.hasPrev && key == f.prevKey {
			return true
		}
		f.prevKey = key
		f.hasPrev = true
	}
	if f.maxRows > 0 && len(f.rows) >= f.maxRows {
		f.truncated = true
		return false
	}
	f.rows = append(f.rows, row)
	return true
}

// collapseTimeline implements the list-mode collapse step described in
// TimelineOptions: when collapseFields is non-empty, consecutive rows whose
// projection over collapseFields is equal are collapsed into the earliest
// row of the run.
//
// Behavior:
//
//   - If collapseFields is empty or nil, rows is returned unchanged. This is
//     the chart-mode short-circuit: every change-feed emission survives.
//   - Otherwise the helper walks rows in order, comparing each row's
//     collapseFields projection against the previous KEPT row's projection.
//     Equal projections drop the new row; unequal projections keep it and
//     update the comparison anchor.
//   - The first row is ALWAYS kept, even if its projection is entirely nil.
//     The collapse contract is "deduplicate consecutive duplicates"; a
//     timeline of one row has no duplicates by definition.
//   - nil values compare equal to nil; nil compares unequal to any non-nil
//     value. The comparison key is built via fmt.Sprintf("%#v", v) per
//     field, joined with a NUL separator that cannot appear in a Go
//     %#v rendering, so two distinct value tuples cannot collide on key.
//
// Concurrency: collapseTimeline is pure; safe to call concurrently provided
// the caller does not mutate the input slice during the call.
func collapseTimeline(rows []TimelineRow, collapseFields []string) []TimelineRow {
	if len(collapseFields) == 0 {
		return rows
	}

	out := make([]TimelineRow, 0, len(rows))
	var prevKey string
	hasPrev := false
	for _, r := range rows {
		key := projectCollapseKey(r, collapseFields)
		if !hasPrev || key != prevKey {
			out = append(out, r)
			prevKey = key
			hasPrev = true
		}
	}
	return out
}

// projectCollapseKey renders the row's value-tuple under collapseFields as a
// single comparable string. Missing fields and explicit nil values render
// identically (as Go's %#v of a nil any), so they collapse together. The NUL
// separator is safe because %#v never emits NUL bytes for the value types we
// see in signal payloads (numbers, strings, bools, JSON-decoded maps/slices).
func projectCollapseKey(r TimelineRow, fields []string) string {
	parts := make([]string, len(fields))
	for i, f := range fields {
		v, ok := r.Fields[f]
		if !ok {
			v = nil
		}
		parts[i] = fmt.Sprintf("%#v", v)
	}
	return strings.Join(parts, "\x00")
}
