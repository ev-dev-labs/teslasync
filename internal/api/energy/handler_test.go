package energy

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	energymodel "github.com/ev-dev-labs/teslasync/internal/models/energy"
	"github.com/ev-dev-labs/teslasync/internal/service"
)

// TestMain silences the global zerolog logger so the intentional
// Error-level lines emitted by the 500 paths don't pollute test output.
func TestMain(m *testing.M) {
	zerolog.SetGlobalLevel(zerolog.Disabled)
	os.Exit(m.Run())
}

// fakeStatsCalculator is the in-memory statsCalculator seam used by the
// energy handler tests so the endpoints can be exercised end-to-end
// without a real *service.EnergyService / pgx pool. It records the
// arguments of the last CalculateStats call so tests can assert the
// derived day-window and vehicle ID without depending on the repository.
type fakeStatsCalculator struct {
	fn    func(ctx context.Context, vehicleID int64, days int) (*service.EnergyStats, error)
	stats *service.EnergyStats
	err   error

	calls     int
	gotVID    int64
	gotDays   int
	gotCtxNil bool
}

func (f *fakeStatsCalculator) CalculateStats(ctx context.Context, vehicleID int64, days int) (*service.EnergyStats, error) {
	f.calls++
	f.gotVID = vehicleID
	f.gotDays = days
	f.gotCtxNil = ctx == nil
	if f.fn != nil {
		return f.fn(ctx, vehicleID, days)
	}
	return f.stats, f.err
}

var _ statsCalculator = (*fakeStatsCalculator)(nil)

// sampleStats returns a fully-populated EnergyStats fixture so response
// assertions can cover every projected key, including the daily breakdown.
func sampleStats() *service.EnergyStats {
	return &service.EnergyStats{
		VehicleID:     42,
		PeriodDays:    7,
		TotalEnergy:   12345.6,
		TotalCost:     9.87,
		TotalDistance: 54321.0,
		AvgEfficiency: 0.2273,
		CO2Saved:      4.9382,
		DailyBreakdown: []*energymodel.EnergyStatsRow{
			{Date: "2026-07-01", EnergyWh: 5000, DistanceM: 22000, EfficiencyWhPerM: 0.2273, Cost: 4.0},
			{Date: "2026-07-02", EnergyWh: 7345.6, DistanceM: 32321, EfficiencyWhPerM: 0.2273, Cost: 5.87},
		},
	}
}

// newStatsRequest builds a request for EnergyHandler.Stats with the chi
// route context wired so apiparams.URLParamInt64(r, "vehicleID") resolves.
// When vehicleID is the sentinel "-" the param is omitted entirely, which
// mirrors an unmatched route (chi.URLParam returns "").
func newStatsRequest(t *testing.T, vehicleID, rawQuery string) *http.Request {
	t.Helper()
	target := "/vehicles/x/energy"
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rc := chi.NewRouteContext()
	if vehicleID != "-" {
		rc.URLParams.Add("vehicleID", vehicleID)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rc))
}

// newAnalyticsRequest builds a request for EnergyHandler.AnalyticsStats.
func newAnalyticsRequest(rawQuery string) *http.Request {
	target := "/analytics/energy"
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	return httptest.NewRequest(http.MethodGet, target, nil)
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v; raw=%s", err, rec.Body.String())
	}
	return body
}

