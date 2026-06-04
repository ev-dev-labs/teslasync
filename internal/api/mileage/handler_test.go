package mileage

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
)

// HTTP tests for Handler.
//
// These pin key edge cases: vehicle_id validation,
// VehicleExists before repo reads, repo failures, snake_case JSON, YYYY-MM
// buckets, and nil first/last drive timestamps.

type fakeMileageRepo struct {
	exists    map[int64]bool
	existsErr error

	monthly    []drivedb.MileageMonthlyRow
	monthlyErr error

	stats    drivedb.MileageStats
	statsErr error

	daily    []drivedb.MileageDailyRow
	dailyErr error

	gotExistsCalls  []int64
	gotMonthlyCalls []monthlyCall
	gotStatsCalls   []statsCall
	gotDailyCalls   []dailyCall
}

type monthlyCall struct {
	vehicleID   int64
	windowStart time.Time
}

type statsCall struct {
	vehicleID                    int64
	since7d, since30d, since365d time.Time
}

type dailyCall struct {
	vehicleID   int64
	windowStart time.Time
}

func (f *fakeMileageRepo) VehicleExists(ctx context.Context, vehicleID int64) (bool, error) {
	f.gotExistsCalls = append(f.gotExistsCalls, vehicleID)
	if f.existsErr != nil {
		return false, f.existsErr
	}
	v, ok := f.exists[vehicleID]
	if !ok {
		return false, nil
	}
	return v, nil
}

func (f *fakeMileageRepo) Monthly(ctx context.Context, vehicleID int64, windowStart time.Time) ([]drivedb.MileageMonthlyRow, error) {
	f.gotMonthlyCalls = append(f.gotMonthlyCalls, monthlyCall{vehicleID, windowStart})
	if f.monthlyErr != nil {
		return nil, f.monthlyErr
	}
	return f.monthly, nil
}

func (f *fakeMileageRepo) Stats(ctx context.Context, vehicleID int64, since7d, since30d, since365d time.Time) (drivedb.MileageStats, error) {
	f.gotStatsCalls = append(f.gotStatsCalls, statsCall{vehicleID, since7d, since30d, since365d})
	if f.statsErr != nil {
		return drivedb.MileageStats{}, f.statsErr
	}
	return f.stats, nil
}

func (f *fakeMileageRepo) Daily(ctx context.Context, vehicleID int64, windowStart time.Time) ([]drivedb.MileageDailyRow, error) {
	f.gotDailyCalls = append(f.gotDailyCalls, dailyCall{vehicleID, windowStart})
	if f.dailyErr != nil {
		return nil, f.dailyErr
	}
	return f.daily, nil
}

func newHandlerForTest(repo *fakeMileageRepo, fixedNow time.Time) *Handler {
	return &Handler{
		repo:  repo,
		clock: func() time.Time { return fixedNow },
	}
}

func mileageRequest(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

func mileagePtrFloat(v float64) *float64    { return &v }
func mileagePtrTime(t time.Time) *time.Time { return &t }

func TestMileage_Monthly_MonthsClamp(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantMax    bool
		wantErrTxt string
	}{
		{"default_when_absent", "vehicle_id=42", http.StatusOK, false, ""},
		{"months_24", "vehicle_id=42&months=24", http.StatusOK, false, ""},
		{"months_120_max_inclusive", "vehicle_id=42&months=120", http.StatusOK, false, ""},
		{"months_121_exceeds_max", "vehicle_id=42&months=121", http.StatusBadRequest, true, "months exceeds maximum"},
		{"months_zero", "vehicle_id=42&months=0", http.StatusBadRequest, false, "months must be"},
		{"months_negative", "vehicle_id=42&months=-1", http.StatusBadRequest, false, "months must be"},
		{"months_non_integer", "vehicle_id=42&months=abc", http.StatusBadRequest, false, "months must be an integer"},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeMileageRepo{
				exists:  map[int64]bool{42: true},
				monthly: []drivedb.MileageMonthlyRow{},
			}
			h := newHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Monthly(rec, mileageRequest("/mileage/monthly?"+c.query))

			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, c.wantStatus, rec.Body.String())
			}
			if c.wantErrTxt != "" && !strings.Contains(rec.Body.String(), c.wantErrTxt) {
				t.Errorf("body missing %q\nbody=%s", c.wantErrTxt, rec.Body.String())
			}
			if c.wantMax {
				var body map[string]any
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode: %v", err)
				}
				maxV, ok := body["max"].(float64)
				if !ok || int(maxV) != mileageMaxMonths {
					t.Errorf("body.max = %v, want %d (Decision #3 envelope)", body["max"], mileageMaxMonths)
				}
			}
		})
	}
}

