package timemachine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// TestMain silences the global zerolog logger so the intentional error-path
// logs (query failures, scan failures) don't clutter test output.
func TestMain(m *testing.M) {
	zerolog.SetGlobalLevel(zerolog.Disabled)
	m.Run()
}

// ---------------------------------------------------------------------------
// Pure helpers: parseAtParam
// ---------------------------------------------------------------------------

func TestParseAtParam(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name    string
		raw     string
		want    time.Time
		wantErr error
	}{
		{
			name: "empty defaults to now (UTC)",
			raw:  "",
			want: now,
		},
		{
			name: "valid RFC3339 in the past",
			raw:  "2026-01-02T03:04:05Z",
			want: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		},
		{
			name: "offset timestamp normalized to UTC",
			raw:  "2026-01-02T05:04:05+02:00",
			want: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		},
		{
			name: "exactly now is allowed (not future)",
			raw:  "2026-03-04T12:00:00Z",
			want: now,
		},
		{
			name:    "malformed value rejected",
			raw:     "not-a-timestamp",
			wantErr: errAtMalformed,
		},
		{
			name:    "date-only (non RFC3339) rejected",
			raw:     "2026-01-02",
			wantErr: errAtMalformed,
		},
		{
			name:    "future timestamp rejected",
			raw:     "2026-03-04T12:00:01Z",
			wantErr: errAtFuture,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := parseAtParam(tt.raw, now)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("parseAtParam(%q) err = %v, want %v", tt.raw, err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseAtParam(%q) unexpected err = %v", tt.raw, err)
			}
			if !got.Equal(tt.want) {
				t.Fatalf("parseAtParam(%q) = %v, want %v", tt.raw, got, tt.want)
			}
			if got.Location() != time.UTC {
				t.Fatalf("parseAtParam(%q) location = %v, want UTC", tt.raw, got.Location())
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Pure helpers: valueKindLabel
// ---------------------------------------------------------------------------

func TestValueKindLabel(t *testing.T) {
	t.Parallel()
	tests := []struct {
		kind int16
		want string
	}{
		{valueKindString, "string"},
		{valueKindBool, "bool"},
		{valueKindInt32, "int"},
		{valueKindInt64, "int"},
		{valueKindEnum, "enum"},
		{valueKindFloat, "float"},
		{valueKindDouble, "float"},
		{valueKindTime, "time"},
		{0, "unknown"},  // ValueKindUnknown
		{8, "unknown"},  // ValueKindCompound (never logged)
		{10, "unknown"}, // ValueKindInvalid
		{99, "unknown"}, // out of range
	}
	for _, tt := range tests {
		if got := valueKindLabel(tt.kind); got != tt.want {
			t.Errorf("valueKindLabel(%d) = %q, want %q", tt.kind, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// Pure helpers: typedValue
// ---------------------------------------------------------------------------

func strp(s string) *string        { return &s }
func boolp(b bool) *bool           { return &b }
func i64p(i int64) *int64          { return &i }
func f64p(f float64) *float64      { return &f }
func timep(t time.Time) *time.Time { return &t }

func TestTypedValue(t *testing.T) {
	t.Parallel()
	ts := time.Date(2025, 6, 1, 8, 30, 0, 0, time.UTC)

	tests := []struct {
		name      string
		in        scannedSignal
		wantValue any
		wantKind  string
	}{
		{
			name:      "string kind reads str_value",
			in:        scannedSignal{ValueKind: valueKindString, Str: strp("P")},
			wantValue: "P",
			wantKind:  "string",
		},
		{
			name:      "bool kind reads bool_value",
			in:        scannedSignal{ValueKind: valueKindBool, Bool: boolp(true)},
			wantValue: true,
			wantKind:  "bool",
		},
		{
			name:      "int32 kind reads int_value",
			in:        scannedSignal{ValueKind: valueKindInt32, Int: i64p(42)},
			wantValue: int64(42),
			wantKind:  "int",
		},
		{
			name:      "int64 kind reads int_value",
			in:        scannedSignal{ValueKind: valueKindInt64, Int: i64p(9000000000)},
			wantValue: int64(9000000000),
			wantKind:  "int",
		},
		{
			name:      "enum kind reads int_value with enum label",
			in:        scannedSignal{ValueKind: valueKindEnum, Int: i64p(3)},
			wantValue: int64(3),
			wantKind:  "enum",
		},
		{
			name:      "float kind reads float_value",
			in:        scannedSignal{ValueKind: valueKindFloat, Float: f64p(3.5)},
			wantValue: 3.5,
			wantKind:  "float",
		},
		{
			name:      "double kind reads float_value",
			in:        scannedSignal{ValueKind: valueKindDouble, Float: f64p(75000.0)},
			wantValue: 75000.0,
			wantKind:  "float",
		},
		{
			name:      "time kind renders RFC3339 string",
			in:        scannedSignal{ValueKind: valueKindTime, Time: timep(ts)},
			wantValue: "2025-06-01T08:30:00Z",
			wantKind:  "time",
		},
		{
			name:      "string kind with NULL column yields nil value",
			in:        scannedSignal{ValueKind: valueKindString, Str: nil},
			wantValue: nil,
			wantKind:  "string",
		},
		{
			name:      "float kind with NULL column yields nil value",
			in:        scannedSignal{ValueKind: valueKindFloat, Float: nil},
			wantValue: nil,
			wantKind:  "float",
		},
		{
			name:      "unknown kind yields nil value + unknown label",
			in:        scannedSignal{ValueKind: 0},
			wantValue: nil,
			wantKind:  "unknown",
		},
		{
			name:      "mismatched column ignored (only kind-dictated column read)",
			in:        scannedSignal{ValueKind: valueKindBool, Str: strp("ignore-me")},
			wantValue: nil,
			wantKind:  "bool",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gotValue, gotKind := typedValue(tt.in)
			if gotValue != tt.wantValue {
				t.Errorf("typedValue value = %#v (%T), want %#v (%T)", gotValue, gotValue, tt.wantValue, tt.wantValue)
			}
			if gotKind != tt.wantKind {
				t.Errorf("typedValue kind = %q, want %q", gotKind, tt.wantKind)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Pure helpers: signalAge
// ---------------------------------------------------------------------------

func TestSignalAge(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name string
		ts   time.Time
		want float64
	}{
		{"same instant", at, 0},
		{"two minutes old", at.Add(-2 * time.Minute), 120},
		{"one day old", at.Add(-24 * time.Hour), 86400},
		{"future ts clamped to zero", at.Add(1 * time.Second), 0},
	}
	for _, tt := range tests {
		if got := signalAge(at, tt.ts); got != tt.want {
			t.Errorf("%s: signalAge = %v, want %v", tt.name, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// Query-building: assert the critical clauses are present so a refactor that
// drops the point-in-time semantics is caught without a live database.
// ---------------------------------------------------------------------------

func TestStateQuery_Shape(t *testing.T) {
	t.Parallel()
	needles := []string{
		"DISTINCT ON (field)",     // one row per field
		"WHERE vehicle_id = $1",   // vehicle scope
		"ts <= $2",                // at-or-before the instant
		"ORDER BY field, ts DESC", // leading-edge per field
		"LIMIT $3",                // field cap
	}
	for _, n := range needles {
		if !strings.Contains(stateQuery, n) {
			t.Errorf("stateQuery missing clause %q\nquery=%s", n, stateQuery)
		}
	}
}

func TestRangeQuery_Shape(t *testing.T) {
	t.Parallel()
	needles := []string{
		"MIN(ts)",
		"MAX(ts)",
		"COUNT(DISTINCT field)",
		"WHERE vehicle_id = $1",
	}
	for _, n := range needles {
		if !strings.Contains(rangeQuery, n) {
			t.Errorf("rangeQuery missing clause %q\nquery=%s", n, rangeQuery)
		}
	}
}

// ---------------------------------------------------------------------------
// Constructor guards
// ---------------------------------------------------------------------------

func TestNewTimeMachineHandler_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil *database.DB")
		}
	}()
	_ = NewTimeMachineHandler(nil)
}

// ---------------------------------------------------------------------------
// Fake pgx plumbing. The codebase does not vendor pgxmock (see routeeff /
// chargeopt for the same precedent); the handler talks to a local tmQuerier
// interface so tests can supply a scripted row source without a database.
// ---------------------------------------------------------------------------

type fakeRows struct {
	data    [][]any
	idx     int
	scanErr error
	errVal  error
	closed  bool
}

func (r *fakeRows) Next() bool {
	if r.idx >= len(r.data) {
		return false
	}
	r.idx++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	return assignScan(dest, r.data[r.idx-1])
}

func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) Err() error                                   { return r.errVal }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

type fakeRow struct {
	vals []any
	err  error
}

func (r *fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignScan(dest, r.vals)
}

var _ pgx.Row = (*fakeRow)(nil)

// assignScan copies scripted values into the handler's Scan destinations,
// mimicking pgx's per-type scanning (including NULL → nil pointer for the
// nullable typed columns). A nil scripted entry for a **T destination is a
// SQL NULL.
func assignScan(dest []any, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("scan: %d destinations but row has %d values", len(dest), len(vals))
	}
	for i, d := range dest {
		v := vals[i]
		switch p := d.(type) {
		case *string:
			s, ok := v.(string)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *string", i, v)
			}
			*p = s
		case *int:
			n, ok := v.(int)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *int", i, v)
			}
			*p = n
		case *int16:
			n, ok := v.(int16)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *int16", i, v)
			}
			*p = n
		case *time.Time:
			tv, ok := v.(time.Time)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *time.Time", i, v)
			}
			*p = tv
		case **string:
			if v == nil {
				*p = nil
				continue
			}
			s, ok := v.(string)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into **string", i, v)
			}
			cp := s
			*p = &cp
		case **bool:
			if v == nil {
				*p = nil
				continue
			}
			b, ok := v.(bool)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into **bool", i, v)
			}
			cp := b
			*p = &cp
		case **int64:
			if v == nil {
				*p = nil
				continue
			}
			n, ok := v.(int64)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into **int64", i, v)
			}
			cp := n
			*p = &cp
		case **float64:
			if v == nil {
				*p = nil
				continue
			}
			f, ok := v.(float64)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into **float64", i, v)
			}
			cp := f
			*p = &cp
		case **time.Time:
			if v == nil {
				*p = nil
				continue
			}
			tv, ok := v.(time.Time)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into **time.Time", i, v)
			}
			cp := tv
			*p = &cp
		default:
			return fmt.Errorf("col %d: unsupported destination type %T", i, d)
		}
	}
	return nil
}

