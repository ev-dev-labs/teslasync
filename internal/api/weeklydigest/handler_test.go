package weeklydigest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// weekTotalsCall records one WeekTotals invocation so tests can assert the
// vehicle ID and the two week windows the handler derives.
type weekTotalsCall struct {
	vehicleID  int64
	start, end time.Time
}

// weekTotalsResult is one canned WeekTotals reply. Results are consumed in
// call order: index 0 answers the current-week read, index 1 the
// previous-week read.
type weekTotalsResult struct {
	drives    int
	distanceM float64
	energyWh  float64
	err       error
}

// fakeWeeklyRepo is the in-memory weeklyRepository used by handler tests so
// Get can be exercised end-to-end without a live pgx pool. Calls beyond the
// supplied results default to zero totals (the "no drives" case).
type fakeWeeklyRepo struct {
	results []weekTotalsResult
	calls   []weekTotalsCall
}

func (f *fakeWeeklyRepo) WeekTotals(_ context.Context, vehicleID int64, start, end time.Time) (int, float64, float64, error) {
	i := len(f.calls)
	f.calls = append(f.calls, weekTotalsCall{vehicleID, start, end})
	if i < len(f.results) {
		r := f.results[i]
		return r.drives, r.distanceM, r.energyWh, r.err
	}
	return 0, 0, 0, nil
}

var _ weeklyRepository = (*fakeWeeklyRepo)(nil)

// scanRow is a single-row pgx.Row whose Scan behaviour is supplied per test.
type scanRow struct{ scanFn func(dest ...any) error }

func (r scanRow) Scan(dest ...any) error { return r.scanFn(dest...) }

var _ pgx.Row = scanRow{}

// fakePool is a weeklyPool whose QueryRow behaviour is supplied per test so
// the dbWeeklyRepo scan logic runs without a database.
type fakePool struct {
	queryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
}

func (p *fakePool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return p.queryRowFn(ctx, sql, args...)
}

var _ weeklyPool = (*fakePool)(nil)

// newTestHandler binds a handler to a fake repo with a pinned clock so the
// Sunday-anchored window is deterministic.
func newTestHandler(repo weeklyRepository, now time.Time) *Handler {
	return &Handler{repo: repo, clock: func() time.Time { return now }}
}

// reqWithVehicleID builds a GET request carrying a chi {vehicleID} URL
// param, the way the router mounts the handler. An empty param models a
// missing/unmatched segment.
func reqWithVehicleID(param string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/vehicles/"+param+"/weekly-digest", nil)
	rctx := chi.NewRouteContext()
	if param != "" {
		rctx.URLParams.Add("vehicleID", param)
	}
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v (raw=%s)", err, rec.Body.String())
	}
	return body
}

// approxEqual tolerates float64 rounding (e.g. 24*0.14) so exact-equality
// assertions do not flake on 1-ULP differences.
func approxEqual(a, b float64) bool {
	const eps = 1e-9
	d := a - b
	if d < 0 {
		d = -d
	}
	return d <= eps
}

func assertFloat(t *testing.T, body map[string]any, key string, want float64) {
	t.Helper()
	v, ok := body[key]
	if !ok {
		t.Errorf("body missing key %q", key)
		return
	}
	f, ok := v.(float64)
	if !ok {
		t.Errorf("body[%q] = %T (%v), want float64", key, v, v)
		return
	}
	if !approxEqual(f, want) {
		t.Errorf("body[%q] = %v, want %v", key, f, want)
	}
}

// ---------------------------------------------------------------------------
// startOfWeek — Sunday-anchored window boundary
// ---------------------------------------------------------------------------

