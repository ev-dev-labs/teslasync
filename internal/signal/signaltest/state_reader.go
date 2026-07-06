package signaltest

import (
	"context"
	"reflect"
	"sort"
	"sync"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// FakeStateReader is a mutex-safe, in-memory implementation of
// signal.StateReader for cold-path handler tests. It stands in for the
// signal_log-backed reference reader so a test can exercise a handler's
// "value as of a point in time" and history/timeline code paths without a
// TimescaleDB fixture.
//
// # Fidelity and simplifications
//
// The reference StateReader forward-folds the signal_log change feed and
// honors the `at` argument ("latest emission at-or-before at"). This fake
// instead returns the snapshot configured via SetState / SetStateMany
// REGARDLESS of `at`, and records the `at` it was called with (see LastStateAt
// / LastSignalAt) so tests can still assert the handler passed the timestamp
// they expect. Timeline honors the half-open [from, to) window, projects to
// the requested Field names, and applies opts.CollapseBy list-mode collapsing,
// matching the documented StateReader semantics closely enough for handler
// tests.
//
// FakeStateReader is safe for concurrent use by multiple goroutines, per the
// StateReader concurrency contract documented on signal.StateReader.
type FakeStateReader struct {
	mu sync.RWMutex

	// state is the per-vehicle latest snapshot returned by State/SignalAt.
	state map[int64]signal.State
	// timeline is the per-vehicle ordered row set returned by Timeline.
	timeline map[int64][]signal.TimelineRow
	// err, when non-nil, is returned by every method to exercise
	// transport/query-failure branches.
	err error

	// Captured call metadata for assertions.
	lastStateAt        time.Time
	lastSignalAt       time.Time
	timelineCalls      int
	lastTimelineFields []signal.FieldMapping
	lastTimelineOpts   signal.TimelineOptions
	lastTimelineFrom   time.Time
	lastTimelineTo     time.Time
}

// NewFakeStateReader returns an empty fake.
func NewFakeStateReader() *FakeStateReader {
	return &FakeStateReader{
		state:    make(map[int64]signal.State),
		timeline: make(map[int64][]signal.TimelineRow),
	}
}

// SetState stores a single signal value in vehicleID's snapshot. Pass
// value=nil to delete the key.
func (f *FakeStateReader) SetState(vehicleID int64, name string, value signal.SignalValue) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.state[vehicleID] == nil {
		f.state[vehicleID] = signal.State{}
	}
	if value == nil {
		delete(f.state[vehicleID], name)
		return
	}
	f.state[vehicleID][name] = value
}

// SetStateMany stores multiple signal values in vehicleID's snapshot in one
// call. A nil value deletes that key.
func (f *FakeStateReader) SetStateMany(vehicleID int64, signals map[string]signal.SignalValue) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.state[vehicleID] == nil {
		f.state[vehicleID] = signal.State{}
	}
	for k, v := range signals {
		if v == nil {
			delete(f.state[vehicleID], k)
			continue
		}
		f.state[vehicleID][k] = v
	}
}

// SetTimeline stores the ordered rows returned by Timeline for vehicleID. The
// rows are copied defensively so the caller may mutate the argument afterwards
// without affecting the fake.
func (f *FakeStateReader) SetTimeline(vehicleID int64, rows []signal.TimelineRow) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.timeline[vehicleID] = cloneTimelineRows(rows)
}

// SetError causes every subsequent State / SignalAt / Timeline call to return
// err. Pass nil to clear.
func (f *FakeStateReader) SetError(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.err = err
}

// Reset clears all configured state, timeline rows, error, and captured call
// metadata.
func (f *FakeStateReader) Reset() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.state = make(map[int64]signal.State)
	f.timeline = make(map[int64][]signal.TimelineRow)
	f.err = nil
	f.lastStateAt = time.Time{}
	f.lastSignalAt = time.Time{}
	f.timelineCalls = 0
	f.lastTimelineFields = nil
	f.lastTimelineOpts = signal.TimelineOptions{}
	f.lastTimelineFrom = time.Time{}
	f.lastTimelineTo = time.Time{}
}

// State returns a caller-owned copy of vehicleID's configured snapshot. The
// returned map is never nil on success. The `at` argument is recorded (see
// LastStateAt) but does not filter the result — see the type doc's fidelity
// note.
func (f *FakeStateReader) State(_ context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastStateAt = at
	if f.err != nil {
		return nil, f.err
	}
	out := signal.State{}
	for k, v := range f.state[vehicleID] {
		out[k] = v
	}
	return out, nil
}

// SignalAt returns vehicleID's configured value for name, or (nil, nil) when
// absent. The `at` argument is recorded (see LastSignalAt) but does not filter
// the result.
func (f *FakeStateReader) SignalAt(_ context.Context, vehicleID int64, name string, at time.Time) (signal.SignalValue, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastSignalAt = at
	if f.err != nil {
		return nil, f.err
	}
	if m, ok := f.state[vehicleID]; ok {
		if v, ok := m[name]; ok {
			return v, nil
		}
	}
	return nil, nil
}