func TestMileage_BadVehicleID(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
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
		t.Run("monthly_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeMileageRepo{}
			h := newHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Monthly(rec, mileageRequest("/mileage/monthly?"+c.query))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotExistsCalls) != 0 {
				t.Errorf("VehicleExists called for invalid vehicle_id — must validate first")
			}
		})
		t.Run("stats_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeMileageRepo{}
			h := newHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Stats(rec, mileageRequest("/mileage/stats?"+c.query))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotExistsCalls) != 0 {
				t.Errorf("VehicleExists called for invalid vehicle_id — must validate first")
			}
		})
	}
}

// ---------- 404 vs 200 disambiguation ----------

func TestMileage_Monthly_UnknownVehicle_404(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{exists: map[int64]bool{}} // 99 not present
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Monthly(rec, mileageRequest("/mileage/monthly?vehicle_id=99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotMonthlyCalls) != 0 {
		t.Errorf("Monthly called for unknown vehicle — VehicleExists must gate")
	}
}

func TestMileage_Stats_UnknownVehicle_404(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{exists: map[int64]bool{}}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, mileageRequest("/mileage/stats?vehicle_id=99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotStatsCalls) != 0 {
		t.Errorf("Stats called for unknown vehicle — VehicleExists must gate")
	}
}

// (e) Empty vehicle (zero drives) returns 200 with empty-but-shaped body.
func TestMileage_Monthly_EmptyVehicle_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{
		exists:  map[int64]bool{42: true},
		monthly: []drivedb.MileageMonthlyRow{},
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Monthly(rec, mileageRequest("/mileage/monthly?vehicle_id=42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body MileageMonthlyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.VehicleID != 42 {
		t.Errorf("vehicle_id = %d, want 42", body.VehicleID)
	}
	if body.Months == nil {
		t.Fatal("months must be non-nil empty slice (not nil) — JSON marshalls to [] vs null")
	}
	if len(body.Months) != 0 {
		t.Errorf("len(months) = %d, want 0", len(body.Months))
	}
	// Pin the JSON marshals as `[]` literally so a future drift to
	// omitempty here cannot silently produce `null`, which would
	// confuse the frontend's safeArray() consumer.
	if !strings.Contains(rec.Body.String(), `"months":[]`) {
		t.Errorf("body must contain `\"months\":[]` literally\nbody=%s", rec.Body.String())
	}
}

func TestMileage_Stats_EmptyVehicle_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{
		exists: map[int64]bool{42: true},
		stats:  drivedb.MileageStats{}, // all zero, nil times
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, mileageRequest("/mileage/stats?vehicle_id=42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body MileageStatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.VehicleID != 42 {
		t.Errorf("vehicle_id = %d, want 42", body.VehicleID)
	}
	if body.LifetimeKm != 0 || body.Last7dKm != 0 || body.Last30dKm != 0 || body.Last365dKm != 0 {
		t.Errorf("expected zero rollups, got %+v", body)
	}
	if body.DriveCountLifetime != 0 || body.DriveCount30d != 0 {
		t.Errorf("expected zero counts, got %+v", body)
	}
	if body.FirstDriveAt != nil || body.LastDriveAt != nil {
		t.Errorf("expected nil first/last_drive_at, got %+v / %+v", body.FirstDriveAt, body.LastDriveAt)
	}
	// Pin JSON null for first/last_drive_at — Go's zero time.Time
	// would marshal to "0001-01-01T00:00:00Z", which would crash the
	// frontend's date renderers.
	if !strings.Contains(rec.Body.String(), `"first_drive_at":null`) {
		t.Errorf("body must contain `\"first_drive_at\":null`\nbody=%s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"last_drive_at":null`) {
		t.Errorf("body must contain `\"last_drive_at\":null`\nbody=%s", rec.Body.String())
	}
}

// ---------- (a) Monthly grouping correctness ----------

func TestMileage_Monthly_GroupingPassThrough(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	mar := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	apr := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	may := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)

	repo := &fakeMileageRepo{
		exists: map[int64]bool{42: true},
		monthly: []drivedb.MileageMonthlyRow{
			{Bucket: mar, DriveCount: 5, TotalKm: 120.5, TotalWhConsumed: mileagePtrFloat(20.0), AvgEfficiencyWhPerKm: mileagePtrFloat(166.0)},
			{Bucket: apr, DriveCount: 8, TotalKm: 250.0, TotalWhConsumed: mileagePtrFloat(40.0), AvgEfficiencyWhPerKm: mileagePtrFloat(160.0)},
			{Bucket: may, DriveCount: 3, TotalKm: 90.0, TotalWhConsumed: nil, AvgEfficiencyWhPerKm: nil},
		},
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Monthly(rec, mileageRequest("/mileage/monthly?vehicle_id=42&months=12"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body MileageMonthlyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.VehicleID != 42 {
		t.Fatalf("vehicle_id = %d, want 42", body.VehicleID)
	}
	if len(body.Months) != 3 {
		t.Fatalf("len(months) = %d, want 3", len(body.Months))
	}

	want := []MileageMonthlyBucket{
		{YearMonth: "2026-03", DriveCount: 5, TotalKm: 120.5, TotalWhConsumed: mileagePtrFloat(20.0), AvgEfficiencyWhPerKm: mileagePtrFloat(166.0)},
		{YearMonth: "2026-04", DriveCount: 8, TotalKm: 250.0, TotalWhConsumed: mileagePtrFloat(40.0), AvgEfficiencyWhPerKm: mileagePtrFloat(160.0)},
		{YearMonth: "2026-05", DriveCount: 3, TotalKm: 90.0, TotalWhConsumed: nil, AvgEfficiencyWhPerKm: nil},
	}
	for i, w := range want {
		got := body.Months[i]
		if got.YearMonth != w.YearMonth {
			t.Errorf("[%d].year_month = %q, want %q", i, got.YearMonth, w.YearMonth)
		}
		if got.DriveCount != w.DriveCount {
			t.Errorf("[%d].drive_count = %d, want %d", i, got.DriveCount, w.DriveCount)
		}
		if got.TotalKm != w.TotalKm {
			t.Errorf("[%d].total_km = %f, want %f", i, got.TotalKm, w.TotalKm)
		}
		if (got.TotalWhConsumed == nil) != (w.TotalWhConsumed == nil) {
			t.Errorf("[%d].total_wh_consumed nilness mismatch: got=%v want=%v", i, got.TotalWhConsumed, w.TotalWhConsumed)
		}
		if got.TotalWhConsumed != nil && w.TotalWhConsumed != nil && *got.TotalWhConsumed != *w.TotalWhConsumed {
			t.Errorf("[%d].total_wh_consumed = %f, want %f", i, *got.TotalWhConsumed, *w.TotalWhConsumed)
		}
		if (got.AvgEfficiencyWhPerKm == nil) != (w.AvgEfficiencyWhPerKm == nil) {
			t.Errorf("[%d].avg_efficiency_wh_per_km nilness mismatch: got=%v want=%v", i, got.AvgEfficiencyWhPerKm, w.AvgEfficiencyWhPerKm)
		}
	}

	// Oldest first, ASC.
	for i := 1; i < len(body.Months); i++ {
		if body.Months[i-1].YearMonth >= body.Months[i].YearMonth {
			t.Errorf("not in ASC order: [%d]=%s >= [%d]=%s", i-1, body.Months[i-1].YearMonth, i, body.Months[i].YearMonth)
		}
	}

	// JSON shape pin — snake_case keys frontend depends on.
	bodyStr := rec.Body.String()
	for _, key := range []string{`"vehicle_id"`, `"months"`, `"year_month"`, `"drive_count"`, `"total_km"`, `"total_wh_consumed"`, `"avg_efficiency_wh_per_km"`} {
		if !strings.Contains(bodyStr, key) {
			t.Errorf("response missing snake_case key %s\nbody=%s", key, bodyStr)
		}
	}

	// Window math: months=12 → windowStart should be the first of the
	// month that is 12 months before `now`. now=2026-05-06 → t=2025-05-06
	// → snap to 2025-05-01.
	if len(repo.gotMonthlyCalls) != 1 {
		t.Fatalf("got %d Monthly calls, want 1", len(repo.gotMonthlyCalls))
	}
	wantWindow := time.Date(2025, 5, 1, 0, 0, 0, 0, time.UTC)
	if !repo.gotMonthlyCalls[0].windowStart.Equal(wantWindow) {
		t.Errorf("windowStart = %v, want %v", repo.gotMonthlyCalls[0].windowStart, wantWindow)
	}
}

// TestMileage_Monthly_DefaultWindowIs24Months locks the default 24-month window.
func TestMileage_Monthly_DefaultWindowIs24Months(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{
		exists:  map[int64]bool{42: true},
		monthly: []drivedb.MileageMonthlyRow{},
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Monthly(rec, mileageRequest("/mileage/monthly?vehicle_id=42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(repo.gotMonthlyCalls) != 1 {
		t.Fatalf("got %d calls, want 1", len(repo.gotMonthlyCalls))
	}
	// 24 months back from 2026-05-06 → 2024-05-06 → snap to 2024-05-01
	wantWindow := time.Date(2024, 5, 1, 0, 0, 0, 0, time.UTC)
	if !repo.gotMonthlyCalls[0].windowStart.Equal(wantWindow) {
		t.Errorf("windowStart = %v, want %v (Decision #3 default 24 months)", repo.gotMonthlyCalls[0].windowStart, wantWindow)
	}
}

// ---------- (c) Stats lifetime = sum of monthly ----------

// Using a fake repo, set lifetime to the literal sum
// of the monthly buckets and confirm the handler does not mutate it
// (the repo is the source of truth; the handler is a pass-through).
// This pins the contract that future repo authors must preserve.
func TestMileage_Stats_LifetimeMatchesMonthlySum(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	monthly := []drivedb.MileageMonthlyRow{
		{TotalKm: 120.5},
		{TotalKm: 250.0},
		{TotalKm: 90.0},
	}
	wantLifetime := 120.5 + 250.0 + 90.0 // 460.5

	repo := &fakeMileageRepo{
		exists:  map[int64]bool{42: true},
		monthly: monthly,
		stats: drivedb.MileageStats{
			LifetimeKm: wantLifetime,
		},
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, mileageRequest("/mileage/stats?vehicle_id=42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body MileageStatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.LifetimeKm != wantLifetime {
		t.Errorf("lifetime_km = %f, want %f", body.LifetimeKm, wantLifetime)
	}
}

// ---------- (d) Stats windows pass-through ----------

func TestMileage_Stats_WindowsPassThrough(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	first := time.Date(2024, 1, 15, 9, 0, 0, 0, time.UTC)
	last := time.Date(2026, 5, 5, 18, 0, 0, 0, time.UTC)

	repo := &fakeMileageRepo{
		exists: map[int64]bool{42: true},
		stats: drivedb.MileageStats{
			LifetimeKm:         12345.67,
			Last7dKm:           45.0,
			Last30dKm:          200.0,
			Last365dKm:         5000.0,
			DriveCountLifetime: 800,
			DriveCount30d:      18,
			FirstDriveAt:       mileagePtrTime(first),
			LastDriveAt:        mileagePtrTime(last),
		},
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, mileageRequest("/mileage/stats?vehicle_id=42"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var body MileageStatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.LifetimeKm != 12345.67 || body.Last7dKm != 45.0 || body.Last30dKm != 200.0 || body.Last365dKm != 5000.0 {
		t.Errorf("rollups = %+v, want pass-through", body)
	}
	if body.DriveCountLifetime != 800 || body.DriveCount30d != 18 {
		t.Errorf("counts = %+v", body)
	}
	if body.FirstDriveAt == nil || !body.FirstDriveAt.Equal(first) {
		t.Errorf("first_drive_at = %v, want %v", body.FirstDriveAt, first)
	}
	if body.LastDriveAt == nil || !body.LastDriveAt.Equal(last) {
		t.Errorf("last_drive_at = %v, want %v", body.LastDriveAt, last)
	}

	// Window math: stats endpoint uses now-7d / now-30d / now-365d.
	if len(repo.gotStatsCalls) != 1 {
		t.Fatalf("got %d Stats calls, want 1", len(repo.gotStatsCalls))
	}
	call := repo.gotStatsCalls[0]
	if !call.since7d.Equal(now.Add(-7 * 24 * time.Hour)) {
		t.Errorf("since7d = %v, want now-7d", call.since7d)
	}
	if !call.since30d.Equal(now.Add(-30 * 24 * time.Hour)) {
		t.Errorf("since30d = %v, want now-30d", call.since30d)
	}
	if !call.since365d.Equal(now.Add(-365 * 24 * time.Hour)) {
		t.Errorf("since365d = %v, want now-365d", call.since365d)
	}

	// JSON shape pin — snake_case keys.
	bodyStr := rec.Body.String()
	for _, key := range []string{
		`"vehicle_id"`,
		`"lifetime_km"`,
		`"last_7d_km"`,
		`"last_30d_km"`,
		`"last_365d_km"`,
		`"drive_count_lifetime"`,
		`"drive_count_30d"`,
		`"first_drive_at"`,
		`"last_drive_at"`,
	} {
		if !strings.Contains(bodyStr, key) {
			t.Errorf("response missing snake_case key %s\nbody=%s", key, bodyStr)
		}
	}
}

// ---------- repo error -> 500 ----------

func TestMileage_Monthly_RepoError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{
		exists:     map[int64]bool{42: true},
		monthlyErr: errors.New("boom"),
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Monthly(rec, mileageRequest("/mileage/monthly?vehicle_id=42"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestMileage_Stats_RepoError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{
		exists:   map[int64]bool{42: true},
		statsErr: errors.New("boom"),
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, mileageRequest("/mileage/stats?vehicle_id=42"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
}

// VehicleExists error -> 500 for both endpoints.
func TestMileage_VehicleExistsError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	t.Run("monthly", func(t *testing.T) {
		t.Parallel()
		repo := &fakeMileageRepo{existsErr: errors.New("db down")}
		h := newHandlerForTest(repo, now)
		rec := httptest.NewRecorder()
		h.Monthly(rec, mileageRequest("/mileage/monthly?vehicle_id=42"))
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500", rec.Code)
		}
		if len(repo.gotMonthlyCalls) != 0 {
			t.Errorf("Monthly called despite VehicleExists error")
		}
	})

	t.Run("stats", func(t *testing.T) {
		t.Parallel()
		repo := &fakeMileageRepo{existsErr: errors.New("db down")}
		h := newHandlerForTest(repo, now)
		rec := httptest.NewRecorder()
		h.Stats(rec, mileageRequest("/mileage/stats?vehicle_id=42"))
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500", rec.Code)
		}
		if len(repo.gotStatsCalls) != 0 {
			t.Errorf("Stats called despite VehicleExists error")
		}
	})
}

// ---------- monthsAgo helper ----------

// TestMonthsAgo_SnapsToFirstOfMonth pins the design choice documented
// on monthsAgo: the earliest bucket must include the FULL month, not
// from now.Day() of that month. A future refactor that removes the
// snap would silently clip the earliest bucket.
func TestMonthsAgo_SnapsToFirstOfMonth(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		now    time.Time
		months int
		want   time.Time
	}{
		{"24m_from_may_6", time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC), 24, time.Date(2024, 5, 1, 0, 0, 0, 0, time.UTC)},
		{"12m_from_dec_31", time.Date(2026, 12, 31, 23, 59, 59, 0, time.UTC), 12, time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC)},
		{"1m_from_jan_15", time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC), 1, time.Date(2025, 12, 1, 0, 0, 0, 0, time.UTC)},
		// Edge case: AddDate(-1, 0, 0) on Mar 31 backs up to Mar 31, then
		// snap → Mar 1. Defends against the classic Go gotcha where
		// AddDate(0, -1, 0) on Mar 31 yields Mar 3 (not Feb 28); after
		// snapping we always land on day 1, sidestepping that issue.
		{"12m_from_mar_31_leap_safe", time.Date(2024, 3, 31, 0, 0, 0, 0, time.UTC), 12, time.Date(2023, 3, 1, 0, 0, 0, 0, time.UTC)},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := monthsAgo(c.now, c.months)
			if !got.Equal(c.want) {
				t.Errorf("monthsAgo(%v, %d) = %v, want %v", c.now, c.months, got, c.want)
			}
			if got.Day() != 1 {
				t.Errorf("got.Day() = %d, want 1 (must snap to first of month)", got.Day())
			}
			if got.Hour() != 0 || got.Minute() != 0 || got.Second() != 0 {
				t.Errorf("got HMS = %02d:%02d:%02d, want 00:00:00", got.Hour(), got.Minute(), got.Second())
			}
		})
	}
}

// ============================================================================
// /mileage/daily tests
// ============================================================================
//
// Coverage matches the Monthly + Stats matrix:
//   - days clamp (default 90, max 730, < 1 → 400, non-integer → 400)
//   - vehicle_id missing / non-numeric / zero / negative → 400
//   - VehicleExists runs FIRST (404 on unknown vehicle)
//   - Repo error → 500
//   - Empty vehicle → 200 with days:[]
//   - Grouping pass-through (response field-shape + JSON null on
//     end_odometer_km when EndOdometerKm is nil)
//   - daysAgo helper snap-to-midnight contract

func TestMileage_Daily_DaysClamp(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name        string
		days        string
		wantStatus  int
		wantBodyHas string
	}{
		{name: "default_no_param", days: "", wantStatus: http.StatusOK},
		{name: "explicit_30", days: "30", wantStatus: http.StatusOK},
		{name: "max_730", days: "730", wantStatus: http.StatusOK},
		{name: "over_max_731", days: "731", wantStatus: http.StatusBadRequest, wantBodyHas: "days exceeds maximum"},
		{name: "zero", days: "0", wantStatus: http.StatusBadRequest, wantBodyHas: "days must be"},
		{name: "negative", days: "-5", wantStatus: http.StatusBadRequest, wantBodyHas: "days must be"},
		{name: "non_integer", days: "abc", wantStatus: http.StatusBadRequest, wantBodyHas: "days must be an integer"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeMileageRepo{
				exists: map[int64]bool{42: true},
			}
			h := newHandlerForTest(repo, now)
			target := "/mileage/daily?vehicle_id=42"
			if c.days != "" {
				target += "&days=" + c.days
			}
			rec := httptest.NewRecorder()
			h.Daily(rec, mileageRequest(target))
			if rec.Code != c.wantStatus {
				t.Fatalf("status: got %d, want %d (body=%s)", rec.Code, c.wantStatus, rec.Body.String())
			}
			if c.wantBodyHas != "" && !strings.Contains(rec.Body.String(), c.wantBodyHas) {
				t.Errorf("body %q does not contain %q", rec.Body.String(), c.wantBodyHas)
			}
		})
	}
}

func TestMileage_Daily_BadVehicleID(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name   string
		target string
		want   string
	}{
		{"missing", "/mileage/daily", "vehicle_id is required"},
		{"non_numeric", "/mileage/daily?vehicle_id=abc", "vehicle_id must be a positive integer"},
		{"zero", "/mileage/daily?vehicle_id=0", "vehicle_id must be a positive integer"},
		{"negative", "/mileage/daily?vehicle_id=-1", "vehicle_id must be a positive integer"},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeMileageRepo{}
			h := newHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Daily(rec, mileageRequest(c.target))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status: got %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), c.want) {
				t.Errorf("body %q does not contain %q", rec.Body.String(), c.want)
			}
			if len(repo.gotExistsCalls) != 0 {
				t.Errorf("VehicleExists must not be called on a bad vehicle_id; got %v", repo.gotExistsCalls)
			}
		})
	}
}

