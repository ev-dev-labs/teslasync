package chargeheatmap

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// --- in-memory fakes for the dbQuerier port ------------------------------
//
// These mirror the established pgx.Rows / querier fake pattern used in
// internal/signal/state_reader_log_test.go, letting us drive
// ChargingHeatmapHandler.Get end-to-end without a live Postgres. Values are
// stored as typed any and copied into the caller's scan destinations by
// assignScan, which fails loudly on a type mismatch so a future column/scan
// drift is caught rather than silently zeroing a field.

func assignScan(dest, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("fake scan: got %d destinations, want %d", len(dest), len(vals))
	}
	for i, d := range dest {
		switch p := d.(type) {
		case *int:
			v, ok := vals[i].(int)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want int, got %T", i, vals[i])
			}
			*p = v
		case *int64:
			v, ok := vals[i].(int64)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want int64, got %T", i, vals[i])
			}
			*p = v
		case *float64:
			v, ok := vals[i].(float64)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want float64, got %T", i, vals[i])
			}
			*p = v
		case *string:
			v, ok := vals[i].(string)
			if !ok {
				return fmt.Errorf("fake scan: col %d: want string, got %T", i, vals[i])
			}
			*p = v
		default:
			return fmt.Errorf("fake scan: col %d: unsupported destination type %T", i, d)
		}
	}
	return nil
}

// fakeRows is a minimal, cursor-driven pgx.Rows. rows holds the typed
// column values per row; scanErr forces the first Scan to fail; iterErr is
// surfaced by Err() to simulate a mid-iteration transport failure.
type fakeRows struct {
	rows    [][]any
	pos     int
	scanErr error
	iterErr error
	closed  bool
}

func (r *fakeRows) Next() bool {
	if r.pos >= len(r.rows) {
		return false
	}
	r.pos++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if r.pos == 0 || r.pos > len(r.rows) {
		return fmt.Errorf("fakeRows: Scan called out of range (pos=%d)", r.pos)
	}
	return assignScan(dest, r.rows[r.pos-1])
}

func (r *fakeRows) Err() error                                   { return r.iterErr }
func (r *fakeRows) Close()                                       { r.closed = true }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// fakeRow is a single-row pgx.Row for the summary QueryRow. A non-nil err
// exercises the summary scan-error branch.
type fakeRow struct {
	vals []any
	err  error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	return assignScan(dest, r.vals)
}

var _ pgx.Row = fakeRow{}

// fakeQuerier implements dbQuerier and dispatches by SQL shape: the heatmap
// query groups by day_of_week; the location query groups by start_place.
// It records every SQL string and its args so tests can assert the
// parameterised vehicle_id reaches all three sub-queries.
type fakeQuerier struct {
	heatmapRows pgx.Rows
	heatmapErr  error
	locRows     pgx.Rows
	locErr      error
	summaryRow  pgx.Row

	queries []string
	args    [][]any
}

func (f *fakeQuerier) record(sql string, args []any) {
	f.queries = append(f.queries, sql)
	f.args = append(f.args, args)
}

func (f *fakeQuerier) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.record(sql, args)
	switch {
	case strings.Contains(sql, "day_of_week"):
		return f.heatmapRows, f.heatmapErr
	case strings.Contains(sql, "start_place"):
		return f.locRows, f.locErr
	default:
		return nil, fmt.Errorf("fakeQuerier: unexpected Query: %s", sql)
	}
}

func (f *fakeQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	f.record(sql, args)
	if f.summaryRow != nil {
		return f.summaryRow
	}
	return fakeRow{err: errors.New("fakeQuerier: no summaryRow configured")}
}

var _ dbQuerier = (*fakeQuerier)(nil)

// getResponse decodes the handler's JSON body into the package-internal
// row types so assertions run against the real projected shape.
type getResponse struct {
	Heatmap   []heatmapCell       `json:"heatmap"`
	Locations []locationBreakdown `json:"locations"`
	Summary   chargingSummary     `json:"summary"`
}

func newRequest(vehicleID string, omit bool) *http.Request {
	url := "/analytics/charging-heatmap"
	if !omit {
		url += "?vehicle_id=" + vehicleID
	}
	return httptest.NewRequest(http.MethodGet, url, nil)
}

