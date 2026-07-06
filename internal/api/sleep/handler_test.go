package sleep

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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// fakeSleepRepo is the in-memory sleepRepository used by handler tests so
// GetSleepAnalytics can be exercised end-to-end without a live pgx pool.
type fakeSleepRepo struct {
	vin    string
	model  *string
	vinErr error

	states    []stateCount
	statesErr error

	baseCost    float64
	baseCostErr error

	gotVINCalls   []int64
	gotStateCalls []stateDistCall
	gotBaseCalls  int
}

type stateDistCall struct {
	vehicleID int64
	from, to  time.Time
}

func (f *fakeSleepRepo) VehicleVINModel(_ context.Context, vehicleID int64) (string, *string, error) {
	f.gotVINCalls = append(f.gotVINCalls, vehicleID)
	if f.vinErr != nil {
		return "", nil, f.vinErr
	}
	return f.vin, f.model, nil
}

func (f *fakeSleepRepo) StateDistribution(_ context.Context, vehicleID int64, from, to time.Time) ([]stateCount, error) {
	f.gotStateCalls = append(f.gotStateCalls, stateDistCall{vehicleID, from, to})
	if f.statesErr != nil {
		return nil, f.statesErr
	}
	return f.states, nil
}

func (f *fakeSleepRepo) BaseCostPerKWh(_ context.Context) (float64, error) {
	f.gotBaseCalls++
	if f.baseCostErr != nil {
		return 0, f.baseCostErr
	}
	return f.baseCost, nil
}

var _ sleepRepository = (*fakeSleepRepo)(nil)

func newTestHandler(repo sleepRepository, now time.Time) *SleepHandler {
	return &SleepHandler{repo: repo, clock: func() time.Time { return now }}
}

func getReq(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

func strPtr(s string) *string { return &s }

// scanRow is a single-row pgx.Row whose Scan behaviour is supplied per test.
type scanRow struct{ scanFn func(dest ...any) error }

func (r scanRow) Scan(dest ...any) error { return r.scanFn(dest...) }

var _ pgx.Row = scanRow{}

// fakeStateRows is a minimal pgx.Rows over a fixed slice of stateCount so
// the dbSleepRepo scan loop (including the rows.Err() bug fix and the
// skip-on-scan-error resilience) can be tested without a database.
type fakeStateRows struct {
	rows      []stateCount
	scanErrAt int // row index whose Scan returns an error; -1 = never
	iterErr   error
	pos       int
	closed    bool
}

func (r *fakeStateRows) Next() bool {
	if r.pos >= len(r.rows) {
		return false
	}
	r.pos++
	return true
}

func (r *fakeStateRows) Scan(dest ...any) error {
	i := r.pos - 1
	if i == r.scanErrAt {
		return errors.New("scan failure")
	}
	row := r.rows[i]
	if len(dest) >= 3 {
		if p, ok := dest[0].(*string); ok {
			*p = row.State
		}
		if p, ok := dest[1].(*int); ok {
			*p = row.Count
		}
		if p, ok := dest[2].(*float64); ok {
			*p = row.TotalMinutes
		}
	}
	return nil
}

func (r *fakeStateRows) Close()                                       { r.closed = true }
func (r *fakeStateRows) Err() error                                   { return r.iterErr }
func (r *fakeStateRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeStateRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeStateRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeStateRows) RawValues() [][]byte                          { return nil }
func (r *fakeStateRows) Conn() *pgx.Conn                              { return nil }

var _ pgx.Rows = (*fakeStateRows)(nil)

// fakePool is a sleepPool whose Query/QueryRow behaviour is supplied per test.
type fakePool struct {
	queryFn    func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	queryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
}

func (p *fakePool) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return p.queryFn(ctx, sql, args...)
}

func (p *fakePool) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return p.queryRowFn(ctx, sql, args...)
}

var _ sleepPool = (*fakePool)(nil)

// ---------------------------------------------------------------------------
// estimateBatteryCapacityWh — pure function
// ---------------------------------------------------------------------------