func TestStartOfWeek(t *testing.T) {
	t.Parallel()
	// Deterministically anchor on a real Sunday so the table never depends
	// on a hand-computed calendar weekday.
	sunday := time.Date(2026, 6, 7, 0, 0, 0, 0, time.UTC)
	for sunday.Weekday() != time.Sunday {
		sunday = sunday.AddDate(0, 0, 1)
	}
	nextSunday := sunday.AddDate(0, 0, 7)

	cases := []struct {
		name string
		in   time.Time
		want time.Time
	}{
		{"sunday_midnight", sunday, sunday},
		{"sunday_noon_truncates", sunday.Add(12 * time.Hour), sunday},
		{"monday", sunday.AddDate(0, 0, 1).Add(15*time.Hour + 30*time.Minute), sunday},
		{"wednesday", sunday.AddDate(0, 0, 3).Add(9 * time.Hour), sunday},
		{"saturday_end", sunday.AddDate(0, 0, 6).Add(23*time.Hour + 59*time.Minute + 59*time.Second), sunday},
		{"next_sunday_starts_new_week", nextSunday, nextSunday},
		{"next_wednesday", nextSunday.AddDate(0, 0, 3), nextSunday},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := startOfWeek(c.in)
			if !got.Equal(c.want) {
				t.Errorf("startOfWeek(%s) = %s, want %s", c.in, got, c.want)
			}
			if got.Weekday() != time.Sunday {
				t.Errorf("startOfWeek(%s) weekday = %s, want Sunday", c.in, got.Weekday())
			}
			if got.Hour() != 0 || got.Minute() != 0 || got.Second() != 0 || got.Nanosecond() != 0 {
				t.Errorf("startOfWeek(%s) not truncated to midnight: %s", c.in, got)
			}
		})
	}
}

func TestStartOfWeek_PreservesLocation(t *testing.T) {
	t.Parallel()
	loc := time.FixedZone("PST", -8*3600)
	in := time.Date(2026, 6, 17, 15, 30, 45, 123, loc)
	got := startOfWeek(in)
	if got.Location() != loc {
		t.Errorf("location = %v, want %v (must anchor to operator-local Sunday)", got.Location(), loc)
	}
	if got.Hour() != 0 || got.Minute() != 0 || got.Second() != 0 || got.Nanosecond() != 0 {
		t.Errorf("time-of-day not truncated: %s", got)
	}
	// Result must be the most recent Sunday at or before `in`.
	if d := in.Sub(got); d < 0 || d >= 7*24*time.Hour {
		t.Errorf("in - startOfWeek = %v, want within [0, 7d)", d)
	}
}

// ---------------------------------------------------------------------------
// computeWeekStats — SI -> km/kWh/cost/efficiency conversion
// ---------------------------------------------------------------------------

func TestComputeWeekStats(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name           string
		drives         int
		distanceM      float64
		energyWh       float64
		wantDrives     int
		wantDistanceKm float64
		wantEnergyKwh  float64
		wantCost       float64
		wantEfficiency float64
	}{
		{"all_zero", 0, 0, 0, 0, 0, 0, 0, 0},
		{"typical", 5, 120000, 24000, 5, 120, 24, 24 * costPerKWh, 200},
		{"zero_distance_no_div_by_zero", 1, 0, 5000, 1, 0, 5, 5 * costPerKWh, 0},
		{"zero_energy", 2, 50000, 0, 2, 50, 0, 0, 0},
		{"fractional", 3, 1500, 250, 3, 1.5, 0.25, 0.25 * costPerKWh, 0.25 / 1.5 * 1000},
		{"tiny_distance_still_computes", 1, 1, 10, 1, 0.001, 0.01, 0.01 * costPerKWh, 0.01 / 0.001 * 1000},
		{"large", 40, 1_000_000, 200000, 40, 1000, 200, 200 * costPerKWh, 200},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			s := computeWeekStats(c.drives, c.distanceM, c.energyWh)
			if s.Drives != c.wantDrives {
				t.Errorf("Drives = %d, want %d", s.Drives, c.wantDrives)
			}
			if !approxEqual(s.DistanceKm, c.wantDistanceKm) {
				t.Errorf("DistanceKm = %v, want %v", s.DistanceKm, c.wantDistanceKm)
			}
			if !approxEqual(s.EnergyKwh, c.wantEnergyKwh) {
				t.Errorf("EnergyKwh = %v, want %v", s.EnergyKwh, c.wantEnergyKwh)
			}
			if !approxEqual(s.Cost, c.wantCost) {
				t.Errorf("Cost = %v, want %v", s.Cost, c.wantCost)
			}
			if !approxEqual(s.Efficiency, c.wantEfficiency) {
				t.Errorf("Efficiency = %v, want %v", s.Efficiency, c.wantEfficiency)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Get — HTTP handler
// ---------------------------------------------------------------------------

func TestGet_BadVehicleID(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 17, 15, 30, 0, 0, time.UTC)
	cases := []struct {
		name  string
		param string
	}{
		{"missing", ""},
		{"non_numeric", "abc"},
		{"zero", "0"},
		{"negative", "-5"},
		{"float", "1.5"},
		{"overflow", "99999999999999999999999999"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeWeeklyRepo{}
			h := newTestHandler(repo, now)
			rec := httptest.NewRecorder()
			h.Get(rec, reqWithVehicleID(c.param))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "invalid vehicle ID") {
				t.Errorf("body missing 'invalid vehicle ID': %s", rec.Body.String())
			}
			if len(repo.calls) != 0 {
				t.Errorf("repo called %d time(s) for invalid id — must validate first", len(repo.calls))
			}
		})
	}
}

