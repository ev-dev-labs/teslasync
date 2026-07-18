package segments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// TestMain silences the global zerolog logger so the intentional error-path
// logs (query failures, best-effort persist failures) don't clutter output.
func TestMain(m *testing.M) {
	zerolog.SetGlobalLevel(zerolog.Disabled)
	m.Run()
}

// ---------------------------------------------------------------------------
// Fake pgx plumbing. The module vendors no pgxmock (see carbon / routeeff /
// timemachine for the same precedent); the handler talks to a local segQuerier
// seam so tests supply scripted rows/row sources in call order without a live
// database.
// ---------------------------------------------------------------------------

// assignScan copies scripted column values into Scan destinations, mirroring
// pgx's per-type scanning generically via reflection (allocating for nullable
// pointer fields). Same helper shape as the carbon / batterypassport tests.
func assignScan(dest, vals []any) error {
	if len(dest) != len(vals) {
		return fmt.Errorf("scan: %d destinations but row has %d values", len(dest), len(vals))
	}
	for i := range dest {
		dv := reflect.ValueOf(dest[i])
		if dv.Kind() != reflect.Pointer || dv.IsNil() {
			return fmt.Errorf("scan: destination %d is not a non-nil pointer (%T)", i, dest[i])
		}
		target := dv.Elem()
		if !target.CanSet() {
			return fmt.Errorf("scan: destination %d (%s) is not settable", i, target.Type())
		}
		v := vals[i]
		if v == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		rv := reflect.ValueOf(v)
		if target.Kind() == reflect.Pointer {
			et := target.Type().Elem()
			switch {
			case rv.Type().AssignableTo(et):
				p := reflect.New(et)
				p.Elem().Set(rv)
				target.Set(p)
			case rv.Type().ConvertibleTo(et):
				p := reflect.New(et)
				p.Elem().Set(rv.Convert(et))
				target.Set(p)
			default:
				return fmt.Errorf("scan: cannot assign %T into nullable destination %d (%s)", v, i, target.Type())
			}
			continue
		}
		switch {
		case rv.Type().AssignableTo(target.Type()):
			target.Set(rv)
		case rv.Type().ConvertibleTo(target.Type()):
			target.Set(rv.Convert(target.Type()))
		default:
			return fmt.Errorf("scan: cannot assign %T into destination %d (%s)", v, i, target.Type())
		}
	}
	return nil
}

// fakeRow is a scripted pgx.Row for QueryRow calls (segment / drive header /
// upsert RETURNING id).
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

// fakeRows is a scripted pgx.Rows. Each element of data is one row's column
// values, positionally matching the handler's Scan destinations.
type fakeRows struct {
	data      [][]any
	idx       int
	scanErr   error // returned by Scan when idx == scanErrAt
	scanErrAt int   // 1-based row at which Scan fails; 0 = never
	iterErr   error // returned by Err() to simulate mid-stream iteration failure
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
func (r *fakeRows) Err() error                                   { return r.iterErr }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeRows)(nil)

// queryResult is one scripted Query outcome (rows OR an error).
type queryResult struct {
	rows pgx.Rows
	err  error
}

// fakePool returns scripted Query results in call order and scripted QueryRow
// results in call order, and records the SQL/args it saw so tests can pin the
// critical clauses. Query and QueryRow advance independent cursors, which is
// exactly how the handlers interleave them (e.g. ghost: QueryRow segment,
// QueryRow drive, Query telemetry, ...).
type fakePool struct {
	queryResults []queryResult
	queryIdx     int

	queryRowResults []pgx.Row
	queryRowIdx     int

	querySQLs    []string
	queryArgs    [][]any
	queryRowSQLs []string
	queryRowArgs [][]any
}

func (p *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.querySQLs = append(p.querySQLs, sql)
	p.queryArgs = append(p.queryArgs, args)
	if p.queryIdx >= len(p.queryResults) {
		return nil, fmt.Errorf("fakePool: unexpected Query call #%d: %q", p.queryIdx+1, sql)
	}
	qr := p.queryResults[p.queryIdx]
	p.queryIdx++
	if qr.err != nil {
		return nil, qr.err
	}
	return qr.rows, nil
}

