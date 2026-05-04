package signal

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

// fakeRow is the in-memory analogue of a single signal_log row, holding
// the typed value columns directly so tests can construct rows without
// going through Postgres. Helper constructors below build common shapes.
type fakeRow struct {
	field string
	kind  int16
	sv    *string
	bv    *bool
	iv    *int64
	fv    *float64
	tv    *time.Time
}

// fakeRowIterator implements the unexported rowIterator interface so tests
// can drive assembleState directly. Tracks the current cursor position
// via pos (1-indexed: Next advances pos, Scan reads rows[pos-1]).
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
	if len(dest) != 7 {
		return fmt.Errorf("fakeRowIterator: expected 7 destinations, got %d", len(dest))
	}
	row := f.rows[f.pos-1]
	*(dest[0].(*string)) = row.field
	*(dest[1].(*int16)) = row.kind
	*(dest[2].(**string)) = row.sv
	*(dest[3].(**bool)) = row.bv
	*(dest[4].(**int64)) = row.iv
	*(dest[5].(**float64)) = row.fv
	*(dest[6].(**time.Time)) = row.tv
	return nil
}

func (f *fakeRowIterator) Err() error { return f.err }
func (f *fakeRowIterator) Close()     { f.closed = true }

// emptyPgxRows is a minimal pgx.Rows implementation used by fakeQuerier
// when it needs to simulate a successful Query that returns zero rows.
// Most methods return zero values; only Next/Close/Err are exercised.
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

// signalAtPgxRows is a single-row pgx.Rows for the SignalAt 6-column
// query (value_kind, str_value, bool_value, int_value, float_value,
// time_value). hasRow=false simulates "signal never emitted before at";
// scanErr forces Scan to fail without touching the destinations,
// exercising the SignalAt scan-error branch.
type signalAtPgxRows struct {
	hasRow    bool
	delivered bool
	kind      int16
	sv        *string
	bv        *bool
	iv        *int64
	fv        *float64
	tv        *time.Time
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
	if len(dest) != 6 {
		return fmt.Errorf("signalAtPgxRows: expected 6 destinations, got %d", len(dest))
	}
	*(dest[0].(*int16)) = s.kind
	*(dest[1].(**string)) = s.sv
	*(dest[2].(**bool)) = s.bv
	*(dest[3].(**int64)) = s.iv
	*(dest[4].(**float64)) = s.fv
	*(dest[5].(**time.Time)) = s.tv
	return nil
}
func (s *signalAtPgxRows) Values() ([]any, error) { return nil, nil }
func (s *signalAtPgxRows) RawValues() [][]byte    { return nil }
func (s *signalAtPgxRows) Conn() *pgx.Conn        { return nil }

// fakeQuerier implements the unexported pgxQuerier interface for tests
// that need to drive the LogStateReader.State end-to-end (context cancel,
// slow query, error logging). The calls counter lets tests assert that
// Query was (or was not) invoked.
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

// --- decodeRow / decodeSignalLogRow tests --------------------------------

func TestDecodeSignalLogRow_AllKinds(t *testing.T) {
	str := "hello"
	b := true
	var i64 int64 = 42
	f := 3.14
	tm := time.Date(2026, 5, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name string
		kind protomodel.ValueKind
		sv   *string
		bv   *bool
		iv   *int64
		fv   *float64
		tv   *time.Time
		want any
	}{
		{"string", protomodel.ValueKindString, &str, nil, nil, nil, nil, "hello"},
		{"bool", protomodel.ValueKindBool, nil, &b, nil, nil, nil, true},
		{"int32", protomodel.ValueKindInt32, nil, nil, &i64, nil, nil, int64(42)},
		{"int64", protomodel.ValueKindInt64, nil, nil, &i64, nil, nil, int64(42)},
		{"float", protomodel.ValueKindFloat, nil, nil, nil, &f, nil, 3.14},
		{"double", protomodel.ValueKindDouble, nil, nil, nil, &f, nil, 3.14},
		{"enum_int", protomodel.ValueKindEnum, nil, nil, &i64, nil, nil, int64(42)},
		{"enum_str_fallback", protomodel.ValueKindEnum, &str, nil, nil, nil, nil, "hello"},
		{"time", protomodel.ValueKindTime, nil, nil, nil, nil, &tm, tm},
		{"unknown_drops", protomodel.ValueKindUnknown, &str, nil, nil, nil, nil, nil},
		{"compound_drops", protomodel.ValueKindCompound, &str, nil, nil, nil, nil, nil},
		{"invalid_drops", protomodel.ValueKindInvalid, &str, nil, nil, nil, nil, nil},
		{"string_null_returns_nil", protomodel.ValueKindString, nil, nil, nil, nil, nil, nil},
		{"bool_null_returns_nil", protomodel.ValueKindBool, nil, nil, nil, nil, nil, nil},
		{"int32_null_returns_nil", protomodel.ValueKindInt32, nil, nil, nil, nil, nil, nil},
		{"float_null_returns_nil", protomodel.ValueKindFloat, nil, nil, nil, nil, nil, nil},
		{"time_null_returns_nil", protomodel.ValueKindTime, nil, nil, nil, nil, nil, nil},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := decodeRow(int16(tc.kind), tc.sv, tc.bv, tc.iv, tc.fv, tc.tv, nil)
			if got != tc.want {
				t.Fatalf("decodeRow(%v) = %v (%T), want %v (%T)", tc.kind, got, got, tc.want, tc.want)
			}
		})
	}
}

