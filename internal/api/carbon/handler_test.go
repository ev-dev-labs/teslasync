package carbon

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
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
// Fake pgx plumbing. The module vendors no pgxmock (see routeeff /
// batterypassport / timemachine for the same precedent); the handler talks to a
// local carbonQuerier seam so tests supply scripted rows/row sources in call
// order without a live database.
// ---------------------------------------------------------------------------

// assignScan copies scripted column values into Scan destinations, mirroring
// pgx's per-type scanning generically via reflection (allocating for nullable
// pointer fields). Same helper shape as the batterypassport tests.
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

// fakeRow is a scripted pgx.Row for the distance QueryRow.
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

// fakePool returns scripted Query results in call order (each handler issues
// the intensity read first, then its rollup), scripted QueryRow results in call
// order (the summary distance read), and records the SQL/args it saw.
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

var _ carbonQuerier = (*fakePool)(nil)

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

func testHandler(pool carbonQuerier) *Handler { return &Handler{db: pool} }

// curveRows scripts the 24-row intensity read from the shared built-in curve.
func curveRows() *fakeRows {
	c := builtInCurve()
	data := make([][]any, 0, len(c))
	for _, h := range c {
		data = append(data, []any{h.HourOfDay, h.GCO2PerKWh})
	}
	return &fakeRows{data: data}
}

func intensityReq() *http.Request {
	return httptest.NewRequest(http.MethodGet, "/carbon/intensity", nil)
}

func summaryReq(id, query string) *http.Request {
	url := "/vehicles/" + id + "/carbon/summary"
	if query != "" {
		url += "?" + query
	}
	return reqWithParam(httptest.NewRequest(http.MethodGet, url, nil), id)
}

func recommendationReq(id string) *http.Request {
	return reqWithParam(httptest.NewRequest(http.MethodGet, "/vehicles/"+id+"/carbon/recommendation", nil), id)
}

func reqWithParam(r *http.Request, id string) *http.Request {
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("vehicleID", id)
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

func TestNewCarbonHandler_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil *database.DB")
		}
	}()
	_ = NewCarbonHandler(nil)
}

func TestNewCarbonHandler_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil pool")
		}
	}()
	_ = NewCarbonHandler(&database.DB{})
}

// ---------------------------------------------------------------------------
// Intensity
// ---------------------------------------------------------------------------

