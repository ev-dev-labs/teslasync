package rul

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// TestMain silences the global zerolog logger so the intentional error-path logs
// (query / scan failures) don't clutter test output.
func TestMain(m *testing.M) {
	zerolog.SetGlobalLevel(zerolog.Disabled)
	m.Run()
}

// ---------------------------------------------------------------------------
// Fake pgx plumbing. The module vendors no pgxmock (see carbon / routeeff /
// timemachine for the same precedent); the handler talks to a local rulQuerier
// seam so tests supply scripted rows/row sources in call order without a live
// database.
// ---------------------------------------------------------------------------

// assignScan copies scripted column values into Scan destinations via reflection
// (allocating for nullable pointer fields). Same helper shape as the carbon /
// batterypassport tests.
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

// fakeRow is a scripted pgx.Row for the vehicle / odometer QueryRow calls.
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
	scanErr   error
	scanErrAt int
	iterErr   error
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

// fakePool returns scripted Query results (call order: [configs, soh]) and
// scripted QueryRow results (call order: [vehicle, odometer]) and records the
// SQL/args it saw.
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

var _ rulQuerier = (*fakePool)(nil)

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

func testHandler(pool rulQuerier) *Handler { return &Handler{db: pool} }

// configRows scripts the seeded component_lifespans table. Values are the raw
// column scalars (nil for NULL); assignScan allocates the nullable pointers the
// handler scans into. `exclude` drops named components to exercise the "not
// configured" 404 branch.
func configRows(exclude ...string) *fakeRows {
	skip := make(map[string]bool, len(exclude))
	for _, e := range exclude {
		skip[e] = true
	}
	all := [][]any{
		{"brakes", 150000.0, nil, 0.0, "EV brakes last long via regen"},
		{"cabin_filter", nil, 365, 0.0, "Yearly cabin filter"},
		{"hv_battery", 300000.0, nil, 70.0, "EOL at 70% SoH"},
		{"lv_battery", nil, 1460, 0.0, "~4 year 12V"},
		{"tires", 50000.0, nil, 0.0, "Tread life"},
	}
	data := make([][]any, 0, len(all))
	for _, row := range all {
		if skip[row[0].(string)] {
			continue
		}
		data = append(data, row)
	}
	return &fakeRows{data: data}
}

// sohRows scripts a gently declining daily SoH source (energy/soc pairs). With
// the default 75000 Wh pack, SoH runs 100 -> ~98.8 over 300 days.
func sohRows(now time.Time) *fakeRows {
	base := now.AddDate(0, 0, -300)
	var data [][]any
	for i := 0; i <= 30; i++ {
		day := base.AddDate(0, 0, i*10)
		energy := 67500.0 * (1 - 0.0004*float64(i)) // usable = energy/0.9
		data = append(data, []any{day, energy, 90.0})
	}
	return &fakeRows{data: data}
}

// vehicleRow scripts the vehicle read: a short VIN + nil model → default 75000 Wh
// capacity; enrolled `ageDays` before now.
func vehicleRow(now time.Time, ageDays int) fakeRow {
	return fakeRow{vals: []any{"TEST", nil, now.AddDate(0, 0, -ageDays)}}
}

// odometerRow scripts the aggregate drives read: total km, recent km, drive
// count, active span days.
func odometerRow(totalKm, recentKm float64, samples int64, spanDays float64) fakeRow {
	return fakeRow{vals: []any{totalKm * 1000.0, recentKm * 1000.0, samples, spanDays}}
}

// happyPool wires a full, realistic four-read script: 300-day-old vehicle,
// declining SoH, 46,000 km on a ~50 km/day cadence.
func happyPool(now time.Time) *fakePool {
	return &fakePool{
		queryResults:    []queryResult{{rows: configRows()}, {rows: sohRows(now)}},
		queryRowResults: []pgx.Row{vehicleRow(now, 300), odometerRow(46000, 3000, 45, 60)},
	}
}

func rulReq(id string) *http.Request {
	return reqWithParams(httptest.NewRequest(http.MethodGet, "/vehicles/"+id+"/rul", nil), id, "")
}

