package signal

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// fakeRow is the in-memory analogue of a single signal_log row, holding the
// typed value columns directly so tests can construct rows without going
// through Postgres. Helper constructors below build common shapes.
type fakeRow struct {
	signal    string
	vNum      *float64
	vStr      *string
	vBool     *bool
	vJsonb    []byte
	createdAt time.Time
}

// fakeRowIterator implements the unexported rowIterator interface so tests
// can drive assembleState directly. Tracks the current cursor position via
// pos (1-indexed: Next advances pos, Scan reads rows[pos-1]).
type fakeRowIterator struct {
	rows   []fakeRow
	pos    int
	err    error
	closed bool
}

func (f *fakeRowIterator) Next() bool {
	if f.pos >= len(f.rows) {
		return false
	}
	f.pos++
	return true
}

func (f *fakeRowIterator) Scan(dest ...any) error {
	if f.pos == 0 || f.pos > len(f.rows) {
		return errors.New("fakeRowIterator: Scan called out of order")
	}
	if len(dest) != 6 {
		return fmt.Errorf("fakeRowIterator: expected 6 destinations, got %d", len(dest))
	}
	row := f.rows[f.pos-1]
	*(dest[0].(*string)) = row.signal
	*(dest[1].(**float64)) = row.vNum
	*(dest[2].(**string)) = row.vStr
	*(dest[3].(**bool)) = row.vBool
	*(dest[4].(*[]byte)) = row.vJsonb
	*(dest[5].(*time.Time)) = row.createdAt
	return nil
}

func (f *fakeRowIterator) Err() error { return f.err }
func (f *fakeRowIterator) Close()     { f.closed = true }

// emptyPgxRows is a minimal pgx.Rows implementation used by fakeQuerier when
// it needs to simulate a successful Query that returns zero rows. Most
// methods return zero values; only Next/Close/Err are exercised by State.
type emptyPgxRows struct{}

