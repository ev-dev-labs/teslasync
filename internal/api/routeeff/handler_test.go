package routeeff

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

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// TestMain silences the global zerolog logger so the intentional
// error-path logs (query failures, scan failures) don't clutter test
// output. Set once before any test runs — no parallel write race.
func TestMain(m *testing.M) {
	zerolog.SetGlobalLevel(zerolog.Disabled)
	m.Run()
}

// ---------------------------------------------------------------------------
// Fake pgx plumbing. The codebase does not vendor pgxmock (see chargeopt /
// mileage / vehicle-states repos for the same precedent); the handler talks
// to a local routeQuerier interface so tests can supply a scripted row source
// without a live database.
// ---------------------------------------------------------------------------

// fakeRows is a scripted pgx.Rows. Each element of data is one row's column
// values, positionally matching the handler's Scan destinations. A SQL NULL
// is expressed as a nil entry for a nullable (pointer) destination.
type fakeRows struct {
	data      [][]any
	idx       int
	scanErr   error // returned by Scan when idx == scanErrAt
	scanErrAt int   // 1-based row at which Scan fails; 0 = never
	errVal    error // returned by Err() to simulate mid-stream iteration failure
	closed    bool
}

func (r *fakeRows) Next() bool {
	if r.idx >= len(r.data) {
		return false
	}
	r.idx++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	if r.scanErr != nil && r.idx == r.scanErrAt {
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

// assignScan copies scripted values into the handler's Scan destinations,
// mimicking pgx's per-type scanning (including NULL → nil pointer).
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
		case *int64:
			n, ok := v.(int64)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *int64", i, v)
			}
			*p = n
		case *float64:
			f, ok := v.(float64)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *float64", i, v)
			}
			*p = f
		case *time.Time:
			t, ok := v.(time.Time)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into *time.Time", i, v)
			}
			*p = t
		case **float64:
			// Nullable float column: nil entry ⇒ SQL NULL ⇒ nil pointer.
			if v == nil {
				*p = nil
				continue
			}
			f, ok := v.(float64)
			if !ok {
				return fmt.Errorf("col %d: cannot scan %T into **float64", i, v)
			}
			nf := f
			*p = &nf
		default:
			return fmt.Errorf("col %d: unsupported destination type %T", i, d)
		}
	}
	return nil
}

// fakePool records the SQL + args it was asked to run and returns the
// scripted rows (or a query error).
type fakePool struct {
	rows     pgx.Rows
	queryErr error
	gotSQL   string
	gotArgs  []any
	calls    int
}

func (p *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.calls++
	p.gotSQL = sql
	p.gotArgs = args
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	return p.rows, nil
}

var _ routeQuerier = (*fakePool)(nil)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func newHandler(pool routeQuerier) *RouteEfficiencyHandler {
	return &RouteEfficiencyHandler{db: pool}
}

func listReq(query string) *http.Request {
	return httptest.NewRequest(http.MethodGet, "/analytics/route-efficiency?"+query, nil)
}

func detailReq(query string) *http.Request {
	return httptest.NewRequest(http.MethodGet, "/analytics/route-efficiency/detail?"+query, nil)
}

func decodeErrBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body: %v (body=%q)", err, rec.Body.String())
	}
	return m
}

type listResponse struct {
	Routes []routeSummary `json:"routes"`
}

type detailResponse struct {
	Drives []routeDriveDetail `json:"drives"`
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

func TestNewRouteEfficiencyHandler_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil *database.DB")
		}
	}()
	_ = NewRouteEfficiencyHandler(nil)
}

func TestNewRouteEfficiencyHandler_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil pool")
		}
	}()
	_ = NewRouteEfficiencyHandler(&database.DB{})
}

// ---------------------------------------------------------------------------
// List — validation (no data layer reached)
// ---------------------------------------------------------------------------