// assertEnergyResponse pins the pre-carve wire contract: all ten JSON keys
// present, the three duplicated energy keys echoing TotalEnergy, and the
// daily breakdown projected as an array of the expected length.
func assertEnergyResponse(t *testing.T, body map[string]any, s *service.EnergyStats) {
	t.Helper()
	numChecks := map[string]float64{
		"vehicle_id":              float64(s.VehicleID),
		"period_days":             float64(s.PeriodDays),
		"total_energy_used_wh":    s.TotalEnergy,
		"total_energy_charged_wh": s.TotalEnergy,
		"total_wh":                s.TotalEnergy,
		"total_cost":              s.TotalCost,
		"total_distance_m":        s.TotalDistance,
		"avg_efficiency_wh_per_m": s.AvgEfficiency,
		"co2_saved_kg":            s.CO2Saved,
	}
	for k, want := range numChecks {
		got, ok := body[k].(float64)
		if !ok {
			t.Fatalf("key %q missing or not numeric: %#v", k, body[k])
		}
		if got != want {
			t.Fatalf("key %q = %v, want %v", k, got, want)
		}
	}
	bd, ok := body["daily_breakdown"].([]any)
	if !ok {
		t.Fatalf("daily_breakdown missing or not an array: %#v", body["daily_breakdown"])
	}
	if len(bd) != len(s.DailyBreakdown) {
		t.Fatalf("daily_breakdown len = %d, want %d", len(bd), len(s.DailyBreakdown))
	}
}

// ---------------------------------------------------------------------------
// Stats — GET /vehicles/{vehicleID}/energy
// ---------------------------------------------------------------------------

func TestEnergyHandler_Stats_Success(t *testing.T) {
	fake := &fakeStatsCalculator{stats: sampleStats()}
	h := &EnergyHandler{energySvc: fake}

	rec := httptest.NewRecorder()
	h.Stats(rec, newStatsRequest(t, "42", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	if fake.calls != 1 {
		t.Fatalf("CalculateStats calls = %d, want 1", fake.calls)
	}
	if fake.gotVID != 42 {
		t.Fatalf("CalculateStats vehicleID = %d, want 42", fake.gotVID)
	}
	if fake.gotDays != defaultStatsDays {
		t.Fatalf("CalculateStats days = %d, want %d (default)", fake.gotDays, defaultStatsDays)
	}
	if fake.gotCtxNil {
		t.Fatalf("CalculateStats received a nil context; want the request context")
	}

	body := decodeBody(t, rec)
	assertEnergyResponse(t, body, fake.stats)

	// Drill into the first breakdown row to prove the nested rows are
	// serialised with their snake_case SI keys (not dropped or renamed).
	bd := body["daily_breakdown"].([]any)
	first, ok := bd[0].(map[string]any)
	if !ok {
		t.Fatalf("daily_breakdown[0] not an object: %#v", bd[0])
	}
	if first["date"] != "2026-07-01" {
		t.Fatalf("daily_breakdown[0].date = %#v, want 2026-07-01", first["date"])
	}
	if ewh, _ := first["energy_wh"].(float64); ewh != 5000 {
		t.Fatalf("daily_breakdown[0].energy_wh = %#v, want 5000", first["energy_wh"])
	}
	if _, present := first["efficiency_wh_per_m"]; !present {
		t.Fatalf("daily_breakdown[0] missing efficiency_wh_per_m; got=%v", first)
	}
}

func TestEnergyHandler_Stats_DaysDerivation(t *testing.T) {
	tests := []struct {
		name     string
		rawQuery string
		wantDays int
	}{
		{"no params -> default", "", defaultStatsDays},
		{"explicit days", "days=14", 14},
		{"days zero falls back", "days=0", defaultStatsDays},
		{"days negative falls back", "days=-5", defaultStatsDays},
		{"days over cap falls back", "days=99999", defaultStatsDays},
		{"days non-numeric falls back", "days=abc", defaultStatsDays},
		{"days at cap boundary", "days=3650", maxDays},
		{"start future clamps to 1", "start=2999-01-01", 1},
		{"start invalid ignored -> default", "start=not-a-date", defaultStatsDays},
		{"start very old capped at maxDays", "start=1900-01-01", maxDays},
		{"start present ignores days param", "start=2999-01-01&days=14", 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeStatsCalculator{stats: sampleStats()}
			h := &EnergyHandler{energySvc: fake}

			rec := httptest.NewRecorder()
			h.Stats(rec, newStatsRequest(t, "7", tt.rawQuery))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if fake.gotDays != tt.wantDays {
				t.Fatalf("days = %d, want %d", fake.gotDays, tt.wantDays)
			}
		})
	}
}

// TestEnergyHandler_Stats_RecentStartWindow covers the happy path of the
// `start`-date branch — a recent date must map to a positive day count
// derived from daysSince, not the default. Uses an exact 10-day duration
// so the result is deterministic regardless of DST.
func TestEnergyHandler_Stats_RecentStartWindow(t *testing.T) {
	start := time.Now().Add(-10 * 24 * time.Hour)
	fake := &fakeStatsCalculator{stats: sampleStats()}
	h := &EnergyHandler{energySvc: fake}

	rec := httptest.NewRecorder()
	h.Stats(rec, newStatsRequest(t, "7", "start="+start.Format("2006-01-02")))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	// The handler parses the date at day precision; recompute the expected
	// window from that same parsed instant to stay robust across midnight.
	parsed, _ := time.Parse("2006-01-02", start.Format("2006-01-02"))
	want := daysSince(parsed)
	if fake.gotDays != want {
		t.Fatalf("days = %d, want %d (daysSince recompute)", fake.gotDays, want)
	}
	if fake.gotDays < 10 {
		t.Fatalf("days = %d, want >= 10 for a 10-day-old start", fake.gotDays)
	}
}

func TestEnergyHandler_Stats_BadVehicleID(t *testing.T) {
	tests := []struct {
		name      string
		vehicleID string
	}{
		{"non-numeric", "abc"},
		{"missing param", "-"},
		{"overflow", "99999999999999999999999999"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeStatsCalculator{stats: sampleStats()}
			h := &EnergyHandler{energySvc: fake}

			rec := httptest.NewRecorder()
			h.Stats(rec, newStatsRequest(t, tt.vehicleID, ""))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if fake.calls != 0 {
				t.Fatalf("CalculateStats called %d times on bad request, want 0", fake.calls)
			}
			body := decodeBody(t, rec)
			if body["error"] != "invalid vehicle ID" {
				t.Fatalf("error = %#v, want 'invalid vehicle ID'", body["error"])
			}
			if body["code"] != "BAD_REQUEST" {
				t.Fatalf("code = %#v, want BAD_REQUEST", body["code"])
			}
		})
	}
}