func TestEstimateBatteryCapacityWh(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		vin        string
		model      string
		wantWh     float64
		wantSource string
	}{
		{"vin_E_60kwh", "1234567E", "", 60000.0, "vin_estimate"},
		{"vin_F_60kwh", "1234567F", "", 60000.0, "vin_estimate"},
		{"vin_K_75kwh", "1234567K", "", 75000.0, "vin_estimate"},
		{"vin_L_75kwh", "1234567L", "", 75000.0, "vin_estimate"},
		{"vin_M_75kwh", "1234567M", "", 75000.0, "vin_estimate"},
		{"vin_S_100kwh", "1234567S", "", 100000.0, "vin_estimate"},
		{"vin_A_100kwh", "1234567A", "", 100000.0, "vin_estimate"},
		{"vin_P_100kwh", "1234567P", "", 100000.0, "vin_estimate"},
		{"vin_unknown_char_falls_to_default", "1234567Z", "", 75000.0, "default"},
		{"vin_unknown_char_falls_to_model_s", "1234567Z", "Model S", 100000.0, "model_estimate"},
		{"vin_unknown_char_model_x_uppercase", "1234567Z", "MODEL X", 100000.0, "model_estimate"},
		{"vin_too_short_7_chars", "1234567", "", 75000.0, "default"},
		{"vin_too_short_uses_model_s", "", "Model S", 100000.0, "model_estimate"},
		{"vin_too_short_model_3_default", "", "Model 3", 75000.0, "default"},
		{"empty_everything_default", "", "", 75000.0, "default"},
		{"model_x_lowercase", "", "model x", 100000.0, "model_estimate"},
		{"vin_precedence_over_model", "1234567K", "Model S", 75000.0, "vin_estimate"},
		{"long_vin_index7_S", "1234567S9999999", "Model 3", 100000.0, "vin_estimate"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			gotWh, gotSrc := estimateBatteryCapacityWh(c.vin, c.model)
			if gotWh != c.wantWh {
				t.Errorf("estimateBatteryCapacityWh(%q, %q) wh = %v, want %v", c.vin, c.model, gotWh, c.wantWh)
			}
			if gotSrc != c.wantSource {
				t.Errorf("estimateBatteryCapacityWh(%q, %q) source = %q, want %q", c.vin, c.model, gotSrc, c.wantSource)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// resolveCapacity — pure function
// ---------------------------------------------------------------------------

func TestResolveCapacity(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name       string
		vin        string
		model      *string
		lookupErr  error
		wantWh     float64
		wantSource string
	}{
		{"lookup_error_defaults", "1234567S", strPtr("Model S"), errors.New("db down"), 75000.0, "default"},
		{"vin_estimate_used", "1234567S", nil, nil, 100000.0, "vin_estimate"},
		{"nil_model_default", "1234567Z", nil, nil, 75000.0, "default"},
		{"model_ptr_used_when_vin_unknown", "1234567Z", strPtr("Model X"), nil, 100000.0, "model_estimate"},
		{"empty_vin_model_ptr", "", strPtr("Model S"), nil, 100000.0, "model_estimate"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			gotWh, gotSrc := resolveCapacity(c.vin, c.model, c.lookupErr)
			if gotWh != c.wantWh {
				t.Errorf("resolveCapacity wh = %v, want %v", gotWh, c.wantWh)
			}
			if gotSrc != c.wantSource {
				t.Errorf("resolveCapacity source = %q, want %q", gotSrc, c.wantSource)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// resolveWindow — request window derivation
// ---------------------------------------------------------------------------

func TestResolveWindow(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)

	t.Run("no_params_defaults_to_30d", func(t *testing.T) {
		t.Parallel()
		days, from, to := resolveWindow(getReq("/analytics/sleep?vehicle_id=1"), now)
		if days != 30 {
			t.Errorf("days = %d, want 30", days)
		}
		if !to.Equal(now) {
			t.Errorf("to = %v, want %v", to, now)
		}
		if !from.Equal(now.Add(-30 * 24 * time.Hour)) {
			t.Errorf("from = %v, want %v", from, now.Add(-30*24*time.Hour))
		}
	})

	t.Run("days_param_honoured", func(t *testing.T) {
		t.Parallel()
		days, from, to := resolveWindow(getReq("/analytics/sleep?vehicle_id=1&days=7"), now)
		if days != 7 {
			t.Errorf("days = %d, want 7", days)
		}
		if !from.Equal(now.Add(-7 * 24 * time.Hour)) {
			t.Errorf("from = %v, want %v", from, now.Add(-7*24*time.Hour))
		}
		if !to.Equal(now) {
			t.Errorf("to = %v, want now", to)
		}
	})

	invalidDays := []struct {
		name  string
		query string
	}{
		{"zero", "days=0"},
		{"negative", "days=-5"},
		{"over_max", "days=400"},
		{"non_numeric", "days=abc"},
	}
	for _, c := range invalidDays {
		c := c
		t.Run("invalid_days_"+c.name, func(t *testing.T) {
			t.Parallel()
			days, _, _ := resolveWindow(getReq("/analytics/sleep?vehicle_id=1&"+c.query), now)
			if days != 30 {
				t.Errorf("days = %d, want default 30 for %q", days, c.query)
			}
		})
	}

	t.Run("date_range_takes_precedence", func(t *testing.T) {
		t.Parallel()
		days, from, to := resolveWindow(getReq("/analytics/sleep?vehicle_id=1&start=2026-06-01&end=2026-06-11&days=7"), now)
		wantFrom := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
		wantTo := time.Date(2026, 6, 11, 23, 59, 59, 0, time.UTC)
		if !from.Equal(wantFrom) {
			t.Errorf("from = %v, want %v", from, wantFrom)
		}
		if !to.Equal(wantTo) {
			t.Errorf("to = %v, want %v", to, wantTo)
		}
		if days != 11 {
			t.Errorf("days = %d, want 11 (derived from range, not days param)", days)
		}
	})

	t.Run("start_only_uses_now_as_end", func(t *testing.T) {
		t.Parallel()
		_, from, to := resolveWindow(getReq("/analytics/sleep?vehicle_id=1&start=2026-06-10"), now)
		wantFrom := time.Date(2026, 6, 10, 0, 0, 0, 0, time.UTC)
		if !from.Equal(wantFrom) {
			t.Errorf("from = %v, want %v", from, wantFrom)
		}
		if !to.Equal(now) {
			t.Errorf("to = %v, want now %v", to, now)
		}
	})
}

// ---------------------------------------------------------------------------
// summarizeStates — distribution + efficiency math
// ---------------------------------------------------------------------------

func TestSummarizeStates(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name           string
		in             []stateCount
		wantLen        int
		wantEfficiency float64
	}{
		{"nil_returns_empty_non_nil", nil, 0, 0},
		{"empty_returns_empty", []stateCount{}, 0, 0},
		{
			"no_asleep_zero_efficiency",
			[]stateCount{{State: "online", Count: 4, TotalMinutes: 100}},
			1, 0,
		},
		{
			"asleep_over_total",
			[]stateCount{{State: "asleep", Count: 3, TotalMinutes: 600}, {State: "online", Count: 5, TotalMinutes: 400}},
			2, 60,
		},
		{
			"zero_total_no_div_by_zero",
			[]stateCount{{State: "asleep", Count: 0, TotalMinutes: 0}, {State: "online", Count: 0, TotalMinutes: 0}},
			2, 0,
		},
		{
			"three_states",
			[]stateCount{{State: "asleep", Count: 1, TotalMinutes: 30}, {State: "driving", Count: 1, TotalMinutes: 30}, {State: "online", Count: 1, TotalMinutes: 40}},
			3, 30,
		},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			dist, eff := summarizeStates(c.in)
			if dist == nil {
				t.Fatal("distribution is nil; must be a non-nil slice for JSON [] semantics")
			}
			if len(dist) != c.wantLen {
				t.Errorf("distribution len = %d, want %d", len(dist), c.wantLen)
			}
			if eff != c.wantEfficiency {
				t.Errorf("efficiency = %v, want %v", eff, c.wantEfficiency)
			}
		})
	}
}

func TestSummarizeStates_CarriesFields(t *testing.T) {
	t.Parallel()
	dist, _ := summarizeStates([]stateCount{{State: "asleep", Count: 7, TotalMinutes: 123.5}})
	if len(dist) != 1 {
		t.Fatalf("len = %d, want 1", len(dist))
	}
	if dist[0].State != "asleep" || dist[0].Count != 7 || dist[0].TotalMinutes != 123.5 {
		t.Errorf("entry = %+v, want {asleep 7 123.5}", dist[0])
	}
}

// ---------------------------------------------------------------------------
// GetSleepAnalytics — HTTP handler
// ---------------------------------------------------------------------------

func TestGetSleepAnalytics_BadVehicleID(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name  string
		query string
	}{
		{"missing", ""},
		{"empty", "vehicle_id="},
		{"non_numeric", "vehicle_id=abc"},
		{"zero", "vehicle_id=0"},
		{"negative", "vehicle_id=-5"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeSleepRepo{}
			h := newTestHandler(repo, now)
			rec := httptest.NewRecorder()
			h.GetSleepAnalytics(rec, getReq("/analytics/sleep?"+c.query))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "vehicle_id required") {
				t.Errorf("body missing 'vehicle_id required'\nbody=%s", rec.Body.String())
			}
			if len(repo.gotVINCalls) != 0 || len(repo.gotStateCalls) != 0 {
				t.Errorf("repo called for invalid vehicle_id — must validate first (vin=%d state=%d)",
					len(repo.gotVINCalls), len(repo.gotStateCalls))
			}
		})
	}
}