func TestGet_Success(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 17, 15, 30, 0, 0, time.UTC)
	repo := &fakeWeeklyRepo{results: []weekTotalsResult{
		{drives: 5, distanceM: 120000, energyWh: 24000}, // current week
		{drives: 3, distanceM: 90000, energyWh: 18000},  // previous week
	}}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.Get(rec, reqWithVehicleID("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q, want application/json; charset=utf-8", ct)
	}

	body := decodeBody(t, rec)
	// Current week.
	assertFloat(t, body, "drives", 5)
	assertFloat(t, body, "distance_km", 120)
	assertFloat(t, body, "energy_kwh", 24)
	assertFloat(t, body, "cost", 24*costPerKWh)
	assertFloat(t, body, "efficiency", 200)
	// Previous week.
	assertFloat(t, body, "prev_drives", 3)
	assertFloat(t, body, "prev_distance_km", 90)
	assertFloat(t, body, "prev_energy_kwh", 18)
	assertFloat(t, body, "prev_cost", 18*costPerKWh)
	assertFloat(t, body, "prev_efficiency", 200)

	// Window derivation + vehicle propagation. curr = [weekStart, now),
	// prev = [prevWeekStart, weekStart); the two windows must be contiguous
	// and non-overlapping (prev.end == curr.start).
	if len(repo.calls) != 2 {
		t.Fatalf("repo calls = %d, want 2", len(repo.calls))
	}
	weekStart := startOfWeek(now)
	prevWeekStart := weekStart.AddDate(0, 0, -7)
	if got := repo.calls[0]; got.vehicleID != 42 || !got.start.Equal(weekStart) || !got.end.Equal(now) {
		t.Errorf("current-week call = %+v, want {42, %s, %s}", got, weekStart, now)
	}
	if got := repo.calls[1]; got.vehicleID != 42 || !got.start.Equal(prevWeekStart) || !got.end.Equal(weekStart) {
		t.Errorf("previous-week call = %+v, want {42, %s, %s}", got, prevWeekStart, weekStart)
	}
	if !repo.calls[1].end.Equal(repo.calls[0].start) {
		t.Errorf("windows must be contiguous: prev.end=%s, curr.start=%s", repo.calls[1].end, repo.calls[0].start)
	}
}

func TestGet_JSONShape(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 17, 15, 30, 0, 0, time.UTC)
	repo := &fakeWeeklyRepo{results: []weekTotalsResult{{drives: 1, distanceM: 1000, energyWh: 500}}}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.Get(rec, reqWithVehicleID("7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := decodeBody(t, rec)
	wantKeys := []string{
		"drives", "distance_km", "energy_kwh", "cost", "efficiency",
		"prev_drives", "prev_distance_km", "prev_energy_kwh", "prev_cost", "prev_efficiency",
	}
	for _, k := range wantKeys {
		if _, ok := body[k]; !ok {
			t.Errorf("response missing key %q", k)
		}
	}
	if len(body) != len(wantKeys) {
		t.Errorf("response has %d keys, want exactly %d: %v", len(body), len(wantKeys), body)
	}
}

func TestGet_CurrentWeekError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 17, 15, 30, 0, 0, time.UTC)
	repo := &fakeWeeklyRepo{results: []weekTotalsResult{{err: errors.New("connection reset")}}}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.Get(rec, reqWithVehicleID("42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "failed to load weekly digest") {
		t.Errorf("body missing error message: %s", rec.Body.String())
	}
	// The previous-week read must be short-circuited once the current-week
	// read fails.
	if len(repo.calls) != 1 {
		t.Errorf("repo calls = %d, want 1 (short-circuit on current-week error)", len(repo.calls))
	}
}