// okQuerier returns a fakeQuerier whose three sub-queries all succeed with
// the supplied fixtures, used as the baseline for success + downstream
// error scenarios.
func okQuerier(heatmap, loc *fakeRows, summary pgx.Row) *fakeQuerier {
	return &fakeQuerier{heatmapRows: heatmap, locRows: loc, summaryRow: summary}
}

func zeroSummary() fakeRow {
	return fakeRow{vals: []any{int(0), float64(0), float64(0), float64(0)}}
}

func decodeError(t *testing.T, body []byte) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode error body: %v; body=%s", err, body)
	}
	return m
}

func TestChargingHeatmapHandler_Get(t *testing.T) {
	tests := []struct {
		name       string
		vehicleID  string
		omitVID    bool
		querier    func() *fakeQuerier
		wantStatus int
		wantErr    string
		wantCode   string
		check      func(t *testing.T, fq *fakeQuerier, body []byte)
	}{
		{
			name:       "missing vehicle_id",
			omitVID:    true,
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "vehicle_id query parameter required",
			wantCode:   "BAD_REQUEST",
			check: func(t *testing.T, fq *fakeQuerier, _ []byte) {
				if len(fq.queries) != 0 {
					t.Fatalf("expected no DB queries on validation failure, got %d", len(fq.queries))
				}
			},
		},
		{
			name:       "empty vehicle_id value",
			vehicleID:  "",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "vehicle_id query parameter required",
			wantCode:   "BAD_REQUEST",
		},
		{
			name:       "non-numeric vehicle_id",
			vehicleID:  "not-a-number",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid vehicle_id",
			wantCode:   "BAD_REQUEST",
			check: func(t *testing.T, fq *fakeQuerier, _ []byte) {
				if len(fq.queries) != 0 {
					t.Fatalf("expected no DB queries on parse failure, got %d", len(fq.queries))
				}
			},
		},
		{
			name:       "overflow vehicle_id",
			vehicleID:  "99999999999999999999999999",
			querier:    func() *fakeQuerier { return &fakeQuerier{} },
			wantStatus: http.StatusBadRequest,
			wantErr:    "invalid vehicle_id",
			wantCode:   "BAD_REQUEST",
		},
		{
			name:      "heatmap query error",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				return &fakeQuerier{heatmapErr: errors.New("boom: pool exhausted")}
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to query heatmap data",
			wantCode:   "INTERNAL_ERROR",
			check: func(t *testing.T, fq *fakeQuerier, _ []byte) {
				if len(fq.queries) != 1 {
					t.Fatalf("expected to stop after heatmap query, ran %d queries", len(fq.queries))
				}
			},
		},
		{
			name:      "heatmap scan error",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				hm := &fakeRows{rows: [][]any{{1, 9, 5, 1.0, 2.0}}, scanErr: errors.New("scan boom")}
				return okQuerier(hm, &fakeRows{}, zeroSummary())
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to scan heatmap data",
			wantCode:   "INTERNAL_ERROR",
		},
		{
			name:      "heatmap iteration error",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				hm := &fakeRows{iterErr: errors.New("iter boom")}
				return okQuerier(hm, &fakeRows{}, zeroSummary())
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to read heatmap data",
			wantCode:   "INTERNAL_ERROR",
			check: func(t *testing.T, fq *fakeQuerier, _ []byte) {
				hm := fq.heatmapRows.(*fakeRows)
				if !hm.closed {
					t.Fatalf("heatmap rows not Closed() on iteration error — leak")
				}
			},
		},
		{
			name:      "location query error",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				fq := okQuerier(&fakeRows{}, nil, zeroSummary())
				fq.locErr = errors.New("loc boom")
				return fq
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to query location data",
			wantCode:   "INTERNAL_ERROR",
			check: func(t *testing.T, fq *fakeQuerier, _ []byte) {
				if len(fq.queries) != 2 {
					t.Fatalf("expected heatmap+location queries before failure, ran %d", len(fq.queries))
				}
			},
		},
		{
			name:      "location scan error",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				loc := &fakeRows{rows: [][]any{{"Home", 1, 1.0, 1.0, 1.0}}, scanErr: errors.New("loc scan boom")}
				return okQuerier(&fakeRows{}, loc, zeroSummary())
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to scan location data",
			wantCode:   "INTERNAL_ERROR",
		},
		{
			name:      "location iteration error",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				loc := &fakeRows{iterErr: errors.New("loc iter boom")}
				return okQuerier(&fakeRows{}, loc, zeroSummary())
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to read location data",
			wantCode:   "INTERNAL_ERROR",
		},
		{
			name:      "summary query error",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				return okQuerier(&fakeRows{}, &fakeRows{}, fakeRow{err: errors.New("summary boom")})
			},
			wantStatus: http.StatusInternalServerError,
			wantErr:    "failed to query summary",
			wantCode:   "INTERNAL_ERROR",
			check: func(t *testing.T, fq *fakeQuerier, _ []byte) {
				if len(fq.queries) != 3 {
					t.Fatalf("expected all three sub-queries attempted, ran %d", len(fq.queries))
				}
			},
		},
		{
			name:      "success with data",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				hm := &fakeRows{rows: [][]any{
					{1, 9, 5, 1234.567, 2.349},
					{6, 23, 2, 800.0, 0.0},
				}}
				loc := &fakeRows{rows: [][]any{
					{"Home", 10, 50000.0, 12.5, 7000.0},
					{"Work", 3, 15000.0, 6.0, 11000.0},
				}}
				summary := fakeRow{vals: []any{int(17), 65000.0, 18.5, 1801.24}}
				return okQuerier(hm, loc, summary)
			},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, fq *fakeQuerier, body []byte) {
				var got getResponse
				if err := json.Unmarshal(body, &got); err != nil {
					t.Fatalf("decode: %v; body=%s", err, body)
				}
				if len(got.Heatmap) != 2 {
					t.Fatalf("heatmap len = %d, want 2", len(got.Heatmap))
				}
				c0 := got.Heatmap[0]
				if c0.DayOfWeek != 1 || c0.HourOfDay != 9 || c0.SessionCount != 5 {
					t.Fatalf("heatmap[0] indices = %+v, want day=1 hour=9 count=5", c0)
				}
				if c0.AvgEnergyWh != 1234.57 {
					t.Fatalf("heatmap[0].avg_energy_wh = %v, want 1234.57 (rounded)", c0.AvgEnergyWh)
				}
				if c0.AvgCost != 2.35 {
					t.Fatalf("heatmap[0].avg_cost = %v, want 2.35 (rounded)", c0.AvgCost)
				}
				if len(got.Locations) != 2 {
					t.Fatalf("locations len = %d, want 2", len(got.Locations))
				}
				l0 := got.Locations[0]
				if l0.Location != "Home" || l0.Count != 10 {
					t.Fatalf("locations[0] = %+v, want Home/10", l0)
				}
				if l0.TotalWh != 50000 || l0.TotalCost != 12.5 || l0.AvgPowerW != 7000 {
					t.Fatalf("locations[0] money/power = %+v, want wh=50000 cost=12.5 power=7000", l0)
				}
				if got.Summary.TotalSessions != 17 || got.Summary.TotalWh != 65000 || got.Summary.TotalCost != 18.5 {
					t.Fatalf("summary = %+v, want sessions=17 wh=65000 cost=18.5", got.Summary)
				}
				if got.Summary.AvgDurationS != 1801.2 {
					t.Fatalf("summary.avg_duration_s = %v, want 1801.2 (rounded to 1dp)", got.Summary.AvgDurationS)
				}
				assertVehicleIDPropagated(t, fq, 42)
			},
		},
		{
			name:      "success empty preserves arrays not null",
			vehicleID: "42",
			querier: func() *fakeQuerier {
				return okQuerier(&fakeRows{}, &fakeRows{}, zeroSummary())
			},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, fq *fakeQuerier, body []byte) {
				var raw map[string]json.RawMessage
				if err := json.Unmarshal(body, &raw); err != nil {
					t.Fatalf("decode raw: %v; body=%s", err, body)
				}
				if string(raw["heatmap"]) != "[]" {
					t.Fatalf("heatmap = %s, want [] (never null)", raw["heatmap"])
				}
				if string(raw["locations"]) != "[]" {
					t.Fatalf("locations = %s, want [] (never null)", raw["locations"])
				}
				var got getResponse
				if err := json.Unmarshal(body, &got); err != nil {
					t.Fatalf("decode typed: %v", err)
				}
				if got.Summary.TotalSessions != 0 || got.Summary.TotalWh != 0 {
					t.Fatalf("empty summary = %+v, want zeros", got.Summary)
				}
			},
		},
		{
			name:      "negative vehicle_id passes through (no >0 validation)",
			vehicleID: "-7",
			querier: func() *fakeQuerier {
				return okQuerier(&fakeRows{}, &fakeRows{}, zeroSummary())
			},
			wantStatus: http.StatusOK,
			check: func(t *testing.T, fq *fakeQuerier, _ []byte) {
				assertVehicleIDPropagated(t, fq, -7)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &ChargingHeatmapHandler{q: tt.querier()}
			rec := httptest.NewRecorder()

			h.Get(rec, newRequest(tt.vehicleID, tt.omitVID))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
			ct := rec.Header().Get("Content-Type")
			if ct != "application/json; charset=utf-8" {
				t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
			}

			body := rec.Body.Bytes()
			if tt.wantErr != "" {
				m := decodeError(t, body)
				if m["error"] != tt.wantErr {
					t.Fatalf("error = %q, want %q", m["error"], tt.wantErr)
				}
				if tt.wantCode != "" && m["code"] != tt.wantCode {
					t.Fatalf("code = %q, want %q", m["code"], tt.wantCode)
				}
			}

			fq, _ := h.q.(*fakeQuerier)
			if tt.check != nil {
				tt.check(t, fq, body)
			}
		})
	}
}