func componentReq(id, component string) *http.Request {
	return reqWithParams(httptest.NewRequest(http.MethodGet, "/vehicles/"+id+"/rul/"+component, nil), id, component)
}

func reqWithParams(r *http.Request, id, component string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("vehicleID", id)
	if component != "" {
		rctx.URLParams.Add("component", component)
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

func byComponent(comps []ComponentRUL) map[string]ComponentRUL {
	m := make(map[string]ComponentRUL, len(comps))
	for _, c := range comps {
		m[c.Component] = c
	}
	return m
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

func TestNewRULHandler_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil *database.DB")
		}
	}()
	_ = NewRULHandler(nil)
}

func TestNewRULHandler_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil pool")
		}
	}()
	_ = NewRULHandler(&database.DB{})
}

// ---------------------------------------------------------------------------
// RUL (board)
// ---------------------------------------------------------------------------

func TestRUL_HappyPath(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	pool := happyPool(now)
	rec := httptest.NewRecorder()
	testHandler(pool).RUL(rec, rulReq("7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[RULResponse](t, rec)
	if got.VehicleID != 7 {
		t.Errorf("vehicle_id = %d, want 7", got.VehicleID)
	}
	if len(got.Components) != len(componentSpecs) {
		t.Fatalf("components = %d, want %d", len(got.Components), len(componentSpecs))
	}
	// Emitted in the deliberate componentSpecs order.
	if got.Components[0].Component != "hv_battery" || got.Components[2].Component != "tires" {
		t.Errorf("unexpected component order: %s ... %s", got.Components[0].Component, got.Components[2].Component)
	}

	m := byComponent(got.Components)
	if b := m["hv_battery"]; b.Status != "healthy" || b.HealthPct <= 90 || b.HealthPct > 100 {
		t.Errorf("hv_battery = %+v, want healthy with 90<health<=100", b)
	}
	if b := m["hv_battery"]; b.Confidence <= 0 || b.ProjectedEOLDate == nil {
		t.Errorf("hv_battery expected positive confidence + a projected date, got %+v", b)
	}
	// 46,000 / 50,000 km → 8% life → replace_soon; remaining 4,000 km.
	if tr := m["tires"]; tr.Status != "replace_soon" || tr.RemainingKm == nil || !approx(*tr.RemainingKm, 4000, 1) {
		t.Errorf("tires = %+v, want replace_soon @ ~4000 km", tr)
	}
	if br := m["brakes"]; br.Status != "healthy" {
		t.Errorf("brakes status = %q, want healthy", br.Status)
	}
	// cabin_filter enrolled 300d vs 365d nominal → ~17.8% life → watch.
	if cf := m["cabin_filter"]; cf.Status != "watch" {
		t.Errorf("cabin_filter status = %q, want watch", cf.Status)
	}
	if lv := m["lv_battery"]; lv.Status != "healthy" {
		t.Errorf("lv_battery status = %q, want healthy", lv.Status)
	}

	// Next service = the nearest projected date; cabin_filter (~65d) is soonest.
	if got.NextService == nil || got.NextService.Component != "cabin_filter" {
		t.Fatalf("next_service = %+v, want cabin_filter", got.NextService)
	}
	if got.NextService.Date == nil {
		t.Error("next_service.date must be set")
	}

	// No NaN/Inf leaked into any numeric field (JSON decoded fine already, but
	// assert the invariant explicitly).
	for _, c := range got.Components {
		if isBadFloat(c.HealthPct) || isBadFloat(c.WearRatePerDay) || isBadFloat(c.RemainingDays) || isBadFloat(c.Confidence) {
			t.Errorf("non-finite numeric in %s: %+v", c.Component, c)
		}
	}
}

func isBadFloat(f float64) bool {
	return f != f || f > 1e308 || f < -1e308
}

func TestRUL_VehicleNotFoundIsGraceful(t *testing.T) {
	t.Parallel()
	pool := &fakePool{
		queryResults:    []queryResult{{rows: configRows()}, {rows: &fakeRows{}}},
		queryRowResults: []pgx.Row{fakeRow{err: pgx.ErrNoRows}, odometerRow(0, 0, 0, 0)},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).RUL(rec, rulReq("7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (graceful no-vehicle); body=%q", rec.Code, rec.Body.String())
	}
	got := decodeInto[RULResponse](t, rec)
	if len(got.Components) != len(componentSpecs) {
		t.Fatalf("components = %d, want %d", len(got.Components), len(componentSpecs))
	}
	// Enrolled "today", no drives, no SoH → all-healthy, low/zero confidence.
	for _, c := range got.Components {
		if c.Status != "healthy" {
			t.Errorf("%s status = %q, want healthy for a data-less vehicle", c.Component, c.Status)
		}
	}
}

func TestRUL_BadVehicleID(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"0", "-3", "abc"} {
		rec := httptest.NewRecorder()
		testHandler(&fakePool{}).RUL(rec, rulReq(id))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("id=%q status = %d, want 400", id, rec.Code)
		}
		if msg := decodeErr(t, rec)["error"]; msg != "invalid vehicle ID" {
			t.Errorf("id=%q error = %q", id, msg)
		}
	}
}