func TestGetSleepAnalytics_Success(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeSleepRepo{
		vin:      "1234567S", // index 7 = 'S' -> 100000 Wh vin_estimate
		model:    strPtr("Model S"),
		states:   []stateCount{{State: "asleep", Count: 3, TotalMinutes: 600}, {State: "online", Count: 5, TotalMinutes: 400}},
		baseCost: 0.15,
	}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q, want application/json; charset=utf-8", ct)
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}

	if got := body["vehicle_id"].(float64); got != 42 {
		t.Errorf("vehicle_id = %v, want 42", got)
	}
	if got := body["period_days"].(float64); got != 30 {
		t.Errorf("period_days = %v, want 30", got)
	}
	if got := body["battery_capacity_wh"].(float64); got != 100000 {
		t.Errorf("battery_capacity_wh = %v, want 100000", got)
	}
	if got := body["capacity_source"].(string); got != "vin_estimate" {
		t.Errorf("capacity_source = %q, want vin_estimate", got)
	}
	if got := body["base_cost_per_kwh"].(float64); got != 0.15 {
		t.Errorf("base_cost_per_kwh = %v, want 0.15", got)
	}
	if got := body["sleep_efficiency_pct"].(float64); got != 60 {
		t.Errorf("sleep_efficiency_pct = %v, want 60", got)
	}
	dist, ok := body["state_distribution"].([]any)
	if !ok || len(dist) != 2 {
		t.Fatalf("state_distribution = %v, want 2-element array", body["state_distribution"])
	}
	first := dist[0].(map[string]any)
	for _, k := range []string{"state", "count", "total_minutes"} {
		if _, ok := first[k]; !ok {
			t.Errorf("state entry missing key %q", k)
		}
	}

	// Repo interactions.
	if len(repo.gotVINCalls) != 1 || repo.gotVINCalls[0] != 42 {
		t.Errorf("VehicleVINModel calls = %v, want [42]", repo.gotVINCalls)
	}
	if len(repo.gotStateCalls) != 1 || repo.gotStateCalls[0].vehicleID != 42 {
		t.Fatalf("StateDistribution calls = %v, want 1 for vehicle 42", repo.gotStateCalls)
	}
	call := repo.gotStateCalls[0]
	if !call.to.Equal(now) {
		t.Errorf("StateDistribution.to = %v, want now %v", call.to, now)
	}
	if !call.from.Equal(now.Add(-30 * 24 * time.Hour)) {
		t.Errorf("StateDistribution.from = %v, want %v", call.from, now.Add(-30*24*time.Hour))
	}
}