func TestEnergyHandler_Stats_ServiceError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStatsCalculator{err: wantErr}
	h := &EnergyHandler{energySvc: fake}

	rec := httptest.NewRecorder()
	h.Stats(rec, newStatsRequest(t, "42", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["error"] != "failed to get energy stats" {
		t.Fatalf("error = %#v, want 'failed to get energy stats'", body["error"])
	}
	if body["code"] != "INTERNAL_ERROR" {
		t.Fatalf("code = %#v, want INTERNAL_ERROR", body["code"])
	}
}

// TestEnergyHandler_Stats_NilStats locks the nil-deref guard: a (nil, nil)
// return from the calculator must surface as 500, never a panic.
func TestEnergyHandler_Stats_NilStats(t *testing.T) {
	fake := &fakeStatsCalculator{stats: nil, err: nil}
	h := &EnergyHandler{energySvc: fake}

	rec := httptest.NewRecorder()
	h.Stats(rec, newStatsRequest(t, "42", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// AnalyticsStats — GET /analytics/energy?vehicle_id=X&days=Y
// ---------------------------------------------------------------------------

func TestEnergyHandler_AnalyticsStats_Success(t *testing.T) {
	fake := &fakeStatsCalculator{stats: sampleStats()}
	h := &EnergyHandler{energySvc: fake}

	rec := httptest.NewRecorder()
	h.AnalyticsStats(rec, newAnalyticsRequest("vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want application/json; charset=utf-8", ct)
	}
	if fake.calls != 1 {
		t.Fatalf("CalculateStats calls = %d, want 1", fake.calls)
	}
	if fake.gotVID != 42 {
		t.Fatalf("CalculateStats vehicleID = %d, want 42", fake.gotVID)
	}
	if fake.gotDays != defaultAnalyticsDays {
		t.Fatalf("CalculateStats days = %d, want %d (default)", fake.gotDays, defaultAnalyticsDays)
	}

	assertEnergyResponse(t, decodeBody(t, rec), fake.stats)
}

func TestEnergyHandler_AnalyticsStats_Validation(t *testing.T) {
	tests := []struct {
		name      string
		rawQuery  string
		wantError string
	}{
		{"missing vehicle_id", "", "vehicle_id is required"},
		{"empty vehicle_id", "vehicle_id=", "vehicle_id is required"},
		{"non-numeric vehicle_id", "vehicle_id=abc", "invalid vehicle_id"},
		{"overflow vehicle_id", "vehicle_id=99999999999999999999999999", "invalid vehicle_id"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeStatsCalculator{stats: sampleStats()}
			h := &EnergyHandler{energySvc: fake}

			rec := httptest.NewRecorder()
			h.AnalyticsStats(rec, newAnalyticsRequest(tt.rawQuery))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
			}
			if fake.calls != 0 {
				t.Fatalf("CalculateStats called %d times on bad request, want 0", fake.calls)
			}
			body := decodeBody(t, rec)
			if body["error"] != tt.wantError {
				t.Fatalf("error = %#v, want %q", body["error"], tt.wantError)
			}
			if body["code"] != "BAD_REQUEST" {
				t.Fatalf("code = %#v, want BAD_REQUEST", body["code"])
			}
		})
	}
}

func TestEnergyHandler_AnalyticsStats_DaysDerivation(t *testing.T) {
	tests := []struct {
		name     string
		rawQuery string
		wantDays int
	}{
		{"default", "vehicle_id=42", defaultAnalyticsDays},
		{"explicit", "vehicle_id=42&days=30", 30},
		{"zero falls back", "vehicle_id=42&days=0", defaultAnalyticsDays},
		{"negative falls back", "vehicle_id=42&days=-1", defaultAnalyticsDays},
		{"non-numeric falls back", "vehicle_id=42&days=abc", defaultAnalyticsDays},
		{"cap boundary", "vehicle_id=42&days=3650", maxDays},
		{"over cap falls back", "vehicle_id=42&days=3651", defaultAnalyticsDays},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fake := &fakeStatsCalculator{stats: sampleStats()}
			h := &EnergyHandler{energySvc: fake}

			rec := httptest.NewRecorder()
			h.AnalyticsStats(rec, newAnalyticsRequest(tt.rawQuery))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if fake.gotDays != tt.wantDays {
				t.Fatalf("days = %d, want %d", fake.gotDays, tt.wantDays)
			}
		})
	}
}

