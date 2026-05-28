package vampiredrain

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

// Phase-43a / Prompt 0005 — HTTP tests for VampireDrainHandler.
//
// Coverage map vs Decision #8:
//   (a) Window pairing correctness        -> vampire_drain_repo_test.go
//                                              (TestComputeDrainEvents_WorkedExample)
//   (b) Charging-window exclusion         -> vampire_drain_repo_test.go
//                                              (TestVampireDrainSelectSQL_Shape)
//   (c) limit clamp 50/500/501 -> 400     -> TestVampireDrain_Events_LimitClamp
//   (d) drain_pct_per_day formula         -> vampire_drain_repo_test.go
//                                              (TestComputeDrainEvents_DrainPerDayFormula)
//   (e) Stats consistency                 -> vampire_drain_repo_test.go
//                                              (TestComputeStats_RightSkewedAvgGeMedian)
//
// Plus extras:
//   - vehicle_id missing / non-numeric / zero / negative
//   - VehicleExists runs FIRST (defends against dangling rows after
//     vehicle deletion — no FK on fsm_transitions.vehicle_id per
//     mig 000187, no FK on signal_log.vehicle_id per mig 000186)
//   - Repo error -> 500
//   - JSON shape pin (snake_case keys, envelope shape matches Decision #2)
//   - 90-day window for stats endpoint (Decision #3 sample_window_days)
//   - 365-day window for events endpoint (lookback for pagination)

// ---------- fake repo ----------

type fakeVampireDrainRepo struct {
	exists    map[int64]bool
	existsErr error

	events    []drivedb.VampireDrainEvent
	eventsErr error

	stats    drivedb.VampireDrainStats
	statsErr error

	gotExistsCalls []int64
	gotEventsCalls []vdEventsCall
	gotStatsCalls  []vdStatsCall
}

type vdEventsCall struct {
	vehicleID   int64
	windowStart time.Time
	limit       int
}

type vdStatsCall struct {
	vehicleID        int64
	windowStart      time.Time
	sampleWindowDays int
	limit            int
}

func (f *fakeVampireDrainRepo) VehicleExists(ctx context.Context, vehicleID int64) (bool, error) {
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

func (f *fakeVampireDrainRepo) Events(ctx context.Context, vehicleID int64, windowStart time.Time, limit int) ([]drivedb.VampireDrainEvent, error) {
	f.gotEventsCalls = append(f.gotEventsCalls, vdEventsCall{vehicleID, windowStart, limit})
	if f.eventsErr != nil {
		return nil, f.eventsErr
	}
	return f.events, nil
}

func (f *fakeVampireDrainRepo) Stats(ctx context.Context, vehicleID int64, windowStart time.Time, sampleWindowDays, limit int) (drivedb.VampireDrainStats, error) {
	f.gotStatsCalls = append(f.gotStatsCalls, vdStatsCall{vehicleID, windowStart, sampleWindowDays, limit})
	if f.statsErr != nil {
		return drivedb.VampireDrainStats{}, f.statsErr
	}
	return f.stats, nil
}

func newVampireDrainHandlerForTest(repo *fakeVampireDrainRepo, fixedNow time.Time) *VampireDrainHandler {
	return &VampireDrainHandler{
		repo:  repo,
		clock: func() time.Time { return fixedNow },
	}
}

func vdRequest(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

func vdPtrFloat(v float64) *float64 { return &v }

// ---------- (c) limit clamp ----------

func TestVampireDrain_Events_LimitClamp(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantLimit  int
		wantErrTxt string
		wantMax    bool
	}{
		{"default_when_absent", "vehicle_id=42", http.StatusOK, vampireDrainDefaultLimit, "", false},
		{"limit_50_default", "vehicle_id=42&limit=50", http.StatusOK, 50, "", false},
		{"limit_100", "vehicle_id=42&limit=100", http.StatusOK, 100, "", false},
		{"limit_500_max_inclusive", "vehicle_id=42&limit=500", http.StatusOK, 500, "", false},
		{"limit_501_exceeds_max", "vehicle_id=42&limit=501", http.StatusBadRequest, 0, "limit exceeds maximum", true},
		{"limit_zero", "vehicle_id=42&limit=0", http.StatusBadRequest, 0, "limit must be", false},
		{"limit_negative", "vehicle_id=42&limit=-5", http.StatusBadRequest, 0, "limit must be", false},
		{"limit_non_integer", "vehicle_id=42&limit=abc", http.StatusBadRequest, 0, "limit must be an integer", false},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeVampireDrainRepo{
				exists: map[int64]bool{42: true},
				events: []drivedb.VampireDrainEvent{},
			}
			h := newVampireDrainHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Events(rec, vdRequest("/vampire-drain?"+c.query))

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
				if !ok || int(maxV) != vampireDrainMaxLimit {
					t.Errorf("body.max = %v, want %d (Decision #2 envelope)", body["max"], vampireDrainMaxLimit)
				}
			}
			if c.wantStatus == http.StatusOK {
				if len(repo.gotEventsCalls) != 1 {
					t.Fatalf("got %d Events calls, want 1", len(repo.gotEventsCalls))
				}
				if repo.gotEventsCalls[0].limit != c.wantLimit {
					t.Errorf("repo limit = %d, want %d", repo.gotEventsCalls[0].limit, c.wantLimit)
				}
			}
		})
	}
}