func TestIntensity_HappyPath(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryResults: []queryResult{{rows: curveRows()}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Intensity(rec, intensityReq())

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[IntensityCurveResponse](t, rec)
	if len(got.Curve) != hoursPerDay {
		t.Fatalf("curve length = %d, want 24", len(got.Curve))
	}
	if got.Min != 200 || got.Max != 500 {
		t.Errorf("min/max = %v/%v, want 200/500", got.Min, got.Max)
	}
	if !reflect.DeepEqual(got.GreenestHours, []int{12, 13}) {
		t.Errorf("greenest_hours = %v, want [12 13]", got.GreenestHours)
	}
	if !reflect.DeepEqual(got.DirtiestHours, []int{19}) {
		t.Errorf("dirtiest_hours = %v, want [19]", got.DirtiestHours)
	}
	if got.Curve[0].HourOfDay != 0 || got.Curve[0].GCO2PerKWh != 260 {
		t.Errorf("curve[0] = %+v, want {0 260}", got.Curve[0])
	}
}

func TestIntensity_QueryError(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryResults: []queryResult{{err: errors.New("boom")}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Intensity(rec, intensityReq())

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if msg := decodeErr(t, rec)["error"]; msg != "failed to load grid carbon intensity" {
		t.Errorf("error = %q", msg)
	}
}

func TestIntensity_ScanError(t *testing.T) {
	t.Parallel()
	rows := &fakeRows{data: [][]any{{0, 260.0}}, scanErr: errors.New("bad scan"), scanErrAt: 1}
	pool := &fakePool{queryResults: []queryResult{{rows: rows}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Intensity(rec, intensityReq())

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
}

// ---------------------------------------------------------------------------
// Summary — validation
// ---------------------------------------------------------------------------

func TestSummary_InvalidVehicleID(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"", "abc", "0", "-5", "99999999999999999999"} {
		id := id
		t.Run("id="+id, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryResults: []queryResult{{rows: curveRows()}}}
			rec := httptest.NewRecorder()
			testHandler(pool).Summary(rec, summaryReq(id, ""))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
			if body := decodeErr(t, rec); body["error"] != "invalid vehicle ID" {
				t.Errorf("error = %q, want 'invalid vehicle ID'", body["error"])
			}
			if pool.queryIdx != 0 {
				t.Errorf("data layer reached (%d Query calls) on invalid input", pool.queryIdx)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Summary — happy path
// ---------------------------------------------------------------------------

func TestSummary_HappyPath(t *testing.T) {
	t.Parallel()
	// Two clusters: 10 kWh @ hour 12 (200 g) and 5 kWh @ hour 19 (500 g).
	charging := &fakeRows{data: [][]any{
		{"2025-01", 12, 10000.0, int64(2)},
		{"2025-01", 19, 5000.0, int64(1)},
	}}
	pool := &fakePool{
		queryResults: []queryResult{
			{rows: curveRows()}, // loadCurve
			{rows: charging},    // summary charging rollup
		},
		queryRowResults: []pgx.Row{
			fakeRow{vals: []any{500.0}}, // distance km
		},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).Summary(rec, summaryReq("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[SummaryResponse](t, rec)

	// energy = 15 kWh; co2 = 10*200/1000 + 5*500/1000 = 2.0 + 2.5 = 4.5 kg
	if got.TotalEnergyKwh != 15 {
		t.Errorf("total_energy_kwh = %v, want 15", got.TotalEnergyKwh)
	}
	if got.TotalCO2Kg != 4.5 {
		t.Errorf("total_co2_kg = %v, want 4.5", got.TotalCO2Kg)
	}
	// gas equiv = 500 km * 0.192 = 96.0; saved = 96 - 4.5 = 91.5
	if got.GasEquivCO2Kg != 96 {
		t.Errorf("gas_equiv_co2_kg = %v, want 96", got.GasEquivCO2Kg)
	}
	if got.CO2SavedKg != 91.5 {
		t.Errorf("co2_saved_kg = %v, want 91.5", got.CO2SavedKg)
	}
	// realized avg = 4500/15 = 300 ⇒ score = (500-300)/300*100 = 66.7 (round1)
	if got.GreenScore != 66.7 {
		t.Errorf("green_score = %v, want 66.7", got.GreenScore)
	}
	if got.SessionsScored != 3 {
		t.Errorf("sessions_scored = %v, want 3", got.SessionsScored)
	}
	if len(got.Monthly) != 1 || got.Monthly[0].Month != "2025-01" ||
		got.Monthly[0].CO2Kg != 4.5 || got.Monthly[0].EnergyKwh != 15 {
		t.Errorf("monthly = %+v, want [{2025-01 4.5 15}]", got.Monthly)
	}
}

func TestSummary_NoChargingData(t *testing.T) {
	t.Parallel()
	pool := &fakePool{
		queryResults: []queryResult{
			{rows: curveRows()},
			{rows: &fakeRows{}}, // no charging rows
		},
		queryRowResults: []pgx.Row{
			fakeRow{vals: []any{0.0}}, // no distance
		},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).Summary(rec, summaryReq("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[SummaryResponse](t, rec)
	if got.TotalCO2Kg != 0 || got.SessionsScored != 0 || got.GreenScore != 0 {
		t.Errorf("empty summary = %+v, want zeroed totals + score", got)
	}
	if got.Monthly == nil {
		t.Error("monthly must be a non-nil empty slice, not null")
	}
	if len(got.Monthly) != 0 {
		t.Errorf("monthly = %v, want empty", got.Monthly)
	}
}

// TestSummary_RangeParamsForwarded pins the [from,to] window onto BOTH the
// charging rollup and the distance read (the NULL-guarded BETWEEN contract).
func TestSummary_RangeParamsForwarded(t *testing.T) {
	t.Parallel()
	pool := &fakePool{
		queryResults: []queryResult{
			{rows: curveRows()},
			{rows: &fakeRows{}},
		},
		queryRowResults: []pgx.Row{fakeRow{vals: []any{0.0}}},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).Summary(rec, summaryReq("42", "from=2025-01-01&to=2025-02-01"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	// Query #2 is the charging rollup: args = (vehicleID, start, end).
	if len(pool.queryArgs) < 2 {
		t.Fatalf("expected >=2 Query calls, got %d", len(pool.queryArgs))
	}
	chargingArgs := pool.queryArgs[1]
	if len(chargingArgs) != 3 || chargingArgs[1] == nil || chargingArgs[2] == nil {
		t.Errorf("charging rollup args = %v, want (id, non-nil start, non-nil end)", chargingArgs)
	}
	// Distance QueryRow also receives the window.
	if len(pool.queryRowArgs) != 1 || len(pool.queryRowArgs[0]) != 3 ||
		pool.queryRowArgs[0][1] == nil || pool.queryRowArgs[0][2] == nil {
		t.Errorf("distance args = %v, want (id, non-nil start, non-nil end)", pool.queryRowArgs)
	}
}

// ---------------------------------------------------------------------------
// Summary — error paths
// ---------------------------------------------------------------------------

func TestSummary_ErrorPaths(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("boom")
	tests := []struct {
		name    string
		pool    *fakePool
		wantMsg string
	}{
		{
			name:    "curve query fails",
			pool:    &fakePool{queryResults: []queryResult{{err: sentinel}}},
			wantMsg: "failed to load grid carbon intensity",
		},
		{
			name: "charging query fails",
			pool: &fakePool{queryResults: []queryResult{
				{rows: curveRows()}, {err: sentinel},
			}},
			wantMsg: "failed to compute carbon summary",
		},
		{
			name: "charging scan fails",
			pool: &fakePool{queryResults: []queryResult{
				{rows: curveRows()},
				{rows: &fakeRows{data: [][]any{{"2025-01", 12, 10000.0, int64(1)}}, scanErr: sentinel, scanErrAt: 1}},
			}},
			wantMsg: "failed to read carbon summary",
		},
		{
			name: "charging iteration fails",
			pool: &fakePool{queryResults: []queryResult{
				{rows: curveRows()},
				{rows: &fakeRows{iterErr: sentinel}},
			}},
			wantMsg: "failed to read carbon summary",
		},
		{
			name: "distance query fails",
			pool: &fakePool{
				queryResults: []queryResult{
					{rows: curveRows()},
					{rows: &fakeRows{}},
				},
				queryRowResults: []pgx.Row{fakeRow{err: sentinel}},
			},
			wantMsg: "failed to compute carbon summary",
		},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			testHandler(tc.pool).Summary(rec, summaryReq("42", ""))
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
			}
			if msg := decodeErr(t, rec)["error"]; msg != tc.wantMsg {
				t.Errorf("error = %q, want %q", msg, tc.wantMsg)
			}
		})
	}
}

// A NULL distance (ErrNoRows) must NOT fail the summary — it degrades to 0 km.
func TestSummary_DistanceNoRowsTolerated(t *testing.T) {
	t.Parallel()
	pool := &fakePool{
		queryResults: []queryResult{
			{rows: curveRows()},
			{rows: &fakeRows{}},
		},
		queryRowResults: []pgx.Row{fakeRow{err: pgx.ErrNoRows}},
	}
	rec := httptest.NewRecorder()
	testHandler(pool).Summary(rec, summaryReq("42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[SummaryResponse](t, rec)
	if got.GasEquivCO2Kg != 0 {
		t.Errorf("gas_equiv_co2_kg = %v, want 0 on ErrNoRows", got.GasEquivCO2Kg)
	}
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

func TestRecommendation_InvalidVehicleID(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"", "abc", "0", "-5"} {
		id := id
		t.Run("id="+id, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryResults: []queryResult{{rows: curveRows()}}}
			rec := httptest.NewRecorder()
			testHandler(pool).Recommendation(rec, recommendationReq(id))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
			if pool.queryIdx != 0 {
				t.Errorf("data layer reached (%d Query calls) on invalid input", pool.queryIdx)
			}
		})
	}
}

func TestRecommendation_HappyPath(t *testing.T) {
	t.Parallel()
	// 20 kWh @ hour 1 (250 g) + 10 kWh @ hour 19 (500 g).
	charging := &fakeRows{data: [][]any{
		{1, 20000.0},
		{19, 10000.0},
	}}
	pool := &fakePool{queryResults: []queryResult{
		{rows: curveRows()},
		{rows: charging},
	}}
	rec := httptest.NewRecorder()
	testHandler(pool).Recommendation(rec, recommendationReq("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[RecommendationResponse](t, rec)

	// current avg = (20*250 + 10*500)/30 = 10000/30 = 333.33 ⇒ round1 333.3
	if got.CurrentAvgIntensity != 333.3 {
		t.Errorf("current_avg_intensity = %v, want 333.3", got.CurrentAvgIntensity)
	}
	// greenest window = [12,15) avg (200+200+205)/3 = 201.67 ⇒ round1 201.7
	if got.GreenestWindow.StartHour != 12 || got.GreenestWindow.EndHour != 15 {
		t.Errorf("greenest_window = [%d,%d), want [12,15)", got.GreenestWindow.StartHour, got.GreenestWindow.EndHour)
	}
	if got.GreenestWindow.AvgIntensity != 201.7 {
		t.Errorf("greenest_window.avg_intensity = %v, want 201.7", got.GreenestWindow.AvgIntensity)
	}
	// saving = 30 * (333.33-201.67)/1000 = 3.95 kg; pct = 131.67/333.33*100 = 39.5
	if got.PotentialCO2SavingKg != 3.95 {
		t.Errorf("potential_co2_saving_kg = %v, want 3.95", got.PotentialCO2SavingKg)
	}
	if got.PotentialSavingPct != 39.5 {
		t.Errorf("potential_saving_pct = %v, want 39.5", got.PotentialSavingPct)
	}
}

func TestRecommendation_NoChargingData(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryResults: []queryResult{
		{rows: curveRows()},
		{rows: &fakeRows{}},
	}}
	rec := httptest.NewRecorder()
	testHandler(pool).Recommendation(rec, recommendationReq("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	got := decodeInto[RecommendationResponse](t, rec)
	// No charging ⇒ realized avg 0, nothing to save, but the greenest window is
	// still surfaced from the curve so the UI can always advise a window.
	if got.CurrentAvgIntensity != 0 || got.PotentialCO2SavingKg != 0 || got.PotentialSavingPct != 0 {
		t.Errorf("no-data recommendation = %+v, want zeroed current/savings", got)
	}
	if got.GreenestWindow.StartHour != 12 || got.GreenestWindow.EndHour != 15 {
		t.Errorf("greenest_window = [%d,%d), want [12,15) even with no charging",
			got.GreenestWindow.StartHour, got.GreenestWindow.EndHour)
	}
}

func TestRecommendation_ErrorPaths(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("boom")
	tests := []struct {
		name    string
		pool    *fakePool
		wantMsg string
	}{
		{
			name:    "curve query fails",
			pool:    &fakePool{queryResults: []queryResult{{err: sentinel}}},
			wantMsg: "failed to load grid carbon intensity",
		},
		{
			name: "charging query fails",
			pool: &fakePool{queryResults: []queryResult{
				{rows: curveRows()}, {err: sentinel},
			}},
			wantMsg: "failed to compute carbon recommendation",
		},
		{
			name: "charging scan fails",
			pool: &fakePool{queryResults: []queryResult{
				{rows: curveRows()},
				{rows: &fakeRows{data: [][]any{{1, 20000.0}}, scanErr: sentinel, scanErrAt: 1}},
			}},
			wantMsg: "failed to read carbon recommendation",
		},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			testHandler(tc.pool).Recommendation(rec, recommendationReq("42"))
			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
			}
			if msg := decodeErr(t, rec)["error"]; msg != tc.wantMsg {
				t.Errorf("error = %q, want %q", msg, tc.wantMsg)
			}
		})
	}
}