func TestList_Validation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		query   string
		wantMsg string
	}{
		{"missing vehicle_id", "", "vehicle_id query parameter required"},
		{"empty vehicle_id", "vehicle_id=", "vehicle_id query parameter required"},
		{"non-numeric vehicle_id", "vehicle_id=abc", "invalid vehicle_id"},
		{"zero vehicle_id", "vehicle_id=0", "invalid vehicle_id"},
		{"negative vehicle_id", "vehicle_id=-5", "invalid vehicle_id"},
		{"overflow vehicle_id", "vehicle_id=99999999999999999999", "invalid vehicle_id"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{rows: &fakeRows{}}
			rec := httptest.NewRecorder()
			newHandler(pool).List(rec, listReq(tc.query))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
			body := decodeErrBody(t, rec)
			if body["error"] != tc.wantMsg {
				t.Errorf("error = %q, want %q", body["error"], tc.wantMsg)
			}
			if body["code"] != "BAD_REQUEST" {
				t.Errorf("code = %q, want BAD_REQUEST", body["code"])
			}
			if pool.calls != 0 {
				t.Errorf("data layer reached (%d Query calls) on invalid input", pool.calls)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// List — data-layer error paths
// ---------------------------------------------------------------------------

func TestList_ErrorPaths(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("boom")
	tests := []struct {
		name    string
		rows    *fakeRows
		queryEr error
		wantMsg string
	}{
		{
			name:    "query error",
			queryEr: sentinel,
			wantMsg: "failed to query route efficiency",
		},
		{
			name:    "scan error",
			rows:    &fakeRows{data: [][]any{{"A", "B", 1, nil, nil, nil, nil, nil, nil, nil}}, scanErr: sentinel, scanErrAt: 1},
			wantMsg: "failed to scan route data",
		},
		{
			name:    "rows iteration error",
			rows:    &fakeRows{data: [][]any{{"A", "B", 1, nil, nil, nil, nil, nil, nil, nil}}, errVal: sentinel},
			wantMsg: "failed to read route data",
		},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryErr: tc.queryEr}
			if tc.rows != nil {
				pool.rows = tc.rows
			}
			rec := httptest.NewRecorder()
			newHandler(pool).List(rec, listReq("vehicle_id=42"))

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
			}
			body := decodeErrBody(t, rec)
			if body["error"] != tc.wantMsg {
				t.Errorf("error = %q, want %q", body["error"], tc.wantMsg)
			}
			if body["code"] != "INTERNAL_ERROR" {
				t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
			}
			if tc.rows != nil && !tc.rows.closed {
				t.Error("rows.Close() was not called (leaked cursor)")
			}
		})
	}
}

// ---------------------------------------------------------------------------
// List — empty result returns [] not null
// ---------------------------------------------------------------------------

func TestList_Empty(t *testing.T) {
	t.Parallel()
	pool := &fakePool{rows: &fakeRows{}}
	rec := httptest.NewRecorder()
	newHandler(pool).List(rec, listReq("vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q", ct)
	}
	if !strings.Contains(rec.Body.String(), `"routes":[]`) {
		t.Errorf("empty response should serialize routes as [], got %q", rec.Body.String())
	}
	var resp listResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Routes == nil {
		t.Error("routes decoded as nil; want non-nil empty slice")
	}
	if len(resp.Routes) != 0 {
		t.Errorf("len(routes) = %d, want 0", len(resp.Routes))
	}
}

// ---------------------------------------------------------------------------
// List — happy path: rounding + NULL-aggregate handling
// ---------------------------------------------------------------------------