// ---------- vehicle_id validation (both endpoints) ----------

func TestVampireDrain_BadVehicleID(t *testing.T) {
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
		t.Run("events_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeVampireDrainRepo{}
			h := newVampireDrainHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Events(rec, vdRequest("/vampire-drain?"+c.query))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotExistsCalls) != 0 {
				t.Errorf("VehicleExists called for invalid vehicle_id — must validate first")
			}
		})
		t.Run("stats_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeVampireDrainRepo{}
			h := newVampireDrainHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Stats(rec, vdRequest("/vampire-drain/stats?"+c.query))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotExistsCalls) != 0 {
				t.Errorf("VehicleExists called for invalid vehicle_id — must validate first")
			}
		})
	}
}

// ---------- 404 for unknown vehicle ----------

func TestVampireDrain_Events_UnknownVehicle_404(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{exists: map[int64]bool{}} // 42 NOT present
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Events(rec, vdRequest("/vampire-drain?vehicle_id=42"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotEventsCalls) != 0 {
		t.Errorf("Events called for unknown vehicle — must short-circuit on 404")
	}
}

func TestVampireDrain_Stats_UnknownVehicle_404(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{exists: map[int64]bool{}}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, vdRequest("/vampire-drain/stats?vehicle_id=42"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotStatsCalls) != 0 {
		t.Errorf("Stats called for unknown vehicle — must short-circuit on 404")
	}
}

// ---------- 200 + empty for existing vehicle with no events ----------

func TestVampireDrain_Events_EmptyVehicle_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{
		exists: map[int64]bool{42: true},
		events: []drivedb.VampireDrainEvent{}, // empty
	}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Events(rec, vdRequest("/vampire-drain?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body VampireDrainEventsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.VehicleID != 42 {
		t.Errorf("body.vehicle_id = %d, want 42", body.VehicleID)
	}
	if body.Events == nil {
		t.Error("body.events is nil; must be non-nil empty array (JSON [] vs null)")
	}
	if len(body.Events) != 0 {
		t.Errorf("body.events len = %d, want 0", len(body.Events))
	}
	// JSON shape: explicit "events" key in raw body.
	if !strings.Contains(rec.Body.String(), `"events"`) {
		t.Errorf("body missing 'events' key (envelope-shape regression)\nbody=%s", rec.Body.String())
	}
}

func TestVampireDrain_Stats_EmptyVehicle_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{
		exists: map[int64]bool{42: true},
		stats: drivedb.VampireDrainStats{
			EventCount:           0,
			TotalObservedHours:   0,
			AvgDrainPctPerDay:    nil,
			MedianDrainPctPerDay: nil,
			P95DrainPctPerDay:    nil,
			SampleWindowDays:     vampireDrainStatsWindowDays,
		},
	}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, vdRequest("/vampire-drain/stats?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body VampireDrainStatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.VehicleID != 42 {
		t.Errorf("body.vehicle_id = %d, want 42", body.VehicleID)
	}
	if body.EventCount != 0 {
		t.Errorf("body.event_count = %d, want 0", body.EventCount)
	}
	if body.SampleWindowDays != vampireDrainStatsWindowDays {
		t.Errorf("body.sample_window_days = %d, want %d", body.SampleWindowDays, vampireDrainStatsWindowDays)
	}
	if body.AvgDrainPctPerDay != nil {
		t.Errorf("avg_drain_pct_per_day = %v, want nil JSON null", body.AvgDrainPctPerDay)
	}
}

// ---------- 200 + populated payload ----------