func TestMileage_Daily_UnknownVehicle_404(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{exists: map[int64]bool{}}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Daily(rec, mileageRequest("/mileage/daily?vehicle_id=99"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404", rec.Code)
	}
	if len(repo.gotDailyCalls) != 0 {
		t.Errorf("Daily must not run when VehicleExists returns false; got %v", repo.gotDailyCalls)
	}
}

func TestMileage_Daily_EmptyVehicle_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{
		exists: map[int64]bool{7: true},
		daily:  []drivedb.MileageDailyRow{},
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Daily(rec, mileageRequest("/mileage/daily?vehicle_id=7"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var resp MileageDailyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.VehicleID != 7 {
		t.Errorf("vehicle_id: got %d, want 7", resp.VehicleID)
	}
	if resp.Days == nil {
		t.Error("days must be [] not null when empty (frontend depends on non-null array)")
	}
	if len(resp.Days) != 0 {
		t.Errorf("len(days): got %d, want 0", len(resp.Days))
	}
}

func TestMileage_Daily_RepoError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeMileageRepo{
		exists:   map[int64]bool{7: true},
		dailyErr: errors.New("boom"),
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Daily(rec, mileageRequest("/mileage/daily?vehicle_id=7"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: got %d, want 500", rec.Code)
	}
}

func TestMileage_Daily_GroupingPassThrough(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	day1 := time.Date(2026, 5, 4, 0, 0, 0, 0, time.UTC)
	day2 := time.Date(2026, 5, 5, 0, 0, 0, 0, time.UTC)
	day3 := time.Date(2026, 5, 6, 0, 0, 0, 0, time.UTC)

	odo := 51234.567
	repo := &fakeMileageRepo{
		exists: map[int64]bool{42: true},
		daily: []drivedb.MileageDailyRow{
			{Day: day1, DriveCount: 2, TotalKm: 12.5, EndOdometerKm: &odo},
			{Day: day2, DriveCount: 1, TotalKm: 3.0, EndOdometerKm: nil},
			{Day: day3, DriveCount: 4, TotalKm: 85.42, EndOdometerKm: nil},
		},
	}
	h := newHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Daily(rec, mileageRequest("/mileage/daily?vehicle_id=42&days=90"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	// Decode into a generic map so we can assert JSON-null vs zero on
	// end_odometer_km without the Go zero-value confusion of an int field.
	var raw struct {
		VehicleID int64 `json:"vehicle_id"`
		Days      []struct {
			Date          string   `json:"date"`
			DriveCount    int      `json:"drive_count"`
			TotalKm       float64  `json:"total_km"`
			EndOdometerKm *float64 `json:"end_odometer_km"`
		} `json:"days"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if raw.VehicleID != 42 || len(raw.Days) != 3 {
		t.Fatalf("envelope: %+v", raw)
	}
	// Date formatting: YYYY-MM-DD.
	if raw.Days[0].Date != "2026-05-04" || raw.Days[1].Date != "2026-05-05" || raw.Days[2].Date != "2026-05-06" {
		t.Errorf("date format: %+v", raw.Days)
	}
	// Total_km pass-through.
	if raw.Days[0].TotalKm != 12.5 || raw.Days[1].TotalKm != 3.0 || raw.Days[2].TotalKm != 85.42 {
		t.Errorf("total_km: %+v", raw.Days)
	}
	// End_odometer_km: first day non-null, others null.
	if raw.Days[0].EndOdometerKm == nil || *raw.Days[0].EndOdometerKm != 51234.567 {
		t.Errorf("days[0].end_odometer_km: got %v, want 51234.567", raw.Days[0].EndOdometerKm)
	}
	if raw.Days[1].EndOdometerKm != nil {
		t.Errorf("days[1].end_odometer_km: got %v, want JSON null", *raw.Days[1].EndOdometerKm)
	}
	if raw.Days[2].EndOdometerKm != nil {
		t.Errorf("days[2].end_odometer_km: got %v, want JSON null", *raw.Days[2].EndOdometerKm)
	}
	// Raw body must literally contain "end_odometer_km":null so the
	// frontend can distinguish "no odometer reading" from "zero km".
	if !strings.Contains(rec.Body.String(), `"end_odometer_km":null`) {
		t.Errorf("response body must encode JSON null for absent odometer; got %s", rec.Body.String())
	}
	// Window must be snapped to midnight UTC of (now - days).
	if len(repo.gotDailyCalls) != 1 {
		t.Fatalf("Daily call count: got %d, want 1", len(repo.gotDailyCalls))
	}
	wantWindow := time.Date(2026, 2, 5, 0, 0, 0, 0, time.UTC)
	if !repo.gotDailyCalls[0].windowStart.Equal(wantWindow) {
		t.Errorf("windowStart: got %s, want %s", repo.gotDailyCalls[0].windowStart, wantWindow)
	}
}

func TestDaysAgo_SnapsToMidnightUTC(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		now  time.Time
		days int
		want time.Time
	}{
		{
			"mid_day_now_90d",
			time.Date(2026, 5, 6, 14, 23, 45, 678, time.UTC),
			90,
			time.Date(2026, 2, 5, 0, 0, 0, 0, time.UTC),
		},
		{
			"midnight_now_30d",
			time.Date(2026, 5, 6, 0, 0, 0, 0, time.UTC),
			30,
			time.Date(2026, 4, 6, 0, 0, 0, 0, time.UTC),
		},
		{
			"crosses_month_boundary",
			time.Date(2026, 3, 1, 23, 59, 59, 0, time.UTC),
			5,
			time.Date(2026, 2, 24, 0, 0, 0, 0, time.UTC),
		},
		{
			"crosses_year_boundary",
			time.Date(2026, 1, 3, 6, 0, 0, 0, time.UTC),
			10,
			time.Date(2025, 12, 24, 0, 0, 0, 0, time.UTC),
		},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := daysAgo(c.now, c.days)
			if !got.Equal(c.want) {
				t.Errorf("daysAgo(%s, %d) = %s, want %s", c.now, c.days, got, c.want)
			}
			if got.Hour() != 0 || got.Minute() != 0 || got.Second() != 0 || got.Nanosecond() != 0 {
				t.Errorf("got HMS = %02d:%02d:%02d.%09d, want 00:00:00.000000000",
					got.Hour(), got.Minute(), got.Second(), got.Nanosecond())
			}
			if got.Location() != time.UTC {
				t.Errorf("got Location = %s, want UTC", got.Location())
			}
		})
	}
}