func TestRUL_ConfigsQueryError(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryResults: []queryResult{{err: errors.New("boom")}}}
	rec := httptest.NewRecorder()
	testHandler(pool).RUL(rec, rulReq("7"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if msg := decodeErr(t, rec)["error"]; msg != "failed to compute remaining useful life" {
		t.Errorf("error = %q", msg)
	}
}

func TestRUL_ConfigsScanError(t *testing.T) {
	t.Parallel()
	rows := &fakeRows{data: [][]any{{"hv_battery", 300000.0, nil, 70.0, "x"}}, scanErr: errors.New("bad scan"), scanErrAt: 1}
	pool := &fakePool{queryResults: []queryResult{{rows: rows}}}
	rec := httptest.NewRecorder()
	testHandler(pool).RUL(rec, rulReq("7"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestRUL_VehicleReadError(t *testing.T) {
	t.Parallel()
	// A non-ErrNoRows failure on the vehicle QueryRow is a real 500 (configs
	// Query #1 succeeds first; SoH Query #2 is never reached).
	pool := &fakePool{
		queryResults:    []queryResult{{rows: configRows()}},
		queryRowResults: []pgx.Row{fakeRow{err: errors.New("connection reset")}},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).RUL(rec, rulReq("7"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestRUL_SoHQueryError(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	pool := &fakePool{
		queryResults:    []queryResult{{rows: configRows()}, {err: errors.New("timeout")}},
		queryRowResults: []pgx.Row{vehicleRow(now, 100)},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).RUL(rec, rulReq("7"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

func TestRUL_OdometerReadError(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	pool := &fakePool{
		queryResults:    []queryResult{{rows: configRows()}, {rows: &fakeRows{}}},
		queryRowResults: []pgx.Row{vehicleRow(now, 100), fakeRow{err: errors.New("boom")}},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).RUL(rec, rulReq("7"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

// verifies the SQL args carry the vehicle id, and the read order is the one the
// fake pool relies on.
func TestRUL_QueryArgsAndOrder(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	pool := happyPool(now)
	rec := httptest.NewRecorder()
	testHandler(pool).RUL(rec, rulReq("42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(pool.querySQLs) != 2 {
		t.Fatalf("Query calls = %d, want 2 [configs, soh]", len(pool.querySQLs))
	}
	if len(pool.queryRowSQLs) != 2 {
		t.Fatalf("QueryRow calls = %d, want 2 [vehicle, odometer]", len(pool.queryRowSQLs))
	}
	// configs takes no args; the other three are scoped to the vehicle.
	if len(pool.queryArgs[0]) != 0 {
		t.Errorf("configs query args = %v, want none", pool.queryArgs[0])
	}
	for _, args := range [][]any{pool.queryArgs[1], pool.queryRowArgs[0], pool.queryRowArgs[1]} {
		if len(args) != 1 || args[0] != int64(42) {
			t.Errorf("scoped query args = %v, want [42]", args)
		}
	}
}

// ---------------------------------------------------------------------------
// Component (detail)
// ---------------------------------------------------------------------------

func TestComponent_HappyPath_Battery(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	pool := happyPool(now)
	rec := httptest.NewRecorder()
	testHandler(pool).Component(rec, componentReq("7", "hv_battery"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[ComponentDetailResponse](t, rec)
	if got.Component != "hv_battery" || got.Label != "High-Voltage Battery" {
		t.Errorf("component/label = %q/%q", got.Component, got.Label)
	}
	if got.EOLThreshold == nil || *got.EOLThreshold != 70 {
		t.Errorf("eol_threshold = %v, want 70", got.EOLThreshold)
	}
	if got.NominalLifeKm == nil || *got.NominalLifeKm != 300000 {
		t.Errorf("nominal_life_km = %v, want 300000", got.NominalLifeKm)
	}
	if got.Notes == "" {
		t.Error("notes should be echoed")
	}
	if len(got.Projection) != projectionSteps+1 {
		t.Fatalf("projection points = %d, want %d", len(got.Projection), projectionSteps+1)
	}
	// Forecast starts at current health and decays toward — never below — the EOL.
	first, last := got.Projection[0], got.Projection[len(got.Projection)-1]
	if first.ProjectedHealth < last.ProjectedHealth {
		t.Errorf("projection should decay: first %v < last %v", first.ProjectedHealth, last.ProjectedHealth)
	}
	if last.ProjectedHealth < *got.EOLThreshold-0.5 {
		t.Errorf("projection floor %v below EOL %v", last.ProjectedHealth, *got.EOLThreshold)
	}
	for _, p := range got.Projection {
		if p.ConfidenceLow > p.ProjectedHealth+1e-6 || p.ConfidenceHigh < p.ProjectedHealth-1e-6 {
			t.Errorf("band does not straddle projection: %+v", p)
		}
	}
}

func TestComponent_HappyPath_Wear(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	pool := happyPool(now)
	rec := httptest.NewRecorder()
	testHandler(pool).Component(rec, componentReq("7", "tires"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[ComponentDetailResponse](t, rec)
	if got.NominalLifeKm == nil || *got.NominalLifeKm != 50000 {
		t.Errorf("nominal_life_km = %v, want 50000", got.NominalLifeKm)
	}
	if got.RemainingKm == nil || !approx(*got.RemainingKm, 4000, 1) {
		t.Errorf("remaining_km = %v, want ~4000", got.RemainingKm)
	}
	if len(got.Projection) == 0 {
		t.Error("expected a projection series")
	}
}

func TestComponent_UnknownComponent(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	// 400 is decided before any DB read, so an empty pool is fine.
	testHandler(&fakePool{}).Component(rec, componentReq("7", "flux_capacitor"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
	if msg := decodeErr(t, rec)["error"]; msg != "unknown component" {
		t.Errorf("error = %q", msg)
	}
}

func TestComponent_BadVehicleID(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	testHandler(&fakePool{}).Component(rec, componentReq("0", "hv_battery"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if msg := decodeErr(t, rec)["error"]; msg != "invalid vehicle ID" {
		t.Errorf("error = %q", msg)
	}
}

func TestComponent_KnownButNotConfigured(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	// hv_battery is a known spec but its config row was (admin-)deleted → 404.
	pool := &fakePool{
		queryResults:    []queryResult{{rows: configRows("hv_battery")}, {rows: sohRows(now)}},
		queryRowResults: []pgx.Row{vehicleRow(now, 100), odometerRow(46000, 3000, 45, 60)},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).Component(rec, componentReq("7", "hv_battery"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%q)", rec.Code, rec.Body.String())
	}
	if msg := decodeErr(t, rec)["error"]; msg != "component not configured" {
		t.Errorf("error = %q", msg)
	}
}

func TestComponent_GatherError(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryResults: []queryResult{{err: errors.New("boom")}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Component(rec, componentReq("7", "hv_battery"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}