func TestVampireDrain_Events_HappyPath_PayloadShape(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	w1Start := now.Add(-30 * 24 * time.Hour)
	w1End := w1Start.Add(8 * time.Hour)
	repo := &fakeVampireDrainRepo{
		exists: map[int64]bool{42: true},
		events: []drivedb.VampireDrainEvent{
			{
				StartedAt:       w1Start,
				EndedAt:         w1End,
				DurationHours:   8.0,
				StartBatteryPct: 80,
				EndBatteryPct:   78,
				DrainPct:        2,
				DrainPctPerDay:  6.0,
				AmbientTempCAvg: nil,
			},
		},
	}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Events(rec, vdRequest("/vampire-drain?vehicle_id=42&limit=10"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	// JSON shape: snake_case keys per Decision #2.
	wantKeys := []string{"vehicle_id", "events"}
	for _, k := range wantKeys {
		if _, ok := body[k]; !ok {
			t.Errorf("body missing key %q\nbody=%s", k, rec.Body.String())
		}
	}
	events, ok := body["events"].([]any)
	if !ok || len(events) != 1 {
		t.Fatalf("events = %v, want 1-element array", body["events"])
	}
	ev, _ := events[0].(map[string]any)
	wantEventKeys := []string{
		"started_at", "ended_at", "duration_hours",
		"start_battery_pct", "end_battery_pct",
		"drain_pct", "drain_pct_per_day", "ambient_temp_c_avg",
	}
	for _, k := range wantEventKeys {
		if _, ok := ev[k]; !ok {
			t.Errorf("event missing key %q\nevent=%v", k, ev)
		}
	}
}

func TestVampireDrain_Stats_HappyPath_PayloadShape(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{
		exists: map[int64]bool{42: true},
		stats: drivedb.VampireDrainStats{
			EventCount:           5,
			TotalObservedHours:   72.5,
			AvgDrainPctPerDay:    vdPtrFloat(4.2),
			MedianDrainPctPerDay: vdPtrFloat(3.8),
			P95DrainPctPerDay:    vdPtrFloat(8.1),
			SampleWindowDays:     vampireDrainStatsWindowDays,
		},
	}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, vdRequest("/vampire-drain/stats?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	// JSON shape: snake_case keys per Decision #3.
	wantKeys := []string{
		"vehicle_id", "event_count", "total_observed_hours",
		"avg_drain_pct_per_day", "median_drain_pct_per_day",
		"p95_drain_pct_per_day", "sample_window_days",
	}
	for _, k := range wantKeys {
		if _, ok := body[k]; !ok {
			t.Errorf("body missing key %q\nbody=%s", k, rec.Body.String())
		}
	}
}

// ---------- repo error -> 500 ----------

func TestVampireDrain_Events_RepoError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	sentinel := errors.New("boom")
	repo := &fakeVampireDrainRepo{
		exists:    map[int64]bool{42: true},
		eventsErr: sentinel,
	}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Events(rec, vdRequest("/vampire-drain?vehicle_id=42"))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestVampireDrain_Stats_RepoError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{
		exists:   map[int64]bool{42: true},
		statsErr: errors.New("boom"),
	}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, vdRequest("/vampire-drain/stats?vehicle_id=42"))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestVampireDrain_Events_ExistsProbeError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{existsErr: errors.New("db down")}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Events(rec, vdRequest("/vampire-drain?vehicle_id=42"))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotEventsCalls) != 0 {
		t.Error("Events called after existence probe failed — must short-circuit")
	}
}

// ---------- window math: events 365d, stats 90d ----------

func TestVampireDrain_Events_WindowIs365Days(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{
		exists: map[int64]bool{42: true},
		events: []drivedb.VampireDrainEvent{},
	}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Events(rec, vdRequest("/vampire-drain?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if len(repo.gotEventsCalls) != 1 {
		t.Fatalf("got %d Events calls, want 1", len(repo.gotEventsCalls))
	}
	wantStart := now.Add(-time.Duration(vampireDrainEventsWindowDays) * 24 * time.Hour)
	if !repo.gotEventsCalls[0].windowStart.Equal(wantStart) {
		t.Errorf("repo.windowStart = %v, want %v (365 days back)",
			repo.gotEventsCalls[0].windowStart, wantStart)
	}
}

func TestVampireDrain_Stats_WindowIs90Days(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVampireDrainRepo{
		exists: map[int64]bool{42: true},
	}
	h := newVampireDrainHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Stats(rec, vdRequest("/vampire-drain/stats?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotStatsCalls) != 1 {
		t.Fatalf("got %d Stats calls, want 1", len(repo.gotStatsCalls))
	}
	call := repo.gotStatsCalls[0]
	wantStart := now.Add(-time.Duration(vampireDrainStatsWindowDays) * 24 * time.Hour)
	if !call.windowStart.Equal(wantStart) {
		t.Errorf("repo.windowStart = %v, want %v (90 days back)", call.windowStart, wantStart)
	}
	if call.sampleWindowDays != vampireDrainStatsWindowDays {
		t.Errorf("repo.sampleWindowDays = %d, want %d", call.sampleWindowDays, vampireDrainStatsWindowDays)
	}
	if call.limit != vampireDrainStatsLimit {
		t.Errorf("repo.limit = %d, want %d", call.limit, vampireDrainStatsLimit)
	}
}
