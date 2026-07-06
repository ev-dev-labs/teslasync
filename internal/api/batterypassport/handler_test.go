package batterypassport

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"regexp"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	dto "github.com/prometheus/client_model/go"
	"github.com/rs/zerolog"
)

// TestMain silences the global zerolog logger so the intentional error-path
// logs don't clutter test output. Set once before any test runs.
func TestMain(m *testing.M) {
	zerolog.SetGlobalLevel(zerolog.Disabled)
	m.Run()
}

// ---------------------------------------------------------------------------
// Fake pgx plumbing. The module vendors no pgxmock (see routeeff / timemachine
// / adapter-postgres for the same precedent); the handler talks to a local
// passportQuerier seam so tests supply scripted row/rows/exec sources without
// a live database.
// ---------------------------------------------------------------------------

// assignScan copies scripted column values into Scan destinations, mirroring
// pgx's per-type scanning generically via reflection. Unlike the routeeff
// helper it also allocates when the destination is a nullable pointer field
// (a non-nil scalar scanned into a *T), which the passport handler relies on
// for nullable aggregates (avg_end_soc, first_charge_at, …).
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
			target.Set(reflect.Zero(target.Type())) // nil pointer / zero value
			continue
		}
		rv := reflect.ValueOf(v)
		if target.Kind() == reflect.Pointer {
			// Nullable field: allocate a *T and store the scalar.
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

// fakeRow is a scripted pgx.Row. vals populate the Scan destinations, or err
// exercises the not-found / scan-failure branches.
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

// fakeRows is a scripted pgx.Rows for the degradation-trend Query.
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

// fakePool returns scripted QueryRow results in call order (the handler issues
// vehicle → charging → drives), scripted Query rows for the trend, and a
// scripted Exec result for the ledger write. It records invocations.
type fakePool struct {
	queryRowResults []pgx.Row
	queryRowIdx     int

	rows     pgx.Rows
	queryErr error

	tag     pgconn.CommandTag
	execErr error

	queryRowSQLs [][]any // captured args per QueryRow call
	querySQL     string
	queryArgs    []any
	execArgs     []any
	execN        int
}

func (p *fakePool) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	p.querySQL = sql
	p.queryArgs = args
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	return p.rows, nil
}

func (p *fakePool) QueryRow(_ context.Context, _ string, args ...any) pgx.Row {
	p.queryRowSQLs = append(p.queryRowSQLs, args)
	if p.queryRowIdx >= len(p.queryRowResults) {
		return fakeRow{err: errors.New("fakePool: unexpected QueryRow call")}
	}
	row := p.queryRowResults[p.queryRowIdx]
	p.queryRowIdx++
	return row
}

func (p *fakePool) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	p.execN++
	p.execArgs = args
	if p.execErr != nil {
		return pgconn.CommandTag{}, p.execErr
	}
	return p.tag, nil
}

var _ passportQuerier = (*fakePool)(nil)

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

var fixedNow = time.Date(2026, 7, 6, 12, 0, 0, 0, time.UTC)

const (
	testVIN     = "5YJ3E1EK7KF123456" // 8th char 'K' → 75 kWh nameplate
	testModelNm = "Model 3"
)

func testHandler(pool passportQuerier) *Handler {
	return &Handler{db: pool, now: func() time.Time { return fixedNow }}
}

// happyPool scripts a fully-populated, deterministic vehicle: three trend days
// around ~70 kWh usable on a 75 kWh pack, a 25%-fast-charge history, and a
// mixed thermal profile. Returns a FRESH pool each call so it can back two
// independent requests (Get then Verify).
func happyPool() *fakePool {
	model := testModelNm
	return &fakePool{
		queryRowResults: []pgx.Row{
			// vehicle: vin, model
			fakeRow{vals: []any{testVIN, model}},
			// charging: fast_count, total_count, total_energy_wh, avg_end_soc, first_charge_at
			fakeRow{vals: []any{int64(10), int64(40), 1_500_000.0, 82.0, mustTime("2023-02-01T00:00:00Z")}},
			// drives: cold, nominal, hot, first_drive_at
			fakeRow{vals: []any{int64(5), int64(30), int64(5), mustTime("2023-01-15T00:00:00Z")}},
		},
		rows: &fakeRows{data: [][]any{
			{mustTime("2023-03-01T00:00:00Z"), 70000.0},
			{mustTime("2023-04-01T00:00:00Z"), 69000.0},
			{mustTime("2023-05-01T00:00:00Z"), 68000.0},
		}},
		tag: pgconn.NewCommandTag("INSERT 0 1"),
	}
}