func TestGetSleepAnalytics_JSONShape(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeSleepRepo{vin: "1234567K", baseCost: 0.12}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	wantKeys := []string{
		"vehicle_id", "period_days", "state_distribution", "sleep_efficiency_pct",
		"time_to_sleep_avg_min", "sentry_comparison", "sentry_on_drain_rate",
		"sentry_off_drain_rate", "sentry_monthly_kwh", "sentry_monthly_cost",
		"sentry_extra_drain_rate", "sentry_extra_monthly_kwh", "sentry_extra_monthly_cost",
		"battery_capacity_wh", "capacity_source", "base_cost_per_kwh",
		"recent_events", "total_events", "avg_sentry_duration_hours",
	}
	for _, k := range wantKeys {
		if _, ok := body[k]; !ok {
			t.Errorf("response missing key %q", k)
		}
	}
	// Preserved-but-empty legacy arrays must be JSON [] (non-null).
	if sc, ok := body["sentry_comparison"].([]any); !ok || len(sc) != 0 {
		t.Errorf("sentry_comparison = %v, want empty array", body["sentry_comparison"])
	}
	if re, ok := body["recent_events"].([]any); !ok || len(re) != 0 {
		t.Errorf("recent_events = %v, want empty array", body["recent_events"])
	}
	if te := body["total_events"].(float64); te != 0 {
		t.Errorf("total_events = %v, want 0", te)
	}
}