// Timeline returns the configured rows for vehicleID over the half-open
// interval [from, to), projected to the Field names listed in fields (empty =
// all fields), with opts.CollapseBy list-mode collapsing applied. Rows are
// ordered by Timestamp ascending and are caller-owned copies. The call is
// recorded (see TimelineCalls / LastTimelineFields / LastTimelineOptions /
// LastTimelineWindow).
func (f *FakeStateReader) Timeline(_ context.Context, vehicleID int64, fields []signal.FieldMapping, from, to time.Time, opts signal.TimelineOptions) ([]signal.TimelineRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.timelineCalls++
	f.lastTimelineFields = append([]signal.FieldMapping(nil), fields...)
	f.lastTimelineOpts = opts
	f.lastTimelineFrom = from
	f.lastTimelineTo = to
	if f.err != nil {
		return nil, f.err
	}

	rows := cloneTimelineRows(f.timeline[vehicleID])
	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].Timestamp.Before(rows[j].Timestamp)
	})

	// Restrict to the half-open [from, to) window.
	windowed := make([]signal.TimelineRow, 0, len(rows))
	for _, r := range rows {
		if r.Timestamp.Before(from) || !r.Timestamp.Before(to) {
			continue
		}
		windowed = append(windowed, r)
	}
	rows = windowed

	// Project each row to only the requested output field names.
	if len(fields) > 0 {
		keep := make(map[string]struct{}, len(fields))
		for _, fm := range fields {
			keep[fm.Field] = struct{}{}
		}
		for i := range rows {
			projected := make(map[string]signal.SignalValue, len(rows[i].Fields))
			for k, v := range rows[i].Fields {
				if _, ok := keep[k]; ok {
					projected[k] = v
				}
			}
			rows[i].Fields = projected
		}
	}

	// List mode: collapse consecutive rows whose CollapseBy value-tuple is
	// unchanged, keeping the earliest row of each run.
	if len(opts.CollapseBy) > 0 {
		rows = collapseRows(rows, opts.CollapseBy)
	}

	return rows, nil
}

// LastStateAt returns the `at` argument of the most recent State call.
func (f *FakeStateReader) LastStateAt() time.Time {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.lastStateAt
}

// LastSignalAt returns the `at` argument of the most recent SignalAt call.
func (f *FakeStateReader) LastSignalAt() time.Time {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.lastSignalAt
}

// TimelineCalls returns how many times Timeline has been called.
func (f *FakeStateReader) TimelineCalls() int {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.timelineCalls
}

// LastTimelineFields returns a copy of the fields of the most recent Timeline
// call.
func (f *FakeStateReader) LastTimelineFields() []signal.FieldMapping {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return append([]signal.FieldMapping(nil), f.lastTimelineFields...)
}

// LastTimelineOptions returns the opts of the most recent Timeline call.
func (f *FakeStateReader) LastTimelineOptions() signal.TimelineOptions {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.lastTimelineOpts
}

// LastTimelineWindow returns the [from, to) window of the most recent Timeline
// call.
func (f *FakeStateReader) LastTimelineWindow() (from, to time.Time) {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.lastTimelineFrom, f.lastTimelineTo
}

// cloneTimelineRows returns a deep copy of rows so neither the fake's stored
// slice nor a returned result can be mutated through the other.
func cloneTimelineRows(rows []signal.TimelineRow) []signal.TimelineRow {
	if rows == nil {
		return nil
	}
	out := make([]signal.TimelineRow, len(rows))
	for i, r := range rows {
		out[i] = signal.TimelineRow{Timestamp: r.Timestamp}
		if r.Fields != nil {
			fields := make(map[string]signal.SignalValue, len(r.Fields))
			for k, v := range r.Fields {
				fields[k] = v
			}
			out[i].Fields = fields
		}
	}
	return out
}

// collapseRows drops consecutive rows whose values for the collapseBy field
// names are unchanged, keeping the earliest row of each run. A missing field
// is treated as a nil value.
func collapseRows(rows []signal.TimelineRow, collapseBy []string) []signal.TimelineRow {
	if len(rows) == 0 {
		return rows
	}
	out := make([]signal.TimelineRow, 0, len(rows))
	var prev []signal.SignalValue
	for i, r := range rows {
		tuple := make([]signal.SignalValue, len(collapseBy))
		for j, name := range collapseBy {
			if r.Fields != nil {
				tuple[j] = r.Fields[name]
			}
		}
		if i == 0 || !reflect.DeepEqual(prev, tuple) {
			out = append(out, r)
			prev = tuple
		}
	}
	return out
}

// Compile-time conformance check.
var _ signal.StateReader = (*FakeStateReader)(nil)