func TestGet_PreviousWeekError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 17, 15, 30, 0, 0, time.UTC)
	repo := &fakeWeeklyRepo{results: []weekTotalsResult{
		{drives: 5, distanceM: 120000, energyWh: 24000},
		{err: errors.New("statement timeout")},
	}}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.Get(rec, reqWithVehicleID("42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.calls) != 2 {
		t.Errorf("repo calls = %d, want 2 (current ok, previous failed)", len(repo.calls))
	}
}

func TestGet_EmptyData_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 17, 15, 30, 0, 0, time.UTC)
	// No canned results -> the fake returns zero totals for both weeks,
	// modelling a vehicle with no drives.
	repo := &fakeWeeklyRepo{}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.Get(rec, reqWithVehicleID("42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (empty data is a valid 200, not an error)", rec.Code)
	}
	body := decodeBody(t, rec)
	for _, k := range []string{
		"drives", "distance_km", "energy_kwh", "cost", "efficiency",
		"prev_drives", "prev_distance_km", "prev_energy_kwh", "prev_cost", "prev_efficiency",
	} {
		assertFloat(t, body, k, 0)
	}
	if len(repo.calls) != 2 {
		t.Errorf("repo calls = %d, want 2 (both windows queried)", len(repo.calls))
	}
}

// TestGet_UsesRequestContext proves the handler derives its query context
// from the incoming request: cancelling the request cancels the context the
// repo observes.
func TestGet_UsesRequestContext(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 17, 15, 30, 0, 0, time.UTC)

	seen := make(chan context.Context, 1)
	repo := &ctxCapturingRepo{seen: seen}
	h := newTestHandler(repo, now)

	ctx, cancel := context.WithCancel(context.Background())
	r := reqWithVehicleID("42").WithContext(context.WithValue(ctx, chi.RouteCtxKey, routeCtx("42")))
	cancel() // request already cancelled before handling

	rec := httptest.NewRecorder()
	h.Get(rec, r)

	got := <-seen
	if got.Err() == nil {
		t.Error("handler context not derived from request: cancelled request did not cancel query context")
	}
}

// routeCtx builds a chi route context carrying a vehicleID param, used when
// a test needs to attach its own base context to the request.
func routeCtx(param string) *chi.Context {
	rc := chi.NewRouteContext()
	rc.URLParams.Add("vehicleID", param)
	return rc
}

// ctxCapturingRepo records the context of the first WeekTotals call.
type ctxCapturingRepo struct {
	seen chan context.Context
}

func (r *ctxCapturingRepo) WeekTotals(ctx context.Context, _ int64, _, _ time.Time) (int, float64, float64, error) {
	select {
	case r.seen <- ctx:
	default:
	}
	return 0, 0, 0, nil
}

var _ weeklyRepository = (*ctxCapturingRepo)(nil)

// ---------------------------------------------------------------------------
// Constructors + clock fallback
// ---------------------------------------------------------------------------

// TestNewHandler wires the production constructor. pgxpool.New parses the
// DSN but (with default MinConns=0) never opens a connection, so this
// exercises NewHandler + newDBWeeklyRepo's happy path without a DB.
func TestNewHandler(t *testing.T) {
	t.Parallel()
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/db")
	if err != nil {
		t.Fatalf("pgxpool.New (parse-only) failed: %v", err)
	}
	defer pool.Close()

	h := NewHandler(&database.DB{Pool: pool})
	if h == nil {
		t.Fatal("NewHandler returned nil")
	}
	if h.repo == nil {
		t.Fatal("handler repo not wired")
	}
	if _, ok := h.repo.(*dbWeeklyRepo); !ok {
		t.Errorf("repo type = %T, want *dbWeeklyRepo", h.repo)
	}
}

func TestNewDBWeeklyRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		db   *database.DB
	}{
		{"nil_db", nil},
		{"nil_pool", &database.DB{Pool: nil}},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			defer func() {
				if recover() == nil {
					t.Errorf("newDBWeeklyRepo(%s) did not panic", c.name)
				}
			}()
			_ = newDBWeeklyRepo(c.db)
		})
	}
}