func mustTime(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

func getReq(id string) *http.Request {
	return reqWithParam(httptest.NewRequest(http.MethodGet, "/vehicles/"+id+"/battery-passport", nil), id)
}

func verifyReq(id, query string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/vehicles/"+id+"/battery-passport/verify?"+query, nil)
	return reqWithParam(r, id)
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

func decodePassport(t *testing.T, rec *httptest.ResponseRecorder) Passport {
	t.Helper()
	var p Passport
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("decode passport: %v (body=%q)", err, rec.Body.String())
	}
	return p
}

var hexRe = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ledgerFailureCount reads the current value of the best-effort ledger-write
// failure counter without pulling in the prometheus testutil module (which
// would add a dependency); client_model is already a direct require.
func ledgerFailureCount(t *testing.T) float64 {
	t.Helper()
	var m dto.Metric
	if err := passportLedgerWriteFailuresTotal.Write(&m); err != nil {
		t.Fatalf("read ledger failure counter: %v", err)
	}
	return m.GetCounter().GetValue()
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

func TestNewBatteryPassportHandler_NilDBPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil *database.DB")
		}
	}()
	_ = NewBatteryPassportHandler(nil)
}

func TestNewBatteryPassportHandler_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic constructing handler with a nil pool")
		}
	}()
	_ = NewBatteryPassportHandler(&database.DB{})
}

// ---------------------------------------------------------------------------
// Get — validation (no data layer reached)
// ---------------------------------------------------------------------------