func (p *fakePool) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	p.queryRowSQLs = append(p.queryRowSQLs, sql)
	p.queryRowArgs = append(p.queryRowArgs, args)
	if p.queryRowIdx >= len(p.queryRowResults) {
		return fakeRow{err: errors.New("fakePool: unexpected QueryRow call")}
	}
	row := p.queryRowResults[p.queryRowIdx]
	p.queryRowIdx++
	return row
}

var _ segQuerier = (*fakePool)(nil)

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

func testHandler(pool segQuerier) *Handler { return &Handler{db: pool} }

var tBase = time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)

// driveVals scripts one candidate-drives row in the handler's exact Scan order:
// id, started_at, start_lat, start_lng, end_lat, end_lng, start_place,
// end_place, distance_m, duration_s (int64), energy_used_wh (nullable).
func driveVals(id int64, offsetH int, sLat, sLon, eLat, eLon, distM float64, durS int64, place string, energy any) []any {
	return []any{
		id,
		tBase.Add(time.Duration(offsetH) * time.Hour),
		sLat, sLon, eLat, eLon,
		place, place,
		distM, durS, energy,
	}
}

// segVals scripts a loadSegment row: id, vehicle_id, name, start_lat, start_lon,
// end_lat, end_lon, radius_m.
func segVals(id, veh int64, name string, sLat, sLon, eLat, eLon, radius float64) []any {
	return []any{id, veh, name, sLat, sLon, eLat, eLon, radius}
}

// driveHeaderVals scripts a loadDrive row: started_at, duration_s (nullable
// int64), distance_m (nullable), energy_used_wh (nullable).
func driveHeaderVals(started time.Time, durS int64, distM, energy float64) []any {
	return []any{started, durS, distM, energy}
}

// telemetryRows scripts a drive_telemetry track (ts, speed_mps) for the ghost
// series, evenly spaced from the drive start.
func telemetryRows(started time.Time, speeds ...float64) *fakeRows {
	data := make([][]any, 0, len(speeds))
	for i, s := range speeds {
		data = append(data, []any{started.Add(time.Duration(i*10) * time.Second), s})
	}
	return &fakeRows{data: data}
}

func segmentsReq(vehicleID string) *http.Request {
	return reqWithParams(
		httptest.NewRequest(http.MethodGet, "/vehicles/"+vehicleID+"/segments", nil),
		map[string]string{"vehicleID": vehicleID},
	)
}

func leaderboardReq(segmentID string) *http.Request {
	return reqWithParams(
		httptest.NewRequest(http.MethodGet, "/segments/"+segmentID+"/leaderboard", nil),
		map[string]string{"segmentID": segmentID},
	)
}

func ghostReq(segmentID, query string) *http.Request {
	url := "/segments/" + segmentID + "/ghost"
	if query != "" {
		url += "?" + query
	}
	return reqWithParams(
		httptest.NewRequest(http.MethodGet, url, nil),
		map[string]string{"segmentID": segmentID},
	)
}

func reqWithParams(r *http.Request, kv map[string]string) *http.Request {
	rctx := chi.NewRouteContext()
	for k, v := range kv {
		rctx.URLParams.Add(k, v)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func decodeErr(t *testing.T, rec *httptest.ResponseRecorder) map[string]string {
	t.Helper()
	var m map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("decode error body: %v (body=%q)", err, rec.Body.String())
	}
	return m
}

func decodeInto[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode body: %v (body=%q)", err, rec.Body.String())
	}
	return v
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

func TestNewSegmentsHandler_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil *database.DB")
		}
	}()
	_ = NewSegmentsHandler(nil)
}

func TestNewSegmentsHandler_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil pool")
		}
	}()
	_ = NewSegmentsHandler(&database.DB{})
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