func TestList_HappyPath(t *testing.T) {
	t.Parallel()
	rows := &fakeRows{data: [][]any{
		// start, end, trip, avgDist, avgDur, avgEff, bestEff, worstEff, avgSpd, avgTemp
		{"Home", "Work", 3, 12.3456, 1234.5678, 5.6789, 1.2345, 9.8765, 42.345, 21.66},
		// A route whose aggregates are all NULL must default cleanly to 0.
		{"Gym", "Home", 1, nil, nil, nil, nil, nil, nil, nil},
	}}
	pool := &fakePool{rows: rows}
	rec := httptest.NewRecorder()
	newHandler(pool).List(rec, listReq("vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	var resp listResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Routes) != 2 {
		t.Fatalf("len(routes) = %d, want 2", len(resp.Routes))
	}

	got := resp.Routes[0]
	want := routeSummary{
		StartLocation:   "Home",
		EndLocation:     "Work",
		TripCount:       3,
		AvgDistanceKm:   12.35,   // round2
		AvgDurationS:    1234.57, // round2
		AvgEfficiency:   5.68,    // round2
		BestEfficiency:  1.23,    // round2
		WorstEfficiency: 9.88,    // round2
		AvgSpeed:        42.3,    // round1
		AvgTemp:         21.7,    // round1
	}
	if got != want {
		t.Errorf("route[0] = %+v\nwant %+v", got, want)
	}

	null := resp.Routes[1]
	if null.StartLocation != "Gym" || null.EndLocation != "Home" || null.TripCount != 1 {
		t.Errorf("route[1] identity = %+v", null)
	}
	if null.AvgDistanceKm != 0 || null.AvgDurationS != 0 || null.AvgEfficiency != 0 ||
		null.BestEfficiency != 0 || null.WorstEfficiency != 0 || null.AvgSpeed != 0 || null.AvgTemp != 0 {
		t.Errorf("route[1] NULL aggregates should be 0, got %+v", null)
	}
	if !rows.closed {
		t.Error("rows.Close() was not called")
	}
}

// ---------------------------------------------------------------------------
// List — query argument wiring (vehicle id, unit constants, date range)
// ---------------------------------------------------------------------------

func TestList_QueryArgs(t *testing.T) {
	t.Parallel()

	t.Run("no date range → NULL time bounds", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{rows: &fakeRows{}}
		rec := httptest.NewRecorder()
		newHandler(pool).List(rec, listReq("vehicle_id=7"))

		if pool.calls != 1 {
			t.Fatalf("Query calls = %d, want 1", pool.calls)
		}
		if len(pool.gotArgs) != 6 {
			t.Fatalf("len(args) = %d, want 6 (%v)", len(pool.gotArgs), pool.gotArgs)
		}
		if pool.gotArgs[0] != int64(7) {
			t.Errorf("args[0] = %v, want int64(7)", pool.gotArgs[0])
		}
		if pool.gotArgs[1] != float64(routeEffMetersPerMile) {
			t.Errorf("args[1] = %v, want metersPerMile", pool.gotArgs[1])
		}
		if pool.gotArgs[2] != float64(routeEffMpsPerMph) {
			t.Errorf("args[2] = %v, want mpsPerMph", pool.gotArgs[2])
		}
		if pool.gotArgs[3] != float64(routeEffMetersPerMile) {
			t.Errorf("args[3] = %v, want metersPerMile", pool.gotArgs[3])
		}
		if pool.gotArgs[4] != nil || pool.gotArgs[5] != nil {
			t.Errorf("date bounds = (%v, %v), want (nil, nil)", pool.gotArgs[4], pool.gotArgs[5])
		}
	})

	t.Run("date range → time.Time bounds", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{rows: &fakeRows{}}
		rec := httptest.NewRecorder()
		newHandler(pool).List(rec, listReq("vehicle_id=7&start=2024-01-01&end=2024-01-31"))

		if len(pool.gotArgs) != 6 {
			t.Fatalf("len(args) = %d, want 6", len(pool.gotArgs))
		}
		if _, ok := pool.gotArgs[4].(time.Time); !ok {
			t.Errorf("args[4] = %T, want time.Time", pool.gotArgs[4])
		}
		if _, ok := pool.gotArgs[5].(time.Time); !ok {
			t.Errorf("args[5] = %T, want time.Time", pool.gotArgs[5])
		}
	})
}

// ---------------------------------------------------------------------------
// List — SQL shape: SI-canonical columns, no snapshot tables, ordering/limit
// ---------------------------------------------------------------------------

func TestList_SQLShape(t *testing.T) {
	t.Parallel()
	pool := &fakePool{rows: &fakeRows{}}
	rec := httptest.NewRecorder()
	newHandler(pool).List(rec, listReq("vehicle_id=1"))

	sql := pool.gotSQL
	mustContain := []string{
		"FROM drives",
		"vehicle_id = $1",
		"distance_m",    // SI meters
		"duration_s",    // SI seconds
		"avg_speed_mps", // SI m/s
		"start_soc_pct", // SI percent
		"end_soc_pct",   //
		"ambient_temp_c_avg",
		"GROUP BY start_label, end_label",
		"ORDER BY COUNT(*) DESC",
		"LIMIT 15",
		"$5::timestamptz IS NULL OR started_at BETWEEN $5 AND $6",
	}
	for _, frag := range mustContain {
		if !strings.Contains(sql, frag) {
			t.Errorf("List SQL missing %q\n---\n%s", frag, sql)
		}
	}
	// Layered live-state contract + SI-on-disk: never read snapshot tables and
	// never resurrect legacy display-unit column names.
	mustNotContain := []string{
		"FROM positions",
		"FROM climate_snapshots",
		"distance_mi",
		"avg_speed_mph",
		"duration_min",
		"energy_used_kwh",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(sql, frag) {
			t.Errorf("List SQL must not contain %q\n---\n%s", frag, sql)
		}
	}
}

// ---------------------------------------------------------------------------
// Detail — validation
// ---------------------------------------------------------------------------