// TestNow_WallClockFallback covers the nil-clock branch of now().
func TestNow_WallClockFallback(t *testing.T) {
	t.Parallel()
	h := &Handler{} // no injected clock
	before := time.Now()
	got := h.now()
	after := time.Now()
	if got.Before(before.Add(-time.Second)) || got.After(after.Add(time.Second)) {
		t.Errorf("now() = %v, want within [%v, %v]", got, before, after)
	}
}

// ---------------------------------------------------------------------------
// dbWeeklyRepo — pgx-backed repo (via fake pool)
// ---------------------------------------------------------------------------

func TestDBWeeklyRepo_WeekTotals(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 6, 7, 0, 0, 0, 0, time.UTC)
	end := time.Date(2026, 6, 14, 0, 0, 0, 0, time.UTC)

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		var gotSQL string
		var gotArgs []any
		pool := &fakePool{queryRowFn: func(_ context.Context, sql string, args ...any) pgx.Row {
			gotSQL = sql
			gotArgs = args
			return scanRow{scanFn: func(dest ...any) error {
				*(dest[0].(*int)) = 7
				*(dest[1].(*float64)) = 123456.0
				*(dest[2].(*float64)) = 65432.0
				return nil
			}}
		}}
		repo := &dbWeeklyRepo{pool: pool}
		drives, distM, energyWh, err := repo.WeekTotals(context.Background(), 99, start, end)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if drives != 7 || distM != 123456.0 || energyWh != 65432.0 {
			t.Errorf("got (%d, %v, %v), want (7, 123456, 65432)", drives, distM, energyWh)
		}
		if !strings.Contains(gotSQL, "FROM drives") {
			t.Errorf("sql missing 'FROM drives': %s", gotSQL)
		}
		if len(gotArgs) != 3 {
			t.Fatalf("args = %v, want 3 (vehicleID, start, end)", gotArgs)
		}
		if gotArgs[0].(int64) != 99 {
			t.Errorf("args[0] = %v, want 99", gotArgs[0])
		}
		if !gotArgs[1].(time.Time).Equal(start) || !gotArgs[2].(time.Time).Equal(end) {
			t.Errorf("args window = [%v, %v], want [%v, %v]", gotArgs[1], gotArgs[2], start, end)
		}
	})

	t.Run("scan_error_wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("no rows")
		pool := &fakePool{queryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
			return scanRow{scanFn: func(_ ...any) error { return sentinel }}
		}}
		repo := &dbWeeklyRepo{pool: pool}
		drives, distM, energyWh, err := repo.WeekTotals(context.Background(), 1, start, end)
		if err == nil {
			t.Fatal("err = nil, want wrapped error")
		}
		if !errors.Is(err, sentinel) {
			t.Errorf("err = %v, want wrapping sentinel", err)
		}
		if !strings.Contains(err.Error(), "query weekly drive totals") {
			t.Errorf("err = %q, want 'query weekly drive totals' context prefix", err.Error())
		}
		if drives != 0 || distM != 0 || energyWh != 0 {
			t.Errorf("on error got (%d, %v, %v), want all zero", drives, distM, energyWh)
		}
	})
}

// TestWeekTotalsSQL_Shape pins the canonical SI column list and the
// half-open [start, end) window so the two week windows can never
// double-count a drive landing exactly on the Sunday-midnight boundary.
func TestWeekTotalsSQL_Shape(t *testing.T) {
	t.Parallel()
	for _, frag := range []string{
		"COUNT(*)",
		"SUM(distance_m)",
		"energy_used_wh",
		"FROM drives",
		"vehicle_id = $1",
		"started_at >= $2",
		"started_at < $3",
	} {
		if !strings.Contains(weekTotalsSQL, frag) {
			t.Errorf("weekTotalsSQL missing %q:\n%s", frag, weekTotalsSQL)
		}
	}
	if strings.Contains(weekTotalsSQL, "started_at <=") {
		t.Errorf("weekTotalsSQL upper bound must be exclusive '<', found '<=':\n%s", weekTotalsSQL)
	}
	// No legacy unit-suffixed columns (SI-canonical contract).
	for _, banned := range []string{"distance_mi", "energy_used_kwh", "distance_km", "energy_kwh"} {
		if strings.Contains(weekTotalsSQL, banned) {
			t.Errorf("weekTotalsSQL must read SI columns, found legacy %q:\n%s", banned, weekTotalsSQL)
		}
	}
}