func TestList_HappyPath(t *testing.T) {
	t.Parallel()
	// Two drives sharing a Home -> Work segment (~11 m apart at both ends).
	drives := &fakeRows{data: [][]any{
		driveVals(1, 0, 0, 0.0000, 0, 0.0100, 1000, 300, "Home", 2000.0),
		driveVals(2, 1, 0, 0.0001, 0, 0.0101, 1000, 200, "Home", 1500.0),
	}}
	pool := &fakePool{
		queryResults:    []queryResult{{rows: drives}},
		queryRowResults: []pgx.Row{fakeRow{vals: []any{int64(77)}}}, // upsert RETURNING id
	}

	rec := httptest.NewRecorder()
	testHandler(pool).List(rec, segmentsReq("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[SegmentsResponse](t, rec)
	if len(got.Segments) != 1 {
		t.Fatalf("segments = %d, want 1", len(got.Segments))
	}
	s := got.Segments[0]
	if s.ID != 77 {
		t.Fatalf("segment id = %d, want 77 (from upsert RETURNING)", s.ID)
	}
	if s.AttemptCount != 2 {
		t.Fatalf("attempt_count = %d, want 2", s.AttemptCount)
	}
	if s.BestTime == nil || s.BestTime.DriveID != 2 {
		t.Fatalf("best_time = %+v, want fastest drive 2", s.BestTime)
	}
	if s.Latest == nil || s.Latest.DriveID != 2 {
		t.Fatalf("latest = %+v, want most-recent drive 2", s.Latest)
	}
	if s.BestEfficiency == nil || s.BestEfficiency.DriveID != 2 {
		t.Fatalf("best_efficiency = %+v, want most-efficient drive 2", s.BestEfficiency)
	}
	// The candidate-drive read is parameterised by vehicle + min distance.
	if len(pool.queryArgs) == 0 || pool.queryArgs[0][0].(int64) != 42 {
		t.Fatalf("candidate query vehicle arg = %v, want 42", pool.queryArgs)
	}
	// The persist is an idempotent UPSERT on the endpoint anchor.
	if len(pool.queryRowSQLs) != 1 || !strings.Contains(pool.queryRowSQLs[0], "ON CONFLICT") {
		t.Fatalf("expected one ON CONFLICT upsert, got %v", pool.queryRowSQLs)
	}
}

func TestList_EmptyWhenNoRepeat(t *testing.T) {
	t.Parallel()
	// A single drive never reaches the >=2-attempt threshold.
	drives := &fakeRows{data: [][]any{
		driveVals(1, 0, 0, 0, 0, 0.01, 1000, 300, "Home", 2000.0),
	}}
	pool := &fakePool{queryResults: []queryResult{{rows: drives}}}

	rec := httptest.NewRecorder()
	testHandler(pool).List(rec, segmentsReq("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[SegmentsResponse](t, rec)
	if got.Segments == nil {
		t.Fatal("segments is null, want [] (non-nil empty array)")
	}
	if len(got.Segments) != 0 {
		t.Fatalf("segments = %d, want 0", len(got.Segments))
	}
	if pool.queryRowIdx != 0 {
		t.Fatalf("upsert calls = %d, want 0 (nothing to persist)", pool.queryRowIdx)
	}
}

func TestList_InvalidVehicleID(t *testing.T) {
	t.Parallel()
	pool := &fakePool{}
	rec := httptest.NewRecorder()
	testHandler(pool).List(rec, segmentsReq("0"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if got := decodeErr(t, rec)["error"]; got == "" {
		t.Fatal("expected a non-empty error message")
	}
	if pool.queryIdx != 0 {
		t.Fatal("expected no DB access on a rejected vehicle ID")
	}
}

func TestList_QueryError(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryResults: []queryResult{{err: errors.New("connection reset")}}}
	rec := httptest.NewRecorder()
	testHandler(pool).List(rec, segmentsReq("42"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestList_ScanError(t *testing.T) {
	t.Parallel()
	drives := &fakeRows{
		data:      [][]any{driveVals(1, 0, 0, 0, 0, 0.01, 1000, 300, "Home", 2000.0)},
		scanErr:   errors.New("bad column type"),
		scanErrAt: 1,
	}
	pool := &fakePool{queryResults: []queryResult{{rows: drives}}}
	rec := httptest.NewRecorder()
	testHandler(pool).List(rec, segmentsReq("42"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestList_PersistFailureIsBestEffort(t *testing.T) {
	t.Parallel()
	before := SegmentPersistFailures()

	drives := &fakeRows{data: [][]any{
		driveVals(1, 0, 0, 0.0000, 0, 0.0100, 1000, 300, "Home", 2000.0),
		driveVals(2, 1, 0, 0.0001, 0, 0.0101, 1000, 200, "Home", 1500.0),
	}}
	pool := &fakePool{
		queryResults:    []queryResult{{rows: drives}},
		queryRowResults: []pgx.Row{fakeRow{err: errors.New("unique violation")}}, // upsert fails
	}

	rec := httptest.NewRecorder()
	testHandler(pool).List(rec, segmentsReq("42"))

	// The read still succeeds and returns the computed segment (with id 0).
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 despite persist failure (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[SegmentsResponse](t, rec)
	if len(got.Segments) != 1 {
		t.Fatalf("segments = %d, want 1 (still returned)", len(got.Segments))
	}
	if got.Segments[0].ID != 0 {
		t.Fatalf("segment id = %d, want 0 when persist failed", got.Segments[0].ID)
	}
	// ...and the failure is counted for observability.
	if after := SegmentPersistFailures(); after <= before {
		t.Fatalf("persist-failure counter = %d, want > %d", after, before)
	}
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

func TestLeaderboard_HappyPath(t *testing.T) {
	t.Parallel()
	seg := fakeRow{vals: segVals(5, 42, "Home → Work", 0, 0, 0, 0.01, 250)}
	// Three attempts inside the anchor radius; d3 carries no energy reading.
	drives := &fakeRows{data: [][]any{
		driveVals(1, 0, 0, 0.0000, 0, 0.0100, 10000, 300, "Home", 2000.0), // 200 Wh/km
		driveVals(2, 1, 0, 0.0001, 0, 0.0101, 10000, 200, "Home", 1500.0), // 150 Wh/km, fastest
		driveVals(3, 2, 0, 0.0000, 0, 0.0100, 10000, 250, "Home", nil),    // no energy
	}}
	pool := &fakePool{
		queryRowResults: []pgx.Row{seg},
		queryResults:    []queryResult{{rows: drives}},
	}

	rec := httptest.NewRecorder()
	testHandler(pool).Leaderboard(rec, leaderboardReq("5"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[LeaderboardResponse](t, rec)
	if got.Segment.ID != 5 || got.Segment.AttemptCount != 3 {
		t.Fatalf("segment header = %+v, want id 5 / 3 attempts", got.Segment)
	}
	if len(got.ByTime) != 3 {
		t.Fatalf("by_time rows = %d, want 3", len(got.ByTime))
	}
	if got.ByTime[0].DriveID != 2 || !got.ByTime[0].IsPR {
		t.Fatalf("by_time PR = drive %d (pr=%v), want drive 2 PR", got.ByTime[0].DriveID, got.ByTime[0].IsPR)
	}
	// The energy-less attempt (drive 3) has a null wh_per_km in the by-time order.
	var row3 *LeaderboardRow
	for i := range got.ByTime {
		if got.ByTime[i].DriveID == 3 {
			row3 = &got.ByTime[i]
		}
	}
	if row3 == nil {
		t.Fatal("drive 3 missing from by_time")
	}
	if row3.WhPerKm != nil {
		t.Fatalf("energy-less drive should have null wh_per_km, got %v", *row3.WhPerKm)
	}
	// by_efficiency omits the energy-less attempt.
	if len(got.ByEfficiency) != 2 {
		t.Fatalf("by_efficiency rows = %d, want 2 (energy-less omitted)", len(got.ByEfficiency))
	}
	if got.ByEfficiency[0].DriveID != 2 || !got.ByEfficiency[0].IsPR {
		t.Fatalf("by_efficiency PR = drive %d, want drive 2", got.ByEfficiency[0].DriveID)
	}
}

func TestLeaderboard_NotFound(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryRowResults: []pgx.Row{fakeRow{err: pgx.ErrNoRows}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Leaderboard(rec, leaderboardReq("5"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestLeaderboard_InvalidID(t *testing.T) {
	t.Parallel()
	pool := &fakePool{}
	rec := httptest.NewRecorder()
	testHandler(pool).Leaderboard(rec, leaderboardReq("abc"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if pool.queryRowIdx != 0 {
		t.Fatal("expected no DB access on a malformed segment ID")
	}
}

func TestLeaderboard_DrivesQueryError(t *testing.T) {
	t.Parallel()
	seg := fakeRow{vals: segVals(5, 42, "Home → Work", 0, 0, 0, 0.01, 250)}
	pool := &fakePool{
		queryRowResults: []pgx.Row{seg},
		queryResults:    []queryResult{{err: errors.New("read timeout")}},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).Leaderboard(rec, leaderboardReq("5"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

func TestGhost_HappyPath(t *testing.T) {
	t.Parallel()
	seg := fakeRow{vals: segVals(5, 42, "Home → Work", 0, 0, 0, 0.01, 250)}
	driveA := fakeRow{vals: driveHeaderVals(tBase, 200, 10000, 1500)}
	driveB := fakeRow{vals: driveHeaderVals(tBase, 300, 10000, 2000)}
	telemA := telemetryRows(tBase, 0, 10, 0)   // finishes sooner
	telemB := telemetryRows(tBase, 0, 5, 5, 0) // slower

	pool := &fakePool{
		queryRowResults: []pgx.Row{seg, driveA, driveB},
		queryResults:    []queryResult{{rows: telemA}, {rows: telemB}},
	}

	rec := httptest.NewRecorder()
	testHandler(pool).Ghost(rec, ghostReq("5", "a=1&b=2"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[GhostResponse](t, rec)
	if got.A.DriveID != 1 || got.B.DriveID != 2 {
		t.Fatalf("racers = a:%d b:%d, want a:1 b:2", got.A.DriveID, got.B.DriveID)
	}
	if len(got.A.Series) == 0 || len(got.B.Series) == 0 {
		t.Fatal("expected non-empty progress series for both racers")
	}
	if len(got.SplitDeltas) != SplitSamples+1 {
		t.Fatalf("split_deltas = %d, want %d", len(got.SplitDeltas), SplitSamples+1)
	}
	if got.WinnerDriveID == nil || *got.WinnerDriveID != 1 {
		t.Fatalf("winner = %v, want drive 1 (200s < 300s)", got.WinnerDriveID)
	}
	if got.MarginS != 100 {
		t.Fatalf("margin = %v, want 100", got.MarginS)
	}
	// Fractions run 0..1 across the split series.
	if got.SplitDeltas[0].Fraction != 0 || got.SplitDeltas[len(got.SplitDeltas)-1].Fraction != 1 {
		t.Fatalf("split fraction span = [%v..%v], want [0..1]",
			got.SplitDeltas[0].Fraction, got.SplitDeltas[len(got.SplitDeltas)-1].Fraction)
	}
}

func TestGhost_SegmentNotFound(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryRowResults: []pgx.Row{fakeRow{err: pgx.ErrNoRows}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Ghost(rec, ghostReq("5", "a=1&b=2"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestGhost_DriveNotFound(t *testing.T) {
	t.Parallel()
	seg := fakeRow{vals: segVals(5, 42, "Home → Work", 0, 0, 0, 0.01, 250)}
	pool := &fakePool{queryRowResults: []pgx.Row{seg, fakeRow{err: pgx.ErrNoRows}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Ghost(rec, ghostReq("5", "a=1&b=2"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestGhost_MissingParams(t *testing.T) {
	t.Parallel()
	pool := &fakePool{}
	rec := httptest.NewRecorder()
	testHandler(pool).Ghost(rec, ghostReq("5", "")) // no a / b
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
	if pool.queryRowIdx != 0 {
		t.Fatal("expected no DB access when a/b are missing")
	}
}

func TestGhost_NonPositiveDriveID(t *testing.T) {
	t.Parallel()
	pool := &fakePool{}
	rec := httptest.NewRecorder()
	testHandler(pool).Ghost(rec, ghostReq("5", "a=0&b=2"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a non-positive drive id (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestGhost_InvalidSegmentID(t *testing.T) {
	t.Parallel()
	pool := &fakePool{}
	rec := httptest.NewRecorder()
	testHandler(pool).Ghost(rec, ghostReq("-3", "a=1&b=2"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
}