func TestGetSleepAnalytics_StateDistributionError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeSleepRepo{
		vin:       "1234567K",
		statesErr: errors.New("connection reset"),
	}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "failed to get sleep data") {
		t.Errorf("body missing 'failed to get sleep data'\nbody=%s", rec.Body.String())
	}
}

func TestGetSleepAnalytics_CapacityLookupError_Degrades(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeSleepRepo{
		vinErr:   errors.New("vehicle not found"),
		states:   []stateCount{},
		baseCost: 0.12,
	}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=999"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (capacity error must not fail the request; body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := body["battery_capacity_wh"].(float64); got != 75000 {
		t.Errorf("battery_capacity_wh = %v, want 75000 default", got)
	}
	if got := body["capacity_source"].(string); got != "default" {
		t.Errorf("capacity_source = %q, want default", got)
	}
	// StateDistribution must still be reached despite the capacity error.
	if len(repo.gotStateCalls) != 1 {
		t.Errorf("StateDistribution calls = %d, want 1", len(repo.gotStateCalls))
	}
}

func TestGetSleepAnalytics_BaseCostError_Degrades(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeSleepRepo{
		vin:         "1234567K",
		states:      []stateCount{},
		baseCostErr: errors.New("settings table locked"),
	}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (base-cost error must not fail the request; body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := body["base_cost_per_kwh"].(float64); got != 0.12 {
		t.Errorf("base_cost_per_kwh = %v, want 0.12 default", got)
	}
}

func TestGetSleepAnalytics_EmptyStates_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeSleepRepo{vin: "1234567K", states: nil, baseCost: 0.12}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// state_distribution must be [] not null even with no rows.
	if !strings.Contains(rec.Body.String(), `"state_distribution":[]`) {
		t.Errorf("state_distribution must serialize as [] (non-null)\nbody=%s", rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := body["sleep_efficiency_pct"].(float64); got != 0 {
		t.Errorf("sleep_efficiency_pct = %v, want 0 for no data", got)
	}
}

func TestGetSleepAnalytics_DaysParam_Window(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeSleepRepo{vin: "1234567K", baseCost: 0.12}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=42&days=7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := body["period_days"].(float64); got != 7 {
		t.Errorf("period_days = %v, want 7", got)
	}
	if len(repo.gotStateCalls) != 1 {
		t.Fatalf("StateDistribution calls = %d, want 1", len(repo.gotStateCalls))
	}
	call := repo.gotStateCalls[0]
	if !call.from.Equal(now.Add(-7*24*time.Hour)) || !call.to.Equal(now) {
		t.Errorf("window = [%v, %v], want [%v, %v]", call.from, call.to, now.Add(-7*24*time.Hour), now)
	}
}

func TestGetSleepAnalytics_DateRange_Window(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	repo := &fakeSleepRepo{vin: "1234567K", baseCost: 0.12}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=42&start=2026-06-01&end=2026-06-11"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := body["period_days"].(float64); got != 11 {
		t.Errorf("period_days = %v, want 11 (derived from explicit range)", got)
	}
	call := repo.gotStateCalls[0]
	wantFrom := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 6, 11, 23, 59, 59, 0, time.UTC)
	if !call.from.Equal(wantFrom) || !call.to.Equal(wantTo) {
		t.Errorf("window = [%v, %v], want [%v, %v]", call.from, call.to, wantFrom, wantTo)
	}
}