func (emptyPgxRows) Close()                                       {}
func (emptyPgxRows) Err() error                                   { return nil }
func (emptyPgxRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (emptyPgxRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (emptyPgxRows) Next() bool                                   { return false }
func (emptyPgxRows) Scan(dest ...any) error                       { return nil }
func (emptyPgxRows) Values() ([]any, error)                       { return nil, nil }
func (emptyPgxRows) RawValues() [][]byte                          { return nil }
func (emptyPgxRows) Conn() *pgx.Conn                              { return nil }

// signalAtPgxRows is a single-row pgx.Rows for the SignalAt 4-column query
// (value_num, value_str, value_bool, value_jsonb). hasRow=false simulates
// "signal never emitted before at"; scanErr forces Scan to fail without
// touching the destinations, exercising the SignalAt scan-error branch.
type signalAtPgxRows struct {
	hasRow    bool
	delivered bool
	vNum      *float64
	vStr      *string
	vBool     *bool
	vJsonb    []byte
	scanErr   error
}

func (s *signalAtPgxRows) Close()                                       {}
func (s *signalAtPgxRows) Err() error                                   { return nil }
func (s *signalAtPgxRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (s *signalAtPgxRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (s *signalAtPgxRows) Next() bool {
	if !s.hasRow || s.delivered {
		return false
	}
	s.delivered = true
	return true
}
func (s *signalAtPgxRows) Scan(dest ...any) error {
	if s.scanErr != nil {
		return s.scanErr
	}
	if len(dest) != 4 {
		return fmt.Errorf("signalAtPgxRows: expected 4 destinations, got %d", len(dest))
	}
	*(dest[0].(**float64)) = s.vNum
	*(dest[1].(**string)) = s.vStr
	*(dest[2].(**bool)) = s.vBool
	*(dest[3].(*[]byte)) = s.vJsonb
	return nil
}
func (s *signalAtPgxRows) Values() ([]any, error) { return nil, nil }
func (s *signalAtPgxRows) RawValues() [][]byte    { return nil }
func (s *signalAtPgxRows) Conn() *pgx.Conn        { return nil }

// fakeQuerier implements the unexported pgxQuerier interface for tests that
// need to drive the LogStateReader.State end-to-end (context cancel, slow
// query, error logging). The calls counter lets tests assert that Query was
// (or was not) invoked.
type fakeQuerier struct {
	err   error
	rows  pgx.Rows
	sleep time.Duration
	calls atomic.Int64
}

func (f *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.calls.Add(1)
	if f.sleep > 0 {
		time.Sleep(f.sleep)
	}
	if f.err != nil {
		return nil, f.err
	}
	if f.rows != nil {
		return f.rows, nil
	}
	return emptyPgxRows{}, nil
}

// --- unpackLocationCompounds tests ---------------------------------------

func TestUnpackLocationCompounds_FlattensWhenPresent(t *testing.T) {
	in := State{"Location": map[string]any{"Lat": 12.3, "Lng": 45.6}}
	got := unpackLocationCompounds(in)
	if got["Latitude"] != 12.3 {
		t.Fatalf("Latitude: want 12.3, got %v", got["Latitude"])
	}
	if got["Longitude"] != 45.6 {
		t.Fatalf("Longitude: want 45.6, got %v", got["Longitude"])
	}
	if _, exists := got["Location"]; exists {
		t.Fatalf("Location key must be removed after flatten")
	}
}

func TestUnpackLocationCompounds_NoOpWhenAbsent(t *testing.T) {
	in := State{"Speed": 50.0}
	got := unpackLocationCompounds(in)
	if len(got) != 1 {
		t.Fatalf("map size: want 1, got %d", len(got))
	}
	if got["Speed"] != 50.0 {
		t.Fatalf("Speed: want 50.0, got %v", got["Speed"])
	}
}

func TestUnpackLocationCompounds_NoOpWhenWrongType(t *testing.T) {
	in := State{"Location": "oops"}
	got := unpackLocationCompounds(in)
	if got["Location"] != "oops" {
		t.Fatalf("Location should remain unchanged when not a map, got %v", got["Location"])
	}
	if _, exists := got["Latitude"]; exists {
		t.Fatalf("Latitude must not be set when Location is wrong type")
	}
	if _, exists := got["Longitude"]; exists {
		t.Fatalf("Longitude must not be set when Location is wrong type")
	}
}

// --- interface conformance -----------------------------------------------

func TestNewLogStateReader_SatisfiesInterface(t *testing.T) {
	// Compile-time assertion: NewLogStateReader's return value must satisfy
	// the StateReader interface declared in state_reader.go.
	var _ StateReader = NewLogStateReader(nil, zerolog.Nop())
}

// --- State() end-to-end tests --------------------------------------------

func TestLogStateReader_State_PropagatesContextCancel(t *testing.T) {
	q := &fakeQuerier{err: context.Canceled}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	at := time.Date(2026, 4, 30, 12, 34, 56, 0, time.UTC)
	_, err := r.State(context.Background(), 42, at)
	if err == nil {
		t.Fatal("want error from cancelled query")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want wrapped context.Canceled, got %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "vehicle 42") {
		t.Fatalf("want vehicle id in error, got %q", msg)
	}
	if !strings.Contains(msg, at.Format(time.RFC3339)) {
		t.Fatalf("want RFC3339-formatted at in error, got %q", msg)
	}
}

func TestLogStateReader_State_BuildsMapFromRows(t *testing.T) {
	speed := 50.0
	soc := 80.0
	now := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	iter := &fakeRowIterator{
		rows: []fakeRow{
			{signal: "Speed", vNum: &speed, createdAt: now},
			{signal: "Soc", vNum: &soc, createdAt: now},
		},
	}

	state, err := assembleState(iter)
	if err != nil {
		t.Fatalf("assembleState: %v", err)
	}
	if got := state["Speed"]; got != 50.0 {
		t.Fatalf("Speed: want 50.0, got %v", got)
	}
	if got := state["Soc"]; got != 80.0 {
		t.Fatalf("Soc: want 80.0, got %v", got)
	}
	if !iter.closed && false {
		// Close is called by State (not assembleState) — skip the check here.
	}
}

func TestLogStateReader_State_FlattensLocation(t *testing.T) {
	locBytes, err := json.Marshal(map[string]any{"Lat": 1.0, "Lng": 2.0})
	if err != nil {
		t.Fatalf("marshal location: %v", err)
	}
	now := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	iter := &fakeRowIterator{
		rows: []fakeRow{
			{signal: "Location", vJsonb: locBytes, createdAt: now},
		},
	}

	raw, err := assembleState(iter)
	if err != nil {
		t.Fatalf("assembleState: %v", err)
	}
	state := unpackLocationCompounds(raw)
	if state["Latitude"] != 1.0 {
		t.Fatalf("Latitude: want 1.0, got %v", state["Latitude"])
	}
	if state["Longitude"] != 2.0 {
		t.Fatalf("Longitude: want 2.0, got %v", state["Longitude"])
	}
	if _, exists := state["Location"]; exists {
		t.Fatalf("Location key must be removed after flatten")
	}
}

func TestLogStateReader_State_RejectsZeroAt(t *testing.T) {
	q := &fakeQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	_, err := r.State(context.Background(), 1, time.Time{})
	if err == nil {
		t.Fatal("want error for zero at")
	}
	if !strings.Contains(err.Error(), "must be non-zero") {
		t.Fatalf("want 'must be non-zero' in error, got %q", err.Error())
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for zero at; got %d calls", got)
	}
}

func TestLogStateReader_State_LogsSlowQuery(t *testing.T) {
	q := &fakeQuerier{sleep: 600 * time.Millisecond, rows: emptyPgxRows{}}
	var buf bytes.Buffer
	r := &LogStateReader{pool: q, log: zerolog.New(&buf)}

	_, err := r.State(context.Background(), 7, time.Now())
	if err != nil {
		t.Fatalf("State: %v", err)
	}
	out := buf.String()
	if !strings.Contains(out, "slow state read") {
		t.Fatalf("want 'slow state read' in log, got %q", out)
	}
	if !strings.Contains(out, `"vehicle_id":7`) {
		t.Fatalf("want vehicle_id field in log, got %q", out)
	}
	if !strings.Contains(out, `"duration"`) {
		t.Fatalf("want duration field in log, got %q", out)
	}
}

func TestLogStateReader_State_LogsErrorBeforeReturn(t *testing.T) {
	q := &fakeQuerier{err: errors.New("db down")}
	var buf bytes.Buffer
	r := &LogStateReader{pool: q, log: zerolog.New(&buf)}

	_, err := r.State(context.Background(), 99, time.Now())
	if err == nil {
		t.Fatal("want error from failing query")
	}
	if !strings.Contains(err.Error(), "db down") {
		t.Fatalf("want wrapped 'db down' in error, got %q", err.Error())
	}
	out := buf.String()
	if !strings.Contains(out, "state read failed") {
		t.Fatalf("want 'state read failed' in log, got %q", out)
	}
	if !strings.Contains(out, `"vehicle_id":99`) {
		t.Fatalf("want vehicle_id field in log, got %q", out)
	}
}

// --- SignalAt() end-to-end tests -----------------------------------------

func TestLogStateReader_SignalAt_ReturnsValueWhenFound(t *testing.T) {
	speed := 50.0
	q := &fakeQuerier{rows: &signalAtPgxRows{hasRow: true, vNum: &speed}}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	v, err := r.SignalAt(context.Background(), 1, "Speed", time.Now())
	if err != nil {
		t.Fatalf("SignalAt: %v", err)
	}
	if v != 50.0 {
		t.Fatalf("value: want 50.0, got %v", v)
	}
}

func TestLogStateReader_SignalAt_ReturnsNilNilWhenNotFound(t *testing.T) {
	q := &fakeQuerier{rows: emptyPgxRows{}}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	v, err := r.SignalAt(context.Background(), 1, "Speed", time.Now())
	if err != nil {
		t.Fatalf("SignalAt: want nil error, got %v", err)
	}
	if v != nil {
		t.Fatalf("value: want nil, got %v", v)
	}
}

func TestLogStateReader_SignalAt_PropagatesContextCancel(t *testing.T) {
	q := &fakeQuerier{err: context.Canceled}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	at := time.Date(2026, 4, 30, 12, 34, 56, 0, time.UTC)
	_, err := r.SignalAt(context.Background(), 42, "Speed", at)
	if err == nil {
		t.Fatal("want error from cancelled query")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want wrapped context.Canceled, got %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "vehicle 42") {
		t.Fatalf("want vehicle id in error, got %q", msg)
	}
	if !strings.Contains(msg, "Speed") {
		t.Fatalf("want signal name in error, got %q", msg)
	}
}

func TestLogStateReader_SignalAt_PropagatesScanError(t *testing.T) {
	q := &fakeQuerier{rows: &signalAtPgxRows{hasRow: true, scanErr: errors.New("scan boom")}}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	_, err := r.SignalAt(context.Background(), 7, "Soc", time.Now())
	if err == nil {
		t.Fatal("want error from scan failure")
	}
	if !strings.Contains(err.Error(), "scan boom") {
		t.Fatalf("want wrapped 'scan boom' in error, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "Soc") {
		t.Fatalf("want signal name in error, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "vehicle 7") {
		t.Fatalf("want vehicle id in error, got %q", err.Error())
	}
}

func TestLogStateReader_SignalAt_RejectsZeroAt(t *testing.T) {
	q := &fakeQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	_, err := r.SignalAt(context.Background(), 1, "Speed", time.Time{})
	if err == nil {
		t.Fatal("want error for zero at")
	}
	if !strings.Contains(err.Error(), "must be non-zero") {
		t.Fatalf("want 'must be non-zero' in error, got %q", err.Error())
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for zero at; got %d calls", got)
	}
}

func TestLogStateReader_SignalAt_RejectsEmptySignal(t *testing.T) {
	q := &fakeQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	_, err := r.SignalAt(context.Background(), 1, "", time.Now())
	if err == nil {
		t.Fatal("want error for empty signal")
	}
	if !strings.Contains(err.Error(), "must not be empty") {
		t.Fatalf("want 'must not be empty' in error, got %q", err.Error())
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for empty signal; got %d calls", got)
	}
}

// --- Timeline() chart mode tests -----------------------------------------

// timelineSeedRow is the in-memory analogue of a single signal_log row
// returned by the seed (DISTINCT ON) query: 5 columns, no created_at.
type timelineSeedRow struct {
	signal string
	vNum   *float64
	vStr   *string
	vBool  *bool
	vJsonb []byte
}

// timelineSeedPgxRows implements the relevant subset of pgx.Rows used by
// LogStateReader.Timeline's seed scan. Only Next/Scan/Err/Close are
// exercised; the rest of pgx.Rows is satisfied with zero-value stubs so
// the type compiles.
type timelineSeedPgxRows struct {
	rows []timelineSeedRow
	pos  int
	err  error
}

func (s *timelineSeedPgxRows) Close()                                       {}
func (s *timelineSeedPgxRows) Err() error                                   { return s.err }
func (s *timelineSeedPgxRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (s *timelineSeedPgxRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (s *timelineSeedPgxRows) Next() bool {
	if s.pos >= len(s.rows) {
		return false
	}
	s.pos++
	return true
}
func (s *timelineSeedPgxRows) Scan(dest ...any) error {
	if s.pos == 0 || s.pos > len(s.rows) {
		return errors.New("timelineSeedPgxRows: Scan called out of order")
	}
	if len(dest) != 5 {
		return fmt.Errorf("timelineSeedPgxRows: expected 5 destinations, got %d", len(dest))
	}
	row := s.rows[s.pos-1]
	*(dest[0].(*string)) = row.signal
	*(dest[1].(**float64)) = row.vNum
	*(dest[2].(**string)) = row.vStr
	*(dest[3].(**bool)) = row.vBool
	*(dest[4].(*[]byte)) = row.vJsonb
	return nil
}
func (s *timelineSeedPgxRows) Values() ([]any, error) { return nil, nil }
func (s *timelineSeedPgxRows) RawValues() [][]byte    { return nil }
func (s *timelineSeedPgxRows) Conn() *pgx.Conn        { return nil }

// timelineWindowRow is the in-memory analogue of one signal_log row
// returned by the window query: 6 columns including created_at first.
type timelineWindowRow struct {
	createdAt time.Time
	signal    string
	vNum      *float64
	vStr      *string
	vBool     *bool
	vJsonb    []byte
}

// timelineWindowPgxRows is the window-query counterpart to
// timelineSeedPgxRows. Same minimal pgx.Rows surface.
type timelineWindowPgxRows struct {
	rows []timelineWindowRow
	pos  int
	err  error
}

func (w *timelineWindowPgxRows) Close()                                       {}
func (w *timelineWindowPgxRows) Err() error                                   { return w.err }
func (w *timelineWindowPgxRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (w *timelineWindowPgxRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (w *timelineWindowPgxRows) Next() bool {
	if w.pos >= len(w.rows) {
		return false
	}
	w.pos++
	return true
}
func (w *timelineWindowPgxRows) Scan(dest ...any) error {
	if w.pos == 0 || w.pos > len(w.rows) {
		return errors.New("timelineWindowPgxRows: Scan called out of order")
	}
	if len(dest) != 6 {
		return fmt.Errorf("timelineWindowPgxRows: expected 6 destinations, got %d", len(dest))
	}
	row := w.rows[w.pos-1]
	*(dest[0].(*time.Time)) = row.createdAt
	*(dest[1].(*string)) = row.signal
	*(dest[2].(**float64)) = row.vNum
	*(dest[3].(**string)) = row.vStr
	*(dest[4].(**bool)) = row.vBool
	*(dest[5].(*[]byte)) = row.vJsonb
	return nil
}
func (w *timelineWindowPgxRows) Values() ([]any, error) { return nil, nil }
func (w *timelineWindowPgxRows) RawValues() [][]byte    { return nil }
func (w *timelineWindowPgxRows) Conn() *pgx.Conn        { return nil }

// timelineQuerier dispatches Query calls to a seed or window response
// based on whether the SQL contains "DISTINCT ON" (the unique seed-query
// marker). The atomic counter lets tests assert exactly N queries
// executed (e.g. the No-N+1 invariant).
type timelineQuerier struct {
	seedRows   pgx.Rows
	windowRows pgx.Rows
	seedErr    error
	windowErr  error
	calls      atomic.Int64
}

func (t *timelineQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	t.calls.Add(1)
	if strings.Contains(sql, "DISTINCT ON") {
		if t.seedErr != nil {
			return nil, t.seedErr
		}
		if t.seedRows != nil {
			return t.seedRows, nil
		}
		return emptyPgxRows{}, nil
	}
	if t.windowErr != nil {
		return nil, t.windowErr
	}
	if t.windowRows != nil {
		return t.windowRows, nil
	}
	return emptyPgxRows{}, nil
}

func ptrFloat64(v float64) *float64 { return &v }
func ptrString(v string) *string    { return &v }

// validWindow returns a (from, to) pair safely inside the 366-day guard
// so happy-path tests do not have to spell out time literals.
func validWindow() (time.Time, time.Time) {
	from := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	return from, from.Add(time.Hour)
}

func TestLogStateReader_Timeline_ChartMode_EmptyMappings(t *testing.T) {
	q := &timelineQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	rows, err := r.Timeline(context.Background(), 1, nil, from, to, TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline: want nil error, got %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows: want 0, got %d", len(rows))
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for empty mappings; got %d calls", got)
	}

	// Same expectation for an explicit zero-length slice.
	rows, err = r.Timeline(context.Background(), 1, []FieldMapping{}, from, to, TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline (empty slice): want nil error, got %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows (empty slice): want 0, got %d", len(rows))
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for empty slice mappings; got %d calls", got)
	}
}

func TestLogStateReader_Timeline_ChartMode_SeedOnly_NoEvents(t *testing.T) {
	q := &timelineQuerier{
		seedRows:   &timelineSeedPgxRows{rows: []timelineSeedRow{{signal: "Speed", vNum: ptrFloat64(50)}}},
		windowRows: emptyPgxRows{},
	}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	rows, err := r.Timeline(context.Background(), 1, []FieldMapping{{Signal: "Speed", Field: "speed"}}, from, to, TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows: want 0 (no events = no timestamps), got %d (%+v)", len(rows), rows)
	}
	if got := q.calls.Load(); got != 2 {
		t.Fatalf("calls: want 2 (seed + window), got %d", got)
	}
}

func TestLogStateReader_Timeline_ChartMode_SingleEvent(t *testing.T) {
	t1 := time.Date(2026, 4, 30, 12, 30, 0, 0, time.UTC)
	q := &timelineQuerier{
		windowRows: &timelineWindowPgxRows{rows: []timelineWindowRow{
			{createdAt: t1, signal: "Speed", vNum: ptrFloat64(50)},
		}},
	}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	rows, err := r.Timeline(context.Background(), 1, []FieldMapping{{Signal: "Speed", Field: "speed"}}, from, to, TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows: want 1, got %d (%+v)", len(rows), rows)
	}
	if !rows[0].Timestamp.Equal(t1) {
		t.Fatalf("ts: want %v, got %v", t1, rows[0].Timestamp)
	}
	if rows[0].Fields["speed"] != 50.0 {
		t.Fatalf("speed: want 50.0, got %v", rows[0].Fields["speed"])
	}
}

func TestLogStateReader_Timeline_ChartMode_CarryForward(t *testing.T) {
	t1 := time.Date(2026, 4, 30, 12, 30, 0, 0, time.UTC)
	q := &timelineQuerier{
		seedRows: &timelineSeedPgxRows{rows: []timelineSeedRow{
			{signal: "Soc", vNum: ptrFloat64(80)},
		}},
		windowRows: &timelineWindowPgxRows{rows: []timelineWindowRow{
			{createdAt: t1, signal: "Speed", vNum: ptrFloat64(50)},
		}},
	}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	mappings := []FieldMapping{
		{Signal: "Speed", Field: "speed"},
		{Signal: "Soc", Field: "soc"},
	}
	rows, err := r.Timeline(context.Background(), 1, mappings, from, to, TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows: want 1, got %d (%+v)", len(rows), rows)
	}
	if rows[0].Fields["speed"] != 50.0 {
		t.Fatalf("speed: want 50.0, got %v", rows[0].Fields["speed"])
	}
	if rows[0].Fields["soc"] != 80.0 {
		t.Fatalf("soc: want 80.0 (carried from seed), got %v", rows[0].Fields["soc"])
	}
}

func TestLogStateReader_Timeline_ChartMode_MergeSameTimestamp(t *testing.T) {
	t1 := time.Date(2026, 4, 30, 12, 30, 0, 0, time.UTC)
	q := &timelineQuerier{
		windowRows: &timelineWindowPgxRows{rows: []timelineWindowRow{
			{createdAt: t1, signal: "Speed", vNum: ptrFloat64(50)},
			{createdAt: t1, signal: "Soc", vNum: ptrFloat64(80)},
		}},
	}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	mappings := []FieldMapping{
		{Signal: "Speed", Field: "speed"},
		{Signal: "Soc", Field: "soc"},
	}
	rows, err := r.Timeline(context.Background(), 1, mappings, from, to, TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows: want 1 (merged on same ts), got %d (%+v)", len(rows), rows)
	}
	if rows[0].Fields["speed"] != 50.0 {
		t.Fatalf("speed: want 50.0, got %v", rows[0].Fields["speed"])
	}
	if rows[0].Fields["soc"] != 80.0 {
		t.Fatalf("soc: want 80.0, got %v", rows[0].Fields["soc"])
	}
}

func TestLogStateReader_Timeline_ChartMode_DropsLeadingNilRows(t *testing.T) {
	t1 := time.Date(2026, 4, 30, 12, 30, 0, 0, time.UTC)
	t2 := t1.Add(time.Minute)
	// Empty seed + first window event is an explicit nil emission for
	// the only mapped signal → the t1 row projects to {speed: nil} and
	// must be dropped by the leading-all-nil rule. The t2 row carries a
	// real value and survives.
	q := &timelineQuerier{
		windowRows: &timelineWindowPgxRows{rows: []timelineWindowRow{
			{createdAt: t1, signal: "Speed"},
			{createdAt: t2, signal: "Speed", vNum: ptrFloat64(50)},
		}},
	}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	rows, err := r.Timeline(context.Background(), 1, []FieldMapping{{Signal: "Speed", Field: "speed"}}, from, to, TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows: want 1 (leading nil dropped), got %d (%+v)", len(rows), rows)
	}
	if !rows[0].Timestamp.Equal(t2) {
		t.Fatalf("ts: want %v, got %v", t2, rows[0].Timestamp)
	}
	if rows[0].Fields["speed"] != 50.0 {
		t.Fatalf("speed: want 50.0, got %v", rows[0].Fields["speed"])
	}
}

func TestLogStateReader_Timeline_ChartMode_PropagatesContextCancel(t *testing.T) {
	q := &timelineQuerier{seedErr: context.Canceled}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	from := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	to := from.Add(time.Hour)
	_, err := r.Timeline(context.Background(), 42,
		[]FieldMapping{{Signal: "Speed", Field: "speed"}},
		from, to, TimelineOptions{})
	if err == nil {
		t.Fatal("want error from cancelled query")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("want wrapped context.Canceled, got %v", err)
	}
	msg := err.Error()
	if !strings.Contains(msg, "vehicle 42") {
		t.Fatalf("want vehicle id in error, got %q", msg)
	}
	if !strings.Contains(msg, from.Format(time.RFC3339)) {
		t.Fatalf("want from in error, got %q", msg)
	}
	if !strings.Contains(msg, to.Format(time.RFC3339)) {
		t.Fatalf("want to in error, got %q", msg)
	}
}

func TestLogStateReader_Timeline_ChartMode_NoNPlusOne(t *testing.T) {
	q := &timelineQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	mappings := []FieldMapping{
		{Signal: "Speed", Field: "speed"},
		{Signal: "Soc", Field: "soc"},
		{Signal: "Power", Field: "power"},
		{Signal: "Heading", Field: "heading"},
		{Signal: "Odometer", Field: "odo"},
	}
	_, err := r.Timeline(context.Background(), 1, mappings, from, to, TimelineOptions{})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if got := q.calls.Load(); got != 2 {
		t.Fatalf("calls: want exactly 2 (seed + window) regardless of mapping count, got %d", got)
	}
}

func TestLogStateReader_Timeline_ChartMode_RejectsZeroFrom(t *testing.T) {
	q := &timelineQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	_, err := r.Timeline(context.Background(), 1,
		[]FieldMapping{{Signal: "Speed", Field: "speed"}},
		time.Time{}, time.Now(), TimelineOptions{})
	if err == nil {
		t.Fatal("want error for zero from")
	}
	if !strings.Contains(err.Error(), "from/to must be non-zero") {
		t.Fatalf("want 'from/to must be non-zero' in error, got %q", err.Error())
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for zero from; got %d calls", got)
	}
}

func TestLogStateReader_Timeline_ChartMode_RejectsZeroTo(t *testing.T) {
	q := &timelineQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	_, err := r.Timeline(context.Background(), 1,
		[]FieldMapping{{Signal: "Speed", Field: "speed"}},
		time.Now().Add(-time.Hour), time.Time{}, TimelineOptions{})
	if err == nil {
		t.Fatal("want error for zero to")
	}
	if !strings.Contains(err.Error(), "from/to must be non-zero") {
		t.Fatalf("want 'from/to must be non-zero' in error, got %q", err.Error())
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for zero to; got %d calls", got)
	}
}

func TestLogStateReader_Timeline_ChartMode_RejectsInvertedRange(t *testing.T) {
	q := &timelineQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	from := time.Date(2026, 4, 30, 13, 0, 0, 0, time.UTC)
	to := from.Add(-time.Hour)
	_, err := r.Timeline(context.Background(), 1,
		[]FieldMapping{{Signal: "Speed", Field: "speed"}},
		from, to, TimelineOptions{})
	if err == nil {
		t.Fatal("want error for inverted from > to")
	}
	msg := err.Error()
	if !strings.Contains(msg, "from") || !strings.Contains(msg, "to") {
		t.Fatalf("want 'from' and 'to' in error, got %q", msg)
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for inverted range; got %d calls", got)
	}
}

func TestLogStateReader_Timeline_ChartMode_RejectsExcessiveWindow(t *testing.T) {
	q := &timelineQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(367 * 24 * time.Hour)
	_, err := r.Timeline(context.Background(), 1,
		[]FieldMapping{{Signal: "Speed", Field: "speed"}},
		from, to, TimelineOptions{})
	if err == nil {
		t.Fatal("want error for window > 366 days")
	}
	msg := err.Error()
	if !strings.Contains(msg, "366") && !strings.Contains(msg, "window") {
		t.Fatalf("want '366' or 'window' in error, got %q", msg)
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called for excessive window; got %d calls", got)
	}
}

func TestLogStateReader_Timeline_CollapseMode_DropsConsecutiveDuplicates(t *testing.T) {
	t1 := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	t2 := t1.Add(time.Minute)
	t3 := t2.Add(time.Minute)
	// Three Title emissions whose values are A, A, B. forwardFold
	// produces three rows; collapseTimeline on ["title"] keeps the 1st
	// and 3rd (A is the leading run, B is a new value). The middle
	// duplicate row is dropped.
	q := &timelineQuerier{
		windowRows: &timelineWindowPgxRows{rows: []timelineWindowRow{
			{createdAt: t1, signal: "Title", vStr: ptrString("A")},
			{createdAt: t2, signal: "Title", vStr: ptrString("A")},
			{createdAt: t3, signal: "Title", vStr: ptrString("B")},
		}},
	}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	rows, err := r.Timeline(context.Background(), 1,
		[]FieldMapping{{Signal: "Title", Field: "title"}},
		from, to,
		TimelineOptions{CollapseBy: []string{"title"}})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows: want 2 (consecutive A,A collapsed), got %d (%+v)", len(rows), rows)
	}
	if !rows[0].Timestamp.Equal(t1) {
		t.Fatalf("rows[0].ts: want %v (first A kept), got %v", t1, rows[0].Timestamp)
	}
	if rows[0].Fields["title"] != "A" {
		t.Fatalf("rows[0].title: want A, got %v", rows[0].Fields["title"])
	}
	if !rows[1].Timestamp.Equal(t3) {
		t.Fatalf("rows[1].ts: want %v (B kept after collapse), got %v", t3, rows[1].Timestamp)
	}
	if rows[1].Fields["title"] != "B" {
		t.Fatalf("rows[1].title: want B, got %v", rows[1].Fields["title"])
	}
}

func TestLogStateReader_Timeline_CollapseMode_KeepsFirstAlways(t *testing.T) {
	t1 := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	t2 := t1.Add(time.Minute)
	// At t1 only Speed emits, so the row's collapse-key projection over
	// ["title"] is all-nil. The collapse contract says the first kept
	// row is ALWAYS kept regardless of its collapse-key shape; verify
	// that nil-projection first row survives and the second row (with
	// title="A") is kept as the first non-nil collapse value.
	q := &timelineQuerier{
		windowRows: &timelineWindowPgxRows{rows: []timelineWindowRow{
			{createdAt: t1, signal: "Speed", vNum: ptrFloat64(50)},
			{createdAt: t2, signal: "Title", vStr: ptrString("A")},
		}},
	}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	rows, err := r.Timeline(context.Background(), 1,
		[]FieldMapping{
			{Signal: "Speed", Field: "speed"},
			{Signal: "Title", Field: "title"},
		},
		from, to,
		TimelineOptions{CollapseBy: []string{"title"}})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows: want 2 (first nil-key row kept, then transition to A), got %d (%+v)", len(rows), rows)
	}
	if !rows[0].Timestamp.Equal(t1) {
		t.Fatalf("rows[0].ts: want %v (first row always kept), got %v", t1, rows[0].Timestamp)
	}
	if rows[0].Fields["title"] != nil {
		t.Fatalf("rows[0].title: want nil (no Title emission yet), got %v", rows[0].Fields["title"])
	}
	if rows[0].Fields["speed"] != 50.0 {
		t.Fatalf("rows[0].speed: want 50.0 (non-collapsed field carries real value), got %v", rows[0].Fields["speed"])
	}
}

func TestLogStateReader_Timeline_CollapseMode_RejectsUnknownCollapseField(t *testing.T) {
	q := &timelineQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	_, err := r.Timeline(context.Background(), 1,
		[]FieldMapping{{Signal: "X", Field: "x"}},
		from, to,
		TimelineOptions{CollapseBy: []string{"does_not_exist"}})
	if err == nil {
		t.Fatal("want error for unknown collapse field")
	}
	msg := err.Error()
	if !strings.Contains(msg, "does_not_exist") {
		t.Fatalf("want 'does_not_exist' in error, got %q", msg)
	}
	if !strings.Contains(msg, "not in mappings") {
		t.Fatalf("want 'not in mappings' in error, got %q", msg)
	}
	if got := q.calls.Load(); got != 0 {
		t.Fatalf("Query must not be called when CollapseBy validation fails; got %d calls", got)
	}
}

func TestLogStateReader_Timeline_CollapseMode_PreservesNonCollapsedFields(t *testing.T) {
	t1 := time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC)
	t2 := t1.Add(time.Minute)
	t3 := t2.Add(time.Minute)
	// Three timestamps. Title is "A" at t1+t2 (consecutive duplicates
	// under CollapseBy=["title"]), then "B" at t3. Artist changes at
	// every timestamp: X, Y, Z. After collapse, t2's row is dropped, so
	// the kept rows must carry artist=X (state at t1) and artist=Z
	// (state at t3). Crucially, artist=Y from the dropped t2 row must
	// NOT bleed into the kept row 1's artist value.
	q := &timelineQuerier{
		windowRows: &timelineWindowPgxRows{rows: []timelineWindowRow{
			{createdAt: t1, signal: "Title", vStr: ptrString("A")},
			{createdAt: t1, signal: "Artist", vStr: ptrString("X")},
			{createdAt: t2, signal: "Title", vStr: ptrString("A")},
			{createdAt: t2, signal: "Artist", vStr: ptrString("Y")},
			{createdAt: t3, signal: "Title", vStr: ptrString("B")},
			{createdAt: t3, signal: "Artist", vStr: ptrString("Z")},
		}},
	}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	rows, err := r.Timeline(context.Background(), 1,
		[]FieldMapping{
			{Signal: "Title", Field: "title"},
			{Signal: "Artist", Field: "artist"},
		},
		from, to,
		TimelineOptions{CollapseBy: []string{"title"}})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows: want 2 (t2 dropped as duplicate of t1's title), got %d (%+v)", len(rows), rows)
	}
	if !rows[0].Timestamp.Equal(t1) {
		t.Fatalf("rows[0].ts: want %v (first A kept), got %v", t1, rows[0].Timestamp)
	}
	if rows[0].Fields["title"] != "A" {
		t.Fatalf("rows[0].title: want A, got %v", rows[0].Fields["title"])
	}
	if rows[0].Fields["artist"] != "X" {
		t.Fatalf("rows[0].artist: want X (state at kept t1, NOT Y from dropped t2), got %v", rows[0].Fields["artist"])
	}
	if !rows[1].Timestamp.Equal(t3) {
		t.Fatalf("rows[1].ts: want %v (B kept), got %v", t3, rows[1].Timestamp)
	}
	if rows[1].Fields["title"] != "B" {
		t.Fatalf("rows[1].title: want B, got %v", rows[1].Fields["title"])
	}
	if rows[1].Fields["artist"] != "Z" {
		t.Fatalf("rows[1].artist: want Z (state at t3), got %v", rows[1].Fields["artist"])
	}
}

func TestLogStateReader_Timeline_CollapseMode_NoNPlusOne(t *testing.T) {
	q := &timelineQuerier{}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}
	from, to := validWindow()

	mappings := []FieldMapping{
		{Signal: "Speed", Field: "speed"},
		{Signal: "Soc", Field: "soc"},
		{Signal: "Power", Field: "power"},
		{Signal: "Heading", Field: "heading"},
		{Signal: "Odometer", Field: "odo"},
	}
	_, err := r.Timeline(context.Background(), 1, mappings, from, to,
		TimelineOptions{CollapseBy: []string{"speed"}})
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if got := q.calls.Load(); got != 2 {
		t.Fatalf("calls: want exactly 2 (seed + window) regardless of mapping count or collapse mode, got %d", got)
	}
}