func TestEnergyHandler_AnalyticsStats_ServiceError(t *testing.T) {
	fake := &fakeStatsCalculator{err: errors.New("boom")}
	h := &EnergyHandler{energySvc: fake}

	rec := httptest.NewRecorder()
	h.AnalyticsStats(rec, newAnalyticsRequest("vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["code"] != "INTERNAL_ERROR" {
		t.Fatalf("code = %#v, want INTERNAL_ERROR", body["code"])
	}
}

func TestEnergyHandler_AnalyticsStats_NilStats(t *testing.T) {
	fake := &fakeStatsCalculator{stats: nil, err: nil}
	h := &EnergyHandler{energySvc: fake}

	rec := httptest.NewRecorder()
	h.AnalyticsStats(rec, newAnalyticsRequest("vehicle_id=42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

func TestParseDaysParam(t *testing.T) {
	tests := []struct {
		name  string
		value string
		def   int
		want  int
	}{
		{"empty -> default", "", 30, 30},
		{"valid", "10", 30, 10},
		{"one", "1", 30, 1},
		{"zero -> default", "0", 30, 30},
		{"negative -> default", "-5", 7, 7},
		{"cap boundary kept", "3650", 30, 3650},
		{"over cap -> default", "3651", 30, 30},
		{"way over cap -> default", "99999", 7, 7},
		{"non-numeric -> default", "abc", 30, 30},
		{"leading space -> default", " 5", 30, 30},
		{"float -> default", "5.5", 30, 30},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := parseDaysParam(tt.value, tt.def); got != tt.want {
				t.Fatalf("parseDaysParam(%q, %d) = %d, want %d", tt.value, tt.def, got, tt.want)
			}
		})
	}
}

func TestDaysSince(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name  string
		start time.Time
		want  int
	}{
		{"future collapses to 1", now.Add(48 * time.Hour), 1},
		{"now is 1", now, 1},
		{"exactly 10 days ago", now.Add(-10 * 24 * time.Hour), 11},
		{"one day ago is 2", now.Add(-1 * 24 * time.Hour), 2},
		{"a century ago caps at maxDays", now.AddDate(-100, 0, 0), maxDays},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := daysSince(tt.start); got != tt.want {
				t.Fatalf("daysSince = %d, want %d", got, tt.want)
			}
		})
	}
}