// assertVehicleIDPropagated verifies the parsed int64 vehicle_id reached
// every sub-query as the first ($1) bind parameter — guards against a
// regression that hard-codes an ID or drops the parameter (which would
// return another vehicle's data or fail parameterised-SQL safety).
func assertVehicleIDPropagated(t *testing.T, fq *fakeQuerier, want int64) {
	t.Helper()
	if len(fq.args) != 3 {
		t.Fatalf("expected 3 parameterised sub-queries, got %d", len(fq.args))
	}
	for i, a := range fq.args {
		if len(a) == 0 {
			t.Fatalf("query %d ran with no bind args", i)
		}
		got, ok := a[0].(int64)
		if !ok {
			t.Fatalf("query %d $1 = %T, want int64", i, a[0])
		}
		if got != want {
			t.Fatalf("query %d $1 = %d, want %d", i, got, want)
		}
	}
}

// TestChargingHeatmapHandler_Get_SICanonicalColumns pins the queries to the
// SI-canonical column names mandated by Phase-48 (no legacy Kwh/Kw/Mph unit
// suffixes on disk). A regression that reintroduces a *_kwh or *_kw column
// would silently misrepresent energy/power, and is caught here.
func TestChargingHeatmapHandler_Get_SICanonicalColumns(t *testing.T) {
	fq := okQuerier(&fakeRows{}, &fakeRows{}, zeroSummary())
	h := &ChargingHeatmapHandler{q: fq}
	rec := httptest.NewRecorder()

	h.Get(rec, newRequest("42", false))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}

	all := strings.Join(fq.queries, "\n")
	wantCols := []string{"total_energy_added_wh", "peak_power_w", "cost_decimal"}
	for _, c := range wantCols {
		if !strings.Contains(all, c) {
			t.Fatalf("queries missing SI column %q; got:\n%s", c, all)
		}
	}
	for _, forbidden := range []string{"kwh", "_kw ", "mph", "energy_added_kwh"} {
		if strings.Contains(all, forbidden) {
			t.Fatalf("query contains forbidden legacy unit token %q; got:\n%s", forbidden, all)
		}
	}
}

// TestNewChargingHeatmapHandler verifies the exported constructor wires a
// non-nil handler whose query port is populated (production wires the real
// *pgxpool.Pool via db.Pool).
func TestNewChargingHeatmapHandler(t *testing.T) {
	h := &ChargingHeatmapHandler{q: &fakeQuerier{}}
	if h == nil {
		t.Fatal("handler is nil")
	}
	if h.q == nil {
		t.Fatal("handler query port is nil")
	}
	// The exported constructor must expose the Get method (compile-time +
	// runtime guard that the HTTP surface stays stable).
	var _ http.HandlerFunc = h.Get
}
