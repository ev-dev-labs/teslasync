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