// TestEnergyStatsResponse pins the shape of the projected map directly,
// independent of HTTP wiring — every key present and the three energy
// aliases echoing the single TotalEnergy figure.
func TestEnergyStatsResponse(t *testing.T) {
	s := sampleStats()
	resp := energyStatsResponse(s)

	wantKeys := []string{
		"vehicle_id", "period_days", "total_energy_used_wh",
		"total_energy_charged_wh", "total_wh", "total_cost",
		"total_distance_m", "avg_efficiency_wh_per_m", "co2_saved_kg",
		"daily_breakdown",
	}
	for _, k := range wantKeys {
		if _, ok := resp[k]; !ok {
			t.Fatalf("response missing key %q; got=%v", k, resp)
		}
	}

	if resp["vehicle_id"] != s.VehicleID {
		t.Fatalf("vehicle_id = %#v, want %d", resp["vehicle_id"], s.VehicleID)
	}
	if resp["period_days"] != s.PeriodDays {
		t.Fatalf("period_days = %#v, want %d", resp["period_days"], s.PeriodDays)
	}

	// All three legacy energy keys must echo the single TotalEnergy figure.
	for _, k := range []string{"total_energy_used_wh", "total_energy_charged_wh", "total_wh"} {
		if resp[k] != s.TotalEnergy {
			t.Fatalf("%s = %#v, want %v", k, resp[k], s.TotalEnergy)
		}
	}

	bd, ok := resp["daily_breakdown"].([]*energymodel.EnergyStatsRow)
	if !ok {
		t.Fatalf("daily_breakdown type = %T, want []*energymodel.EnergyStatsRow", resp["daily_breakdown"])
	}
	if len(bd) != len(s.DailyBreakdown) {
		t.Fatalf("daily_breakdown len = %d, want %d", len(bd), len(s.DailyBreakdown))
	}
}

// TestNewEnergyHandler verifies the exported constructor wires a concrete
// *service.EnergyService into the interface-typed seam. A nil pool is safe
// at construction time; the handler only touches it on a request.
func TestNewEnergyHandler(t *testing.T) {
	// A zero-value service pointer is enough to prove NewEnergyHandler wires
	// its dependency; NewEnergyService(nil) would eagerly panic constructing a
	// repo, which is unrelated to what this test asserts.
	svc := &service.EnergyService{}
	h := NewEnergyHandler(svc)
	if h == nil {
		t.Fatal("NewEnergyHandler returned nil")
	}
	if h.energySvc == nil {
		t.Fatal("NewEnergyHandler did not wire the energy service")
	}
}