func TestGetSleepAnalytics_EfficiencyRounding(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	// asleep 1 / total 3 = 33.333% -> rounded to one decimal = 33.3
	repo := &fakeSleepRepo{
		vin:      "1234567K",
		states:   []stateCount{{State: "asleep", Count: 1, TotalMinutes: 100}, {State: "online", Count: 2, TotalMinutes: 200}},
		baseCost: 0.12,
	}
	h := newTestHandler(repo, now)
	rec := httptest.NewRecorder()
	h.GetSleepAnalytics(rec, getReq("/analytics/sleep?vehicle_id=42"))

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got := body["sleep_efficiency_pct"].(float64); got != 33.3 {
		t.Errorf("sleep_efficiency_pct = %v, want 33.3 (rounded to 1 dp)", got)
	}
}

// ---------------------------------------------------------------------------
// dbSleepRepo — pgx-backed repo (via fake pool)
// ---------------------------------------------------------------------------

func TestNewDBSleepRepo_NilPoolPanics(t *testing.T) {
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
					t.Errorf("newDBSleepRepo(%s) did not panic", c.name)
				}
			}()
			_ = newDBSleepRepo(c.db)
		})
	}
}

// TestNewSleepHandler wires the production constructor. pgxpool.New parses
// the DSN but (with default MinConns=0) never opens a connection, so this
// exercises NewSleepHandler + newDBSleepRepo's happy path without a DB.
func TestNewSleepHandler(t *testing.T) {
	t.Parallel()
	pool, err := pgxpool.New(context.Background(), "postgres://u:p@127.0.0.1:1/db")
	if err != nil {
		t.Fatalf("pgxpool.New (parse-only) failed: %v", err)
	}
	defer pool.Close()

	h := NewSleepHandler(&database.DB{Pool: pool})
	if h == nil {
		t.Fatal("NewSleepHandler returned nil")
	}
	if h.repo == nil {
		t.Fatal("handler repo not wired")
	}
	if _, ok := h.repo.(*dbSleepRepo); !ok {
		t.Errorf("repo type = %T, want *dbSleepRepo", h.repo)
	}
}

// TestNow_WallClockFallback covers the nil-clock branch of now().
func TestNow_WallClockFallback(t *testing.T) {
	t.Parallel()
	h := &SleepHandler{}
	before := time.Now().UTC()
	got := h.now()
	after := time.Now().UTC()
	if got.Before(before.Add(-time.Second)) || got.After(after.Add(time.Second)) {
		t.Errorf("now() = %v, want within [%v, %v]", got, before, after)
	}
	if got.Location() != time.UTC {
		t.Errorf("now() location = %v, want UTC", got.Location())
	}
}

func TestDBSleepRepo_VehicleVINModel(t *testing.T) {
	t.Parallel()

	t.Run("success_with_model", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{
			queryRowFn: func(_ context.Context, sql string, args ...any) pgx.Row {
				if !strings.Contains(sql, "FROM vehicles") {
					t.Errorf("unexpected sql: %s", sql)
				}
				if len(args) != 1 || args[0].(int64) != 42 {
					t.Errorf("args = %v, want [42]", args)
				}
				return scanRow{scanFn: func(dest ...any) error {
					*(dest[0].(*string)) = "VINABC"
					*(dest[1].(**string)) = strPtr("Model 3")
					return nil
				}}
			},
		}
		repo := &dbSleepRepo{pool: pool}
		vin, model, err := repo.VehicleVINModel(context.Background(), 42)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if vin != "VINABC" {
			t.Errorf("vin = %q, want VINABC", vin)
		}
		if model == nil || *model != "Model 3" {
			t.Errorf("model = %v, want Model 3", model)
		}
	})

	t.Run("null_model", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{
			queryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
				return scanRow{scanFn: func(dest ...any) error {
					*(dest[0].(*string)) = "VINONLY"
					return nil // leave **string dest[1] as nil
				}}
			},
		}
		repo := &dbSleepRepo{pool: pool}
		vin, model, err := repo.VehicleVINModel(context.Background(), 1)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if vin != "VINONLY" || model != nil {
			t.Errorf("vin=%q model=%v, want VINONLY / nil", vin, model)
		}
	})

	t.Run("scan_error_wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("no rows")
		pool := &fakePool{
			queryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
				return scanRow{scanFn: func(_ ...any) error { return sentinel }}
			},
		}
		repo := &dbSleepRepo{pool: pool}
		_, _, err := repo.VehicleVINModel(context.Background(), 1)
		if err == nil {
			t.Fatal("err = nil, want wrapped error")
		}
		if !errors.Is(err, sentinel) {
			t.Errorf("err = %v, want wrapping %v", err, sentinel)
		}
		if !strings.Contains(err.Error(), "query vehicle vin/model") {
			t.Errorf("err = %q, want context prefix", err.Error())
		}
	})
}