func TestGet_InvalidVehicleID(t *testing.T) {
	t.Parallel()
	for _, id := range []string{"", "abc", "0", "-5", "99999999999999999999"} {
		id := id
		t.Run("id="+id, func(t *testing.T) {
			t.Parallel()
			pool := happyPool()
			rec := httptest.NewRecorder()
			testHandler(pool).Get(rec, getReq(id))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
			}
			if len(pool.queryRowSQLs) != 0 {
				t.Errorf("data layer reached (%d QueryRow calls) on invalid input", len(pool.queryRowSQLs))
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Get — data-layer error paths
// ---------------------------------------------------------------------------

func TestGet_VehicleNotFound(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryRowResults: []pgx.Row{fakeRow{err: pgx.ErrNoRows}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Get(rec, getReq("42"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeErr(t, rec)["error"]; got != "vehicle not found" {
		t.Errorf("error = %q, want %q", got, "vehicle not found")
	}
	if pool.execN != 0 {
		t.Errorf("ledger written (%d Exec) despite 404", pool.execN)
	}
}

func TestGet_ErrorPaths(t *testing.T) {
	t.Parallel()
	boom := errors.New("boom")
	model := testModelNm
	vehicle := fakeRow{vals: []any{testVIN, model}}

	tests := []struct {
		name string
		pool *fakePool
	}{
		{
			name: "vehicle query error",
			pool: &fakePool{queryRowResults: []pgx.Row{fakeRow{err: boom}}},
		},
		{
			name: "trend query error",
			pool: &fakePool{queryRowResults: []pgx.Row{vehicle}, queryErr: boom},
		},
		{
			name: "trend scan error",
			pool: &fakePool{
				queryRowResults: []pgx.Row{vehicle},
				rows:            &fakeRows{data: [][]any{{mustTime("2023-03-01T00:00:00Z"), 70000.0}}, scanErr: boom, scanErrAt: 1},
			},
		},
		{
			name: "trend iteration error",
			pool: &fakePool{
				queryRowResults: []pgx.Row{vehicle},
				rows:            &fakeRows{data: [][]any{{mustTime("2023-03-01T00:00:00Z"), 70000.0}}, iterErr: boom},
			},
		},
		{
			name: "charging query error",
			pool: &fakePool{
				queryRowResults: []pgx.Row{vehicle, fakeRow{err: boom}},
				rows:            &fakeRows{},
			},
		},
		{
			name: "drives query error",
			pool: &fakePool{
				queryRowResults: []pgx.Row{
					vehicle,
					fakeRow{vals: []any{int64(1), int64(4), 100000.0, 80.0, nil}},
					fakeRow{err: boom},
				},
				rows: &fakeRows{},
			},
		},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			testHandler(tc.pool).Get(rec, getReq("42"))

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500 (body=%q)", rec.Code, rec.Body.String())
			}
			if got := decodeErr(t, rec)["error"]; got != "failed to build battery passport" {
				t.Errorf("error = %q, want build-failure message", got)
			}
			if tc.pool.execN != 0 {
				t.Errorf("ledger written (%d Exec) despite 500", tc.pool.execN)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Get — happy path
// ---------------------------------------------------------------------------

func TestGet_HappyPath(t *testing.T) {
	t.Parallel()
	pool := happyPool()
	rec := httptest.NewRecorder()
	testHandler(pool).Get(rec, getReq("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	p := decodePassport(t, rec)

	if p.VehicleID != 42 {
		t.Errorf("vehicle_id = %d, want 42", p.VehicleID)
	}
	if p.VinMasked != MaskVIN(testVIN) {
		t.Errorf("vin_masked = %q, want %q", p.VinMasked, MaskVIN(testVIN))
	}
	if p.OriginalCapacityKwh != 75 {
		t.Errorf("original_capacity_kwh = %v, want 75", p.OriginalCapacityKwh)
	}
	// median of recent [70000,69000,68000] = 69000 Wh → 69 kWh, SoH 92%.
	if p.CapacityKwh != 69 {
		t.Errorf("capacity_kwh = %v, want 69", p.CapacityKwh)
	}
	if p.SohPct != 92 {
		t.Errorf("soh_pct = %v, want 92", p.SohPct)
	}
	// fast_charge_ratio = 10/40 = 0.25.
	if p.FastChargeRatio != 0.25 {
		t.Errorf("fast_charge_ratio = %v, want 0.25", p.FastChargeRatio)
	}
	if p.AvgChargeLimitPct != 82 {
		t.Errorf("avg_charge_limit_pct = %v, want 82", p.AvgChargeLimitPct)
	}
	// equivalent_full_cycles = 1_500_000 / 75_000 = 20.
	if p.EquivalentFullCycles != 20 {
		t.Errorf("equivalent_full_cycles = %v, want 20", p.EquivalentFullCycles)
	}
	// thermal: 5/40, 30/40, 5/40.
	if p.ThermalExposure.NominalPct != 75 || p.ThermalExposure.ColdPct != 12.5 || p.ThermalExposure.HotPct != 12.5 {
		t.Errorf("thermal_exposure = %+v, want {12.5 75 12.5}", p.ThermalExposure)
	}
	// Grade(92, 0.25, 20) = 92 - 2 - 0.16 = ~89.84 → "B".
	if p.HealthGrade != "B" {
		t.Errorf("health_grade = %q, want B", p.HealthGrade)
	}
	if len(p.DegradationTrend) != 3 {
		t.Fatalf("degradation_trend len = %d, want 3", len(p.DegradationTrend))
	}
	if p.DegradationTrend[0].Date != "2023-03-01" {
		t.Errorf("trend[0].date = %q, want 2023-03-01", p.DegradationTrend[0].Date)
	}
	if len(p.Recommendations) == 0 {
		t.Error("recommendations empty")
	}
	if !hexRe.MatchString(p.ProvenanceHash) {
		t.Errorf("provenance_hash = %q, want 64 hex chars", p.ProvenanceHash)
	}
	if p.FirstObservedAt == nil || *p.FirstObservedAt != "2023-01-15T00:00:00Z" {
		t.Errorf("first_observed_at = %v, want earliest drive 2023-01-15", p.FirstObservedAt)
	}
	if p.IssuedAt != fixedNow.Format(time.RFC3339) {
		t.Errorf("issued_at = %q, want %q", p.IssuedAt, fixedNow.Format(time.RFC3339))
	}

	// Ledger snapshot appended once, keyed by vehicle_id.
	if pool.execN != 1 {
		t.Errorf("Exec calls = %d, want 1 (ledger snapshot)", pool.execN)
	}
	if len(pool.execArgs) < 1 || pool.execArgs[0] != int64(42) {
		t.Errorf("ledger vehicle_id arg = %v, want 42", pool.execArgs)
	}
	// Trend cursor closed (no leak).
	if fr, ok := pool.rows.(*fakeRows); ok && !fr.closed {
		t.Error("trend rows.Close() not called")
	}
}

func TestGet_EmptyHistory(t *testing.T) {
	t.Parallel()
	// A vehicle with no cagg/charging/drive history: every section still
	// renders, SoH unknown ⇒ grade N/A, trend empty, hash still stable.
	pool := &fakePool{
		queryRowResults: []pgx.Row{
			fakeRow{vals: []any{testVIN, testModelNm}},
			fakeRow{vals: []any{int64(0), int64(0), 0.0, nil, nil}},
			fakeRow{vals: []any{int64(0), int64(0), int64(0), nil}},
		},
		rows: &fakeRows{},
		tag:  pgconn.NewCommandTag("INSERT 0 1"),
	}
	rec := httptest.NewRecorder()
	testHandler(pool).Get(rec, getReq("7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", rec.Code, rec.Body.String())
	}
	p := decodePassport(t, rec)
	if p.SohPct != 0 {
		t.Errorf("soh_pct = %v, want 0 (no data)", p.SohPct)
	}
	if p.HealthGrade != gradeUnknown {
		t.Errorf("health_grade = %q, want %q", p.HealthGrade, gradeUnknown)
	}
	if p.DegradationTrend == nil {
		t.Error("degradation_trend is nil, want empty slice")
	}
	if len(p.DegradationTrend) != 0 {
		t.Errorf("degradation_trend len = %d, want 0", len(p.DegradationTrend))
	}
	if p.FirstObservedAt != nil {
		t.Errorf("first_observed_at = %v, want null", *p.FirstObservedAt)
	}
	if !hexRe.MatchString(p.ProvenanceHash) {
		t.Errorf("provenance_hash = %q, want 64 hex chars", p.ProvenanceHash)
	}
	if len(p.Recommendations) == 0 {
		t.Error("recommendations empty; want the healthy fallback note")
	}
}

// ---------------------------------------------------------------------------
// Get — ledger write is best-effort (never fails the read)
// ---------------------------------------------------------------------------

func TestGet_LedgerWriteFailureStillServes(t *testing.T) {
	// Not parallel: asserts a delta on the global failure counter.
	before := ledgerFailureCount(t)

	pool := happyPool()
	pool.execErr = errors.New("ledger unavailable")
	rec := httptest.NewRecorder()
	testHandler(pool).Get(rec, getReq("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 despite ledger failure (body=%q)", rec.Code, rec.Body.String())
	}
	if p := decodePassport(t, rec); !hexRe.MatchString(p.ProvenanceHash) {
		t.Errorf("passport not served on ledger failure: %q", p.ProvenanceHash)
	}
	if pool.execN != 1 {
		t.Errorf("Exec calls = %d, want 1 (attempted)", pool.execN)
	}
	after := ledgerFailureCount(t)
	if after-before != 1 {
		t.Errorf("ledger failure counter delta = %v, want 1", after-before)
	}
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

func TestVerify_InvalidVehicleID(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	testHandler(happyPool()).Verify(rec, verifyReq("abc", "hash=deadbeef"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestVerify_MissingHash(t *testing.T) {
	t.Parallel()
	pool := happyPool()
	rec := httptest.NewRecorder()
	testHandler(pool).Verify(rec, verifyReq("42", ""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%q)", rec.Code, rec.Body.String())
	}
	if got := decodeErr(t, rec)["error"]; got != "hash query parameter required" {
		t.Errorf("error = %q, want hash-required message", got)
	}
	if len(pool.queryRowSQLs) != 0 {
		t.Error("data layer reached before hash validation")
	}
}

func TestVerify_VehicleNotFound(t *testing.T) {
	t.Parallel()
	pool := &fakePool{queryRowResults: []pgx.Row{fakeRow{err: pgx.ErrNoRows}}}
	rec := httptest.NewRecorder()
	testHandler(pool).Verify(rec, verifyReq("42", "hash=abc"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%q)", rec.Code, rec.Body.String())
	}
}

func TestVerify_RoundTrip(t *testing.T) {
	t.Parallel()
	// First issue a passport to obtain the current provenance hash…
	getRec := httptest.NewRecorder()
	testHandler(happyPool()).Get(getRec, getReq("42"))
	issued := decodePassport(t, getRec)

	// …then a matching hash verifies valid, and never writes a ledger row.
	verifyPool := happyPool()
	okRec := httptest.NewRecorder()
	testHandler(verifyPool).Verify(okRec, verifyReq("42", "hash="+issued.ProvenanceHash))
	if okRec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%q)", okRec.Code, okRec.Body.String())
	}
	var okBody VerifyResponse
	if err := json.Unmarshal(okRec.Body.Bytes(), &okBody); err != nil {
		t.Fatalf("decode verify: %v", err)
	}
	if !okBody.Valid {
		t.Errorf("valid = false for matching hash; expected=%q provided=%q", okBody.ExpectedHash, okBody.ProvidedHash)
	}
	if okBody.ExpectedHash != issued.ProvenanceHash {
		t.Errorf("expected_hash = %q, want %q", okBody.ExpectedHash, issued.ProvenanceHash)
	}
	if verifyPool.execN != 0 {
		t.Errorf("verify wrote a ledger row (%d Exec); it must be read-only", verifyPool.execN)
	}

	// A tampered hash is reported invalid (but expected is still returned).
	badRec := httptest.NewRecorder()
	testHandler(happyPool()).Verify(badRec, verifyReq("42", "hash=deadbeefdeadbeef"))
	var badBody VerifyResponse
	if err := json.Unmarshal(badRec.Body.Bytes(), &badBody); err != nil {
		t.Fatalf("decode verify: %v", err)
	}
	if badBody.Valid {
		t.Error("valid = true for a tampered hash")
	}
	if badBody.ProvidedHash != "deadbeefdeadbeef" {
		t.Errorf("provided_hash = %q, want the tampered value echoed back", badBody.ProvidedHash)
	}
	if badBody.ExpectedHash != issued.ProvenanceHash {
		t.Errorf("expected_hash = %q, want %q", badBody.ExpectedHash, issued.ProvenanceHash)
	}
}