func TestDecodeSignalLogRow_LogsUnexpectedKind(t *testing.T) {
	var buf bytes.Buffer
	log := zerolog.New(&buf)
	r := &LogStateReader{pool: &fakeQuerier{}, log: log}

	got := r.decodeSignalLogRow(99, nil, nil, nil, nil, nil)
	if got != nil {
		t.Fatalf("want nil for unknown kind, got %v", got)
	}
	out := buf.String()
	if !strings.Contains(out, "unexpected value_kind") {
		t.Fatalf("want 'unexpected value_kind' in log, got %q", out)
	}
	if !strings.Contains(out, `"value_kind":99`) {
		t.Fatalf("want value_kind=99 in log, got %q", out)
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
	iter := &fakeRowIterator{
		rows: []fakeRow{
			{field: "Speed", kind: int16(protomodel.ValueKindFloat), fv: &speed},
			{field: "Soc", kind: int16(protomodel.ValueKindDouble), fv: &soc},
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
}

func TestLogStateReader_State_DecodesAllKinds(t *testing.T) {
	str := "Driving"
	b := true
	var i64 int64 = 1234
	tm := time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC)
	iter := &fakeRowIterator{
		rows: []fakeRow{
			{field: "Gear", kind: int16(protomodel.ValueKindString), sv: &str},
			{field: "Locked", kind: int16(protomodel.ValueKindBool), bv: &b},
			{field: "Odometer", kind: int16(protomodel.ValueKindInt64), iv: &i64},
			{field: "LastSeen", kind: int16(protomodel.ValueKindTime), tv: &tm},
		},
	}

	state, err := assembleState(iter)
	if err != nil {
		t.Fatalf("assembleState: %v", err)
	}
	if state["Gear"] != "Driving" {
		t.Fatalf("Gear: want 'Driving', got %v", state["Gear"])
	}
	if state["Locked"] != true {
		t.Fatalf("Locked: want true, got %v", state["Locked"])
	}
	if state["Odometer"] != int64(1234) {
		t.Fatalf("Odometer: want int64(1234), got %v (%T)", state["Odometer"], state["Odometer"])
	}
	if got, ok := state["LastSeen"].(time.Time); !ok || !got.Equal(tm) {
		t.Fatalf("LastSeen: want %v (time.Time), got %v (%T)", tm, state["LastSeen"], state["LastSeen"])
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
	q := &fakeQuerier{rows: &signalAtPgxRows{hasRow: true, kind: int16(protomodel.ValueKindFloat), fv: &speed}}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	v, err := r.SignalAt(context.Background(), 1, "Speed", time.Now())
	if err != nil {
		t.Fatalf("SignalAt: %v", err)
	}
	if v != 50.0 {
		t.Fatalf("value: want 50.0, got %v", v)
	}
}

func TestLogStateReader_SignalAt_DecodesString(t *testing.T) {
	gear := "Driving"
	q := &fakeQuerier{rows: &signalAtPgxRows{hasRow: true, kind: int16(protomodel.ValueKindString), sv: &gear}}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	v, err := r.SignalAt(context.Background(), 1, "Gear", time.Now())
	if err != nil {
		t.Fatalf("SignalAt: %v", err)
	}
	if v != "Driving" {
		t.Fatalf("value: want 'Driving', got %v (%T)", v, v)
	}
}

func TestLogStateReader_SignalAt_DecodesBool(t *testing.T) {
	locked := true
	q := &fakeQuerier{rows: &signalAtPgxRows{hasRow: true, kind: int16(protomodel.ValueKindBool), bv: &locked}}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	v, err := r.SignalAt(context.Background(), 1, "Locked", time.Now())
	if err != nil {
		t.Fatalf("SignalAt: %v", err)
	}
	if v != true {
		t.Fatalf("value: want true, got %v (%T)", v, v)
	}
}

func TestLogStateReader_SignalAt_DecodesInt(t *testing.T) {
	var odo int64 = 123456
	q := &fakeQuerier{rows: &signalAtPgxRows{hasRow: true, kind: int16(protomodel.ValueKindInt64), iv: &odo}}
	r := &LogStateReader{pool: q, log: zerolog.Nop()}

	v, err := r.SignalAt(context.Background(), 1, "Odometer", time.Now())
	if err != nil {
		t.Fatalf("SignalAt: %v", err)
	}
	if v != int64(123456) {
		t.Fatalf("value: want int64(123456), got %v (%T)", v, v)
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
// returned by the seed (DISTINCT ON) query: 7 columns, no ts.
type timelineSeedRow struct {
	field string
	kind  int16
	sv    *string
	bv    *bool
	iv    *int64
	fv    *float64
	tv    *time.Time
}

// timelineSeedPgxRows implements the relevant subset of pgx.Rows used by
// LogStateReader.Timeline's seed scan. Only Next/Scan/Err/Close are
// exercised; the rest of pgx.Rows is satisfied with zero-value stubs.
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
	if len(dest) != 7 {
		return fmt.Errorf("timelineSeedPgxRows: expected 7 destinations, got %d", len(dest))
	}
	row := s.rows[s.pos-1]
	*(dest[0].(*string)) = row.field
	*(dest[1].(*int16)) = row.kind
	*(dest[2].(**string)) = row.sv
	*(dest[3].(**bool)) = row.bv
	*(dest[4].(**int64)) = row.iv
	*(dest[5].(**float64)) = row.fv
	*(dest[6].(**time.Time)) = row.tv
	return nil
}
func (s *timelineSeedPgxRows) Values() ([]any, error) { return nil, nil }
func (s *timelineSeedPgxRows) RawValues() [][]byte    { return nil }
func (s *timelineSeedPgxRows) Conn() *pgx.Conn        { return nil }

// timelineWindowRow is the in-memory analogue of one signal_log row
// returned by the window query: 8 columns including ts first.
type timelineWindowRow struct {
	ts    time.Time
	field string
	kind  int16
	sv    *string
	bv    *bool
	iv    *int64
	fv    *float64
	tv    *time.Time
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
	if len(dest) != 8 {
		return fmt.Errorf("timelineWindowPgxRows: expected 8 destinations, got %d", len(dest))
	}
	row := w.rows[w.pos-1]
	*(dest[0].(*time.Time)) = row.ts
	*(dest[1].(*string)) = row.field
	*(dest[2].(*int16)) = row.kind
	*(dest[3].(**string)) = row.sv
	*(dest[4].(**bool)) = row.bv
	*(dest[5].(**int64)) = row.iv
	*(dest[6].(**float64)) = row.fv
	*(dest[7].(**time.Time)) = row.tv
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

// floatRow is a convenience builder for a float-kind window row.
func floatRow(ts time.Time, field string, v float64) timelineWindowRow {
	return timelineWindowRow{ts: ts, field: field, kind: int16(protomodel.ValueKindFloat), fv: &v}
}

func stringRow(ts time.Time, field string, v string) timelineWindowRow {
	return timelineWindowRow{ts: ts, field: field, kind: int16(protomodel.ValueKindString), sv: &v}
}

func nullFloatRow(ts time.Time, field string) timelineWindowRow {
	return timelineWindowRow{ts: ts, field: field, kind: int16(protomodel.ValueKindFloat)}
}

func floatSeedRow(field string, v float64) timelineSeedRow {
	return timelineSeedRow{field: field, kind: int16(protomodel.ValueKindFloat), fv: &v}
}

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
		seedRows:   &timelineSeedPgxRows{rows: []timelineSeedRow{floatSeedRow("Speed", 50)}},
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
			floatRow(t1, "Speed", 50),
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
			floatSeedRow("Soc", 80),
		}},
		windowRows: &timelineWindowPgxRows{rows: []timelineWindowRow{
			floatRow(t1, "Speed", 50),
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
			floatRow(t1, "Speed", 50),
			floatRow(t1, "Soc", 80),
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
			nullFloatRow(t1, "Speed"),
			floatRow(t2, "Speed", 50),
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
			stringRow(t1, "Title", "A"),
			stringRow(t2, "Title", "A"),
			stringRow(t3, "Title", "B"),
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
			floatRow(t1, "Speed", 50),
			stringRow(t2, "Title", "A"),
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
			stringRow(t1, "Title", "A"),
			stringRow(t1, "Artist", "X"),
			stringRow(t2, "Title", "A"),
			stringRow(t2, "Artist", "Y"),
			stringRow(t3, "Title", "B"),
			stringRow(t3, "Artist", "Z"),
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

// suppress unused warnings: ptrFloat64/ptrString are kept for fixture
// authors that prefer the explicit pointer form over the convenience
// row-builders above.
var _ = ptrFloat64
var _ = ptrString