func TestDBSleepRepo_StateDistribution(t *testing.T) {
	t.Parallel()

	from := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 15, 0, 0, 0, 0, time.UTC)

	t.Run("query_error_wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("db down")
		pool := &fakePool{
			queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) {
				return nil, sentinel
			},
		}
		repo := &dbSleepRepo{pool: pool}
		got, err := repo.StateDistribution(context.Background(), 1, from, to)
		if got != nil {
			t.Errorf("rows = %v, want nil on error", got)
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "query fsm_transitions") {
			t.Errorf("err = %v, want wrapped query fsm_transitions", err)
		}
	})

	t.Run("success_multiple_rows", func(t *testing.T) {
		t.Parallel()
		rows := &fakeStateRows{
			rows:      []stateCount{{State: "asleep", Count: 2, TotalMinutes: 0}, {State: "online", Count: 5, TotalMinutes: 0}},
			scanErrAt: -1,
		}
		pool := &fakePool{
			queryFn: func(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
				if !strings.Contains(sql, "FROM fsm_transitions") {
					t.Errorf("unexpected sql: %s", sql)
				}
				if len(args) != 3 || args[0].(int64) != 9 {
					t.Errorf("args = %v, want [9 from to]", args)
				}
				return rows, nil
			},
		}
		repo := &dbSleepRepo{pool: pool}
		got, err := repo.StateDistribution(context.Background(), 9, from, to)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if len(got) != 2 || got[0].State != "asleep" || got[1].State != "online" {
			t.Errorf("rows = %+v, want [asleep online]", got)
		}
		if !rows.closed {
			t.Error("rows.Close() was not called (defer missing)")
		}
	})

	t.Run("scan_error_row_skipped", func(t *testing.T) {
		t.Parallel()
		rows := &fakeStateRows{
			rows:      []stateCount{{State: "asleep", Count: 1}, {State: "bad", Count: 2}, {State: "online", Count: 3}},
			scanErrAt: 1, // middle row fails to scan
		}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbSleepRepo{pool: pool}
		got, err := repo.StateDistribution(context.Background(), 1, from, to)
		if err != nil {
			t.Fatalf("err = %v, want nil (bad row skipped, not fatal)", err)
		}
		if len(got) != 2 {
			t.Fatalf("len = %d, want 2 (middle row skipped)", len(got))
		}
		for _, s := range got {
			if s.State == "bad" {
				t.Error("skipped row leaked into results")
			}
		}
	})

	t.Run("iteration_error_surfaced", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("connection lost mid-stream")
		rows := &fakeStateRows{
			rows:      []stateCount{{State: "asleep", Count: 1}},
			scanErrAt: -1,
			iterErr:   sentinel,
		}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbSleepRepo{pool: pool}
		got, err := repo.StateDistribution(context.Background(), 1, from, to)
		if err == nil {
			t.Fatal("err = nil, want rows.Err() surfaced (regression guard for the missing rows.Err() bug)")
		}
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "iterate fsm_transitions rows") {
			t.Errorf("err = %v, want wrapped iterate error", err)
		}
		if got != nil {
			t.Errorf("rows = %v, want nil on iteration error", got)
		}
	})

	t.Run("empty_rows_non_nil", func(t *testing.T) {
		t.Parallel()
		rows := &fakeStateRows{rows: nil, scanErrAt: -1}
		pool := &fakePool{queryFn: func(_ context.Context, _ string, _ ...any) (pgx.Rows, error) { return rows, nil }}
		repo := &dbSleepRepo{pool: pool}
		got, err := repo.StateDistribution(context.Background(), 1, from, to)
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if got == nil {
			t.Error("result is nil; repo must return a non-nil empty slice")
		}
		if len(got) != 0 {
			t.Errorf("len = %d, want 0", len(got))
		}
	})
}