// fakePool records the SQL + args and returns scripted rows / a scripted row.
type fakePool struct {
	rows     pgx.Rows
	queryErr error
	row      pgx.Row
	gotSQL   string
	gotArgs  []any
}

func (p *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.gotSQL = sql
	p.gotArgs = args
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	return p.rows, nil
}

func (p *fakePool) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	p.gotSQL = sql
	p.gotArgs = args
	return p.row
}

var _ tmQuerier = (*fakePool)(nil)

// stateRequest builds a request whose chi route context resolves vehicleID
// and carries the given raw query string (e.g. "at=2025-06-01T08:30:00Z").
func stateRequest(vehicleID, rawQuery string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/vehicles/"+vehicleID+"/time-machine?"+rawQuery, nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("vehicleID", vehicleID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
}

// ---------------------------------------------------------------------------
// Handler: State
// ---------------------------------------------------------------------------

func TestState_ReconstructsTypedFields(t *testing.T) {
	at := time.Date(2025, 6, 1, 8, 30, 0, 0, time.UTC)
	// ts values are all at-or-before `at`; ages are deterministic.
	socTs := at.Add(-30 * time.Second)    // fresh
	gearTs := at.Add(-2 * time.Hour)      // stale
	odoTs := at.Add(-90 * 24 * time.Hour) // very stale

	rows := &fakeRows{data: [][]any{
		// field, value_kind, str, bool, int, float, time, ts
		{"BatteryLevel", int16(valueKindDouble), nil, nil, nil, 72.5, nil, socTs},
		{"Gear", int16(valueKindString), "D", nil, nil, nil, nil, gearTs},
		{"Odometer", int16(valueKindInt64), nil, nil, int64(123456), nil, nil, odoTs},
		{"Locked", int16(valueKindBool), nil, true, nil, nil, nil, socTs},
	}}
	pool := &fakePool{rows: rows}
	h := &TimeMachineHandler{db: pool}

	rec := httptest.NewRecorder()
	h.State(rec, stateRequest("42", "at=2025-06-01T08:30:00Z"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	var body struct {
		At     string `json:"at"`
		Count  int    `json:"count"`
		Fields []struct {
			Field      string  `json:"field"`
			Value      any     `json:"value"`
			ValueKind  string  `json:"value_kind"`
			Ts         string  `json:"ts"`
			AgeSeconds float64 `json:"age_seconds"`
		} `json:"fields"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}

	if body.At != "2025-06-01T08:30:00Z" {
		t.Errorf("at = %q, want reconstructed instant", body.At)
	}
	if body.Count != 4 || len(body.Fields) != 4 {
		t.Fatalf("count = %d / fields = %d, want 4", body.Count, len(body.Fields))
	}

	byField := map[string]struct {
		Value      any
		Kind       string
		AgeSeconds float64
	}{}
	for _, f := range body.Fields {
		byField[f.Field] = struct {
			Value      any
			Kind       string
			AgeSeconds float64
		}{f.Value, f.ValueKind, f.AgeSeconds}
	}

	if got := byField["BatteryLevel"]; got.Kind != "float" || got.Value.(float64) != 72.5 || got.AgeSeconds != 30 {
		t.Errorf("BatteryLevel = %#v, want float 72.5 age 30", got)
	}
	if got := byField["Gear"]; got.Kind != "string" || got.Value.(string) != "D" || got.AgeSeconds != 7200 {
		t.Errorf("Gear = %#v, want string D age 7200", got)
	}
	if got := byField["Odometer"]; got.Kind != "int" || got.Value.(float64) != 123456 {
		t.Errorf("Odometer = %#v, want int 123456", got)
	}
	if got := byField["Locked"]; got.Kind != "bool" || got.Value.(bool) != true {
		t.Errorf("Locked = %#v, want bool true", got)
	}

	// The point-in-time args must be forwarded verbatim.
	if len(pool.gotArgs) != 3 {
		t.Fatalf("query args = %v, want [vehicleID at maxFields]", pool.gotArgs)
	}
	if vid, ok := pool.gotArgs[0].(int64); !ok || vid != 42 {
		t.Errorf("arg0 vehicleID = %#v, want int64(42)", pool.gotArgs[0])
	}
	if atArg, ok := pool.gotArgs[1].(time.Time); !ok || !atArg.Equal(at) {
		t.Errorf("arg1 at = %#v, want %v", pool.gotArgs[1], at)
	}
	if !rows.closed {
		t.Error("rows.Close() was not called")
	}
}

func TestState_EmptyHistoryReturnsEmptyFields(t *testing.T) {
	pool := &fakePool{rows: &fakeRows{data: nil}}
	h := &TimeMachineHandler{db: pool}

	rec := httptest.NewRecorder()
	h.State(rec, stateRequest("7", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	// fields must serialize as [] (never null) so the frontend can map safely.
	if !strings.Contains(rec.Body.String(), `"fields":[]`) {
		t.Errorf("empty history body should carry an empty fields array; got %s", rec.Body.String())
	}
}

func TestState_InvalidVehicleID(t *testing.T) {
	h := &TimeMachineHandler{db: &fakePool{}}
	rec := httptest.NewRecorder()
	h.State(rec, stateRequest("0", ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestState_MalformedAtParam(t *testing.T) {
	h := &TimeMachineHandler{db: &fakePool{}}
	rec := httptest.NewRecorder()
	h.State(rec, stateRequest("42", "at=nonsense"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestState_QueryErrorIs500(t *testing.T) {
	pool := &fakePool{queryErr: errors.New("connection reset")}
	h := &TimeMachineHandler{db: pool}
	rec := httptest.NewRecorder()
	h.State(rec, stateRequest("42", "at=2025-06-01T08:30:00Z"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Handler: Range
// ---------------------------------------------------------------------------

func rangeRequest(vehicleID string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/vehicles/"+vehicleID+"/time-machine/range", nil)
	rc := chi.NewRouteContext()
	rc.URLParams.Add("vehicleID", vehicleID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
}

func TestRange_ReturnsBounds(t *testing.T) {
	earliest := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	latest := time.Date(2026, 3, 4, 12, 0, 0, 0, time.UTC)
	pool := &fakePool{row: &fakeRow{vals: []any{earliest, latest, 137}}}
	h := &TimeMachineHandler{db: pool}

	rec := httptest.NewRecorder()
	h.Range(rec, rangeRequest("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Earliest   *string `json:"earliest"`
		Latest     *string `json:"latest"`
		FieldCount int     `json:"field_count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if body.Earliest == nil || *body.Earliest != "2025-01-01T00:00:00Z" {
		t.Errorf("earliest = %v, want 2025-01-01T00:00:00Z", body.Earliest)
	}
	if body.Latest == nil || *body.Latest != "2026-03-04T12:00:00Z" {
		t.Errorf("latest = %v, want 2026-03-04T12:00:00Z", body.Latest)
	}
	if body.FieldCount != 137 {
		t.Errorf("field_count = %d, want 137", body.FieldCount)
	}
}

func TestRange_NoHistoryReturnsNulls(t *testing.T) {
	// MIN/MAX over an empty set are NULL; COUNT is 0.
	pool := &fakePool{row: &fakeRow{vals: []any{nil, nil, 0}}}
	h := &TimeMachineHandler{db: pool}

	rec := httptest.NewRecorder()
	h.Range(rec, rangeRequest("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Earliest   *string `json:"earliest"`
		Latest     *string `json:"latest"`
		FieldCount int     `json:"field_count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if body.Earliest != nil || body.Latest != nil {
		t.Errorf("earliest/latest = %v/%v, want null/null", body.Earliest, body.Latest)
	}
	if body.FieldCount != 0 {
		t.Errorf("field_count = %d, want 0", body.FieldCount)
	}
}

func TestRange_InvalidVehicleID(t *testing.T) {
	h := &TimeMachineHandler{db: &fakePool{}}
	rec := httptest.NewRecorder()
	h.Range(rec, rangeRequest("-1"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRange_ScanErrorIs500(t *testing.T) {
	pool := &fakePool{row: &fakeRow{err: errors.New("scan boom")}}
	h := &TimeMachineHandler{db: pool}
	rec := httptest.NewRecorder()
	h.Range(rec, rangeRequest("42"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}