func TestDetail_Validation(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		query   string
		wantMsg string
	}{
		{"missing vehicle_id", "start=A&end=B", "vehicle_id query parameter required"},
		{"non-numeric vehicle_id", "vehicle_id=abc&start=A&end=B", "invalid vehicle_id"},
		{"zero vehicle_id", "vehicle_id=0&start=A&end=B", "invalid vehicle_id"},
		{"negative vehicle_id", "vehicle_id=-1&start=A&end=B", "invalid vehicle_id"},
		{"missing start", "vehicle_id=42&end=B", "start and end query parameters required"},
		{"missing end", "vehicle_id=42&start=A", "start and end query parameters required"},
		{"missing both", "vehicle_id=42", "start and end query parameters required"},
		{"empty start", "vehicle_id=42&start=&end=B", "start and end query parameters required"},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{rows: &fakeRows{}}
			rec := httptest.NewRecorder()
			newHandler(pool).Detail(rec, detailReq(tc.query))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
			body := decodeErrBody(t, rec)
			if body["error"] != tc.wantMsg {
				t.Errorf("error = %q, want %q", body["error"], tc.wantMsg)
			}
			if pool.calls != 0 {
				t.Errorf("data layer reached (%d Query calls) on invalid input", pool.calls)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Detail — data-layer error paths
// ---------------------------------------------------------------------------

func TestDetail_ErrorPaths(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("boom")
	// One well-formed detail row for the scan-error / iteration-error cases.
	okRow := []any{int64(1), time.Now(), 10.0, 100.0, 5.0, 80.0, 60.0, 20.0, 3.0}
	tests := []struct {
		name    string
		rows    *fakeRows
		queryEr error
		wantMsg string
	}{
		{
			name:    "query error",
			queryEr: sentinel,
			wantMsg: "failed to query route detail",
		},
		{
			name:    "scan error",
			rows:    &fakeRows{data: [][]any{okRow}, scanErr: sentinel, scanErrAt: 1},
			wantMsg: "failed to scan route detail",
		},
		{
			name:    "rows iteration error",
			rows:    &fakeRows{data: [][]any{okRow}, errVal: sentinel},
			wantMsg: "failed to read route detail",
		},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryErr: tc.queryEr}
			if tc.rows != nil {
				pool.rows = tc.rows
			}
			rec := httptest.NewRecorder()
			newHandler(pool).Detail(rec, detailReq("vehicle_id=42&start=A&end=B"))

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
			}
			body := decodeErrBody(t, rec)
			if body["error"] != tc.wantMsg {
				t.Errorf("error = %q, want %q", body["error"], tc.wantMsg)
			}
			if body["code"] != "INTERNAL_ERROR" {
				t.Errorf("code = %q, want INTERNAL_ERROR", body["code"])
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Detail — empty result returns [] not null
// ---------------------------------------------------------------------------

func TestDetail_Empty(t *testing.T) {
	t.Parallel()
	pool := &fakePool{rows: &fakeRows{}}
	rec := httptest.NewRecorder()
	newHandler(pool).Detail(rec, detailReq("vehicle_id=42&start=A&end=B"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"drives":[]`) {
		t.Errorf("empty response should serialize drives as [], got %q", rec.Body.String())
	}
	var resp detailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Drives == nil {
		t.Error("drives decoded as nil; want non-nil empty slice")
	}
}

// ---------------------------------------------------------------------------
// Detail — happy path: rounding + nullable pointer defaults
// ---------------------------------------------------------------------------

func TestDetail_HappyPath(t *testing.T) {
	t.Parallel()
	start := time.Date(2024, 3, 2, 15, 4, 5, 0, time.UTC)
	rows := &fakeRows{data: [][]any{
		// id, started_at, distance_mi, duration_s, avg_speed_mps, start_soc, end_soc, temp, eff
		{int64(7), start, 15.678, 1800.4, 12.344, 80.46, 60.53, 19.44, 5.678},
	}}
	pool := &fakePool{rows: rows}
	rec := httptest.NewRecorder()
	newHandler(pool).Detail(rec, detailReq("vehicle_id=42&start=Home&end=Work"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	var resp detailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Drives) != 1 {
		t.Fatalf("len(drives) = %d, want 1", len(resp.Drives))
	}
	got := resp.Drives[0]
	want := routeDriveDetail{
		ID:             7,
		StartDate:      start.Format(time.RFC3339),
		Distance:       15.68, // round2 (15.678 → 15.68)
		DurationS:      1800,  // round to integer seconds (1800.4 → 1800)
		SpeedAvgMps:    12.34, // round2 (12.344 → 12.34)
		StartSocPct:    80.5,  // round1 (80.46 → 80.5)
		EndSocPct:      60.5,  // round1 (60.53 → 60.5)
		OutsideTempAvg: 19.4,  // round1 (19.44 → 19.4)
		Efficiency:     5.68,  // round2 (5.678 → 5.68)
	}
	if got != want {
		t.Errorf("drive[0] = %+v\nwant %+v", got, want)
	}
	if !rows.closed {
		t.Error("rows.Close() was not called")
	}
}

// TestDetail_NullDuration is the regression guard for the fixed bug: a drive
// with distance but a NULL duration_s used to fail the whole request when
// scanned into a non-pointer float64. It must now yield DurationS=0 and 200.
func TestDetail_NullDuration(t *testing.T) {
	t.Parallel()
	start := time.Date(2024, 5, 1, 8, 0, 0, 0, time.UTC)
	rows := &fakeRows{data: [][]any{
		// duration_s (col 3) is NULL; all other nullable metrics NULL too.
		{int64(9), start, 20.0, nil, nil, nil, nil, nil, nil},
	}}
	pool := &fakePool{rows: rows}
	rec := httptest.NewRecorder()
	newHandler(pool).Detail(rec, detailReq("vehicle_id=42&start=A&end=B"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	var resp detailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Drives) != 1 {
		t.Fatalf("len(drives) = %d, want 1", len(resp.Drives))
	}
	got := resp.Drives[0]
	if got.ID != 9 {
		t.Errorf("id = %d, want 9", got.ID)
	}
	if got.Distance != 20.0 {
		t.Errorf("distance = %v, want 20", got.Distance)
	}
	if got.DurationS != 0 {
		t.Errorf("DurationS = %v, want 0 for NULL duration_s", got.DurationS)
	}
	if got.SpeedAvgMps != 0 || got.StartSocPct != 0 || got.EndSocPct != 0 ||
		got.OutsideTempAvg != 0 || got.Efficiency != 0 {
		t.Errorf("NULL metrics should default to 0, got %+v", got)
	}
}

// ---------------------------------------------------------------------------
// Detail — query args + SQL shape
// ---------------------------------------------------------------------------

func TestDetail_QueryArgs(t *testing.T) {
	t.Parallel()
	pool := &fakePool{rows: &fakeRows{}}
	rec := httptest.NewRecorder()
	newHandler(pool).Detail(rec, detailReq("vehicle_id=7&start=Home&end=Work"))

	if pool.calls != 1 {
		t.Fatalf("Query calls = %d, want 1", pool.calls)
	}
	if len(pool.gotArgs) != 4 {
		t.Fatalf("len(args) = %d, want 4 (%v)", len(pool.gotArgs), pool.gotArgs)
	}
	if pool.gotArgs[0] != int64(7) {
		t.Errorf("args[0] = %v, want int64(7)", pool.gotArgs[0])
	}
	if pool.gotArgs[1] != float64(routeEffMetersPerMile) {
		t.Errorf("args[1] = %v, want metersPerMile", pool.gotArgs[1])
	}
	if pool.gotArgs[2] != "Home" {
		t.Errorf("args[2] = %v, want Home", pool.gotArgs[2])
	}
	if pool.gotArgs[3] != "Work" {
		t.Errorf("args[3] = %v, want Work", pool.gotArgs[3])
	}
}

func TestDetail_SQLShape(t *testing.T) {
	t.Parallel()
	pool := &fakePool{rows: &fakeRows{}}
	rec := httptest.NewRecorder()
	newHandler(pool).Detail(rec, detailReq("vehicle_id=1&start=A&end=B"))

	sql := pool.gotSQL
	mustContain := []string{
		"FROM drives",
		"FROM labeled",
		"vehicle_id = $1",
		"distance_m",
		"duration_s",
		"avg_speed_mps",
		"start_soc_pct",
		"end_soc_pct",
		"ambient_temp_c_avg",
		"start_label = $3 AND end_label = $4",
		"ORDER BY started_at DESC",
		"LIMIT 20",
	}
	for _, frag := range mustContain {
		if !strings.Contains(sql, frag) {
			t.Errorf("Detail SQL missing %q\n---\n%s", frag, sql)
		}
	}
	for _, frag := range []string{"FROM positions", "FROM climate_snapshots"} {
		if strings.Contains(sql, frag) {
			t.Errorf("Detail SQL must not read snapshot table %q\n---\n%s", frag, sql)
		}
	}
}