func TestDBSleepRepo_BaseCostPerKWh(t *testing.T) {
	t.Parallel()

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{
			queryRowFn: func(_ context.Context, sql string, _ ...any) pgx.Row {
				if !strings.Contains(sql, "base_cost_per_kwh") {
					t.Errorf("unexpected sql: %s", sql)
				}
				return scanRow{scanFn: func(dest ...any) error {
					*(dest[0].(*float64)) = 0.23
					return nil
				}}
			},
		}
		repo := &dbSleepRepo{pool: pool}
		got, err := repo.BaseCostPerKWh(context.Background())
		if err != nil {
			t.Fatalf("err = %v, want nil", err)
		}
		if got != 0.23 {
			t.Errorf("cost = %v, want 0.23", got)
		}
	})

	t.Run("scan_error_wrapped", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("boom")
		pool := &fakePool{
			queryRowFn: func(_ context.Context, _ string, _ ...any) pgx.Row {
				return scanRow{scanFn: func(_ ...any) error { return sentinel }}
			},
		}
		repo := &dbSleepRepo{pool: pool}
		_, err := repo.BaseCostPerKWh(context.Background())
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "query base_cost_per_kwh") {
			t.Errorf("err = %v, want wrapped base_cost_per_kwh error", err)
		}
	})
}

// ---------------------------------------------------------------------------
// baseCost handler helper — pgx.ErrNoRows is a non-warning fallback
// ---------------------------------------------------------------------------

func TestBaseCostHelper(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		cost float64
		err  error
		want float64
	}{
		{"value_passed_through", 0.31, nil, 0.31},
		{"generic_error_defaults", 0, errors.New("db down"), defaultBaseCostPerKWh},
		{"no_rows_defaults_quietly", 0, pgx.ErrNoRows, defaultBaseCostPerKWh},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			h := &SleepHandler{repo: &fakeSleepRepo{baseCost: c.cost, baseCostErr: c.err}}
			got := h.baseCost(context.Background(), 1)
			if got != c.want {
				t.Errorf("baseCost = %v, want %v", got, c.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// SQL-shape pins — catch schema drift without a live DB
// ---------------------------------------------------------------------------

func TestSQLShapes(t *testing.T) {
	t.Parallel()

	t.Run("vehicle_vin_model", func(t *testing.T) {
		t.Parallel()
		for _, frag := range []string{"FROM vehicles", "vin", "model", "id = $1"} {
			if !strings.Contains(vehicleVINModelSQL, frag) {
				t.Errorf("vehicleVINModelSQL missing %q\nSQL: %s", frag, vehicleVINModelSQL)
			}
		}
	})

	t.Run("state_distribution", func(t *testing.T) {
		t.Parallel()
		mustContain := []string{
			"FROM fsm_transitions", "vehicle_id = $1", "fsm_name = 'vehicle'",
			"ts > $2", "ts <= $3", "GROUP BY to_state", "to_state", "COUNT(*)",
		}
		for _, frag := range mustContain {
			if !strings.Contains(stateDistributionSQL, frag) {
				t.Errorf("stateDistributionSQL missing %q\nSQL: %s", frag, stateDistributionSQL)
			}
		}
		// Dropped tables must not reappear (Phase-42 / mig 000187 drift).
		for _, frag := range []string{"vehicle_states", "vampire_drain"} {
			if strings.Contains(stateDistributionSQL, frag) {
				t.Errorf("stateDistributionSQL must not reference dropped table %q", frag)
			}
		}
	})

	t.Run("base_cost", func(t *testing.T) {
		t.Parallel()
		for _, frag := range []string{"COALESCE", "settings", "base_cost_per_kwh", "0.12"} {
			if !strings.Contains(baseCostPerKWhSQL, frag) {
				t.Errorf("baseCostPerKWhSQL missing %q\nSQL: %s", frag, baseCostPerKWhSQL)
			}
		}
	})
}
