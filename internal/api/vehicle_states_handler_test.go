package api

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
)

// Phase-43a / Prompt 0003 — HTTP tests for VehicleStatesHandler.
//
// Coverage map vs Decision #8:
//   (a) Timeline ordering ASC          -> TestVehicleStates_Timeline_OrderingASC
//   (b) Days clamp 7/30/90/91 -> 400   -> TestVehicleStates_Timeline_DaysClamp
//   (c) Summary % sum 100 ± 0.01       -> TestVehicleStates_Summary_PercentageSumsTo100
//   (d) Empty vehicle -> 200           -> TestVehicleStates_Timeline_EmptyVehicle_200
//                                          / TestVehicleStates_Summary_EmptyVehicle_200
//   (e) Unknown vehicle -> 404         -> TestVehicleStates_Timeline_UnknownVehicle_404
//                                          / TestVehicleStates_Summary_UnknownVehicle_404
//
// Plus extras:
//   - vehicle_id missing / non-numeric / zero / negative
//   - mixed fsm_name filter is repo-side (covered by SQL-shape test in
//     vehicle_states_repo_test.go); handler trusts the repo contract
//   - VehicleExists runs even on a request that would have returned data,
//     not only on empty (defends against dangling fsm_transitions rows
//     after vehicle deletion — mig 000187 has no FK)
//   - Repo error -> 500
//   - Clock injection produces stable window boundaries

// fakeVehicleStatesRepo lets handler tests pin every repo response
// without touching a database.
type fakeVehicleStatesRepo struct {
	exists    map[int64]bool
	existsErr error

	timeline    []database.VehicleStateTransition
	timelineErr error

	summaryRows  []database.VehicleStateSummaryRow
	summaryTotal float64
	summaryErr   error

	// Captures for assertions.
	gotTimelineCalls []timelineCall
	gotSummaryCalls  []summaryCall
	gotExistsCalls   []int64
}

type timelineCall struct {
	vehicleID int64
	start     time.Time
	end       time.Time
}

type summaryCall = timelineCall

func (f *fakeVehicleStatesRepo) VehicleExists(ctx context.Context, vehicleID int64) (bool, error) {
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

func (f *fakeVehicleStatesRepo) Timeline(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]database.VehicleStateTransition, error) {
	f.gotTimelineCalls = append(f.gotTimelineCalls, timelineCall{vehicleID, windowStart, windowEnd})
	if f.timelineErr != nil {
		return nil, f.timelineErr
	}
	return f.timeline, nil
}

func (f *fakeVehicleStatesRepo) Summary(ctx context.Context, vehicleID int64, windowStart, windowEnd time.Time) ([]database.VehicleStateSummaryRow, float64, error) {
	f.gotSummaryCalls = append(f.gotSummaryCalls, summaryCall{vehicleID, windowStart, windowEnd})
	if f.summaryErr != nil {
		return nil, 0, f.summaryErr
	}
	return f.summaryRows, f.summaryTotal, nil
}

func newVehicleStatesHandlerForTest(repo *fakeVehicleStatesRepo, fixedNow time.Time) *VehicleStatesHandler {
	return &VehicleStatesHandler{
		repo:  repo,
		clock: func() time.Time { return fixedNow },
	}
}

func vsRequest(target string) *http.Request {
	return httptest.NewRequest(http.MethodGet, target, nil)
}

func vsPtrStr(s string) *string { return &s }

// ---------- (b) Days clamp ----------

func TestVehicleStates_Timeline_DaysClamp(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		query      string
		wantStatus int
		wantDays   int
		wantErrTxt string // substring match in body
		wantMax    bool   // requires Decision #4 max:90 payload
	}{
		{"default_when_absent", "vehicle_id=42", http.StatusOK, 7, "", false},
		{"days_7", "vehicle_id=42&days=7", http.StatusOK, 7, "", false},
		{"days_30", "vehicle_id=42&days=30", http.StatusOK, 30, "", false},
		{"days_90_max_inclusive", "vehicle_id=42&days=90", http.StatusOK, 90, "", false},
		{"days_91_exceeds_max", "vehicle_id=42&days=91", http.StatusBadRequest, 0, "days exceeds maximum", true},
		{"days_zero", "vehicle_id=42&days=0", http.StatusBadRequest, 0, "days must be", false},
		{"days_negative", "vehicle_id=42&days=-1", http.StatusBadRequest, 0, "days must be", false},
		{"days_non_integer", "vehicle_id=42&days=abc", http.StatusBadRequest, 0, "days must be an integer", false},
	}

	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeVehicleStatesRepo{
				exists:   map[int64]bool{42: true},
				timeline: []database.VehicleStateTransition{},
			}
			h := newVehicleStatesHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Timeline(rec, vsRequest("/vehicle-states/timeline?"+c.query))

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
				if !ok || int(maxV) != 90 {
					t.Errorf("body.max = %v, want 90 (Decision #4 envelope)", body["max"])
				}
			}
			if c.wantStatus == http.StatusOK {
				var body VehicleStatesTimelineResponse
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
				}
				if body.Days != c.wantDays {
					t.Errorf("body.days = %d, want %d", body.Days, c.wantDays)
				}
				// Window math: start = end - days*24h
				if len(repo.gotTimelineCalls) != 1 {
					t.Fatalf("got %d timeline calls, want 1", len(repo.gotTimelineCalls))
				}
				call := repo.gotTimelineCalls[0]
				wantStart := now.Add(-time.Duration(c.wantDays) * 24 * time.Hour)
				if !call.start.Equal(wantStart) {
					t.Errorf("repo.start = %v, want %v", call.start, wantStart)
				}
				if !call.end.Equal(now) {
					t.Errorf("repo.end = %v, want %v", call.end, now)
				}
			}
		})
	}
}

// Same clamp behavior must apply to /summary — re-run the boundary
// cases via a focused sub-test rather than duplicating the full table.
func TestVehicleStates_Summary_DaysClamp(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name       string
		query      string
		wantStatus int
	}{
		{"default", "vehicle_id=42", http.StatusOK},
		{"max_inclusive", "vehicle_id=42&days=90", http.StatusOK},
		{"exceeds_max", "vehicle_id=42&days=91", http.StatusBadRequest},
		{"zero", "vehicle_id=42&days=0", http.StatusBadRequest},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeVehicleStatesRepo{
				exists:      map[int64]bool{42: true},
				summaryRows: []database.VehicleStateSummaryRow{},
			}
			h := newVehicleStatesHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Summary(rec, vsRequest("/vehicle-states/summary?"+c.query))
			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body=%s)", rec.Code, c.wantStatus, rec.Body.String())
			}
		})
	}
}

// ---------- vehicle_id validation ----------

func TestVehicleStates_BadVehicleID(t *testing.T) {
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
		t.Run("timeline_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeVehicleStatesRepo{}
			h := newVehicleStatesHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Timeline(rec, vsRequest("/vehicle-states/timeline?"+c.query))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
			if len(repo.gotExistsCalls) != 0 {
				t.Errorf("VehicleExists called for invalid vehicle_id — must validate first")
			}
		})
		t.Run("summary_"+c.name, func(t *testing.T) {
			t.Parallel()
			repo := &fakeVehicleStatesRepo{}
			h := newVehicleStatesHandlerForTest(repo, now)
			rec := httptest.NewRecorder()
			h.Summary(rec, vsRequest("/vehicle-states/summary?"+c.query))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 (body=%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

// ---------- (a) Timeline ordering + JSON shape ----------

func TestVehicleStates_Timeline_OrderingASC(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	t1 := time.Date(2026, 5, 6, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 5, 6, 10, 30, 0, 0, time.UTC)
	t3 := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)
	repo := &fakeVehicleStatesRepo{
		exists: map[int64]bool{42: true},
		timeline: []database.VehicleStateTransition{
			{Ts: t1, FromState: vsPtrStr("Online"), ToState: "Driving", TriggerField: vsPtrStr("Gear"), TriggerValue: vsPtrStr("D")},
			{Ts: t2, FromState: vsPtrStr("Driving"), ToState: "Parked", TriggerField: vsPtrStr("Gear"), TriggerValue: vsPtrStr("P")},
			{Ts: t3, FromState: vsPtrStr("Parked"), ToState: "Charging", TriggerField: vsPtrStr("ChargingActive"), TriggerValue: vsPtrStr("true")},
		},
	}
	h := newVehicleStatesHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Timeline(rec, vsRequest("/vehicle-states/timeline?vehicle_id=42&days=7"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}

	var body VehicleStatesTimelineResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v\nbody=%s", err, rec.Body.String())
	}
	if body.VehicleID != 42 || body.Days != 7 {
		t.Fatalf("envelope = %+v", body)
	}
	if len(body.Transitions) != 3 {
		t.Fatalf("len(transitions) = %d, want 3", len(body.Transitions))
	}
	for i := 1; i < len(body.Transitions); i++ {
		if body.Transitions[i-1].Ts.After(body.Transitions[i].Ts) {
			t.Errorf("transitions not in ASC order: [%d]=%v after [%d]=%v",
				i-1, body.Transitions[i-1].Ts, i, body.Transitions[i].Ts)
		}
	}

	// JSON wire shape check — confirms snake_case tags survive marshalling.
	var raw map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	for _, k := range []string{"vehicle_id", "days", "transitions"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("missing top-level key %q in body=%s", k, rec.Body.String())
		}
	}
	first := raw["transitions"].([]any)[0].(map[string]any)
	for _, k := range []string{"ts", "from_state", "to_state", "trigger_field", "trigger_value"} {
		if _, ok := first[k]; !ok {
			t.Errorf("missing transition key %q in body=%s", k, rec.Body.String())
		}
	}
}

// ---------- (c) Summary percentages sum to 100 ± 0.01 ----------

func TestVehicleStates_Summary_PercentageSumsTo100(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	repo := &fakeVehicleStatesRepo{
		exists: map[int64]bool{42: true},
		summaryRows: []database.VehicleStateSummaryRow{
			{State: "Asleep", TotalSeconds: 50000, Percentage: 50.0, TransitionCount: 2},
			{State: "Online", TotalSeconds: 30000, Percentage: 30.0, TransitionCount: 5},
			{State: "Driving", TotalSeconds: 15000, Percentage: 15.0, TransitionCount: 1},
			{State: "Charging", TotalSeconds: 5000, Percentage: 5.0, TransitionCount: 1},
		},
		summaryTotal: 100000,
	}
	h := newVehicleStatesHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Summary(rec, vsRequest("/vehicle-states/summary?vehicle_id=42&days=30"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body VehicleStatesSummaryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.VehicleID != 42 || body.Days != 30 {
		t.Fatalf("envelope = %+v", body)
	}
	if body.TotalSeconds != 100000 {
		t.Errorf("total_seconds = %f, want 100000", body.TotalSeconds)
	}
	if len(body.ByState) != 4 {
		t.Fatalf("len(by_state) = %d, want 4", len(body.ByState))
	}

	pctSum := 0.0
	for _, r := range body.ByState {
		pctSum += r.Percentage
		if r.Percentage < 0 {
			t.Errorf("state %q percentage = %f, must be non-negative", r.State, r.Percentage)
		}
	}
	const tol = 0.01
	if pctSum < 100-tol || pctSum > 100+tol {
		t.Fatalf("percentage sum = %f, want 100 ± %f", pctSum, tol)
	}

	// Snake-case keys
	var raw map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &raw)
	for _, k := range []string{"vehicle_id", "days", "total_seconds", "by_state"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("missing top-level key %q in body=%s", k, rec.Body.String())
		}
	}
	first := raw["by_state"].([]any)[0].(map[string]any)
	for _, k := range []string{"state", "total_seconds", "percentage", "transition_count"} {
		if _, ok := first[k]; !ok {
			t.Errorf("missing by_state key %q in body=%s", k, rec.Body.String())
		}
	}
}

// ---------- (d) Empty vehicle returns 200 ----------

func TestVehicleStates_Timeline_EmptyVehicle_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVehicleStatesRepo{
		exists:   map[int64]bool{42: true},
		timeline: nil, // simulates "no transitions yet"
	}
	h := newVehicleStatesHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Timeline(rec, vsRequest("/vehicle-states/timeline?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body VehicleStatesTimelineResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Transitions == nil {
		t.Fatal("transitions = nil, want empty []  (JSON would marshal nil as null, breaking frontend safeArray)")
	}
	if len(body.Transitions) != 0 {
		t.Errorf("transitions = %+v, want empty", body.Transitions)
	}
	// Confirm the JSON byte stream is `[]` not `null`.
	if !strings.Contains(rec.Body.String(), `"transitions":[]`) {
		t.Errorf("body must contain `\"transitions\":[]`, got: %s", rec.Body.String())
	}
}

func TestVehicleStates_Summary_EmptyVehicle_200(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVehicleStatesRepo{
		exists:       map[int64]bool{42: true},
		summaryRows:  nil,
		summaryTotal: 0,
	}
	h := newVehicleStatesHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Summary(rec, vsRequest("/vehicle-states/summary?vehicle_id=42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	var body VehicleStatesSummaryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.ByState == nil {
		t.Fatal("by_state = nil, want empty []")
	}
	if !strings.Contains(rec.Body.String(), `"by_state":[]`) {
		t.Errorf("body must contain `\"by_state\":[]`, got: %s", rec.Body.String())
	}
	if body.TotalSeconds != 0 {
		t.Errorf("total_seconds = %f, want 0", body.TotalSeconds)
	}
}

// ---------- (e) Unknown vehicle returns 404 ----------

func TestVehicleStates_Timeline_UnknownVehicle_404(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVehicleStatesRepo{exists: map[int64]bool{}}
	h := newVehicleStatesHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Timeline(rec, vsRequest("/vehicle-states/timeline?vehicle_id=999"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotTimelineCalls) != 0 {
		t.Errorf("Timeline called for unknown vehicle — must short-circuit on existence check")
	}
}

func TestVehicleStates_Summary_UnknownVehicle_404(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	repo := &fakeVehicleStatesRepo{exists: map[int64]bool{}}
	h := newVehicleStatesHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Summary(rec, vsRequest("/vehicle-states/summary?vehicle_id=999"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotSummaryCalls) != 0 {
		t.Errorf("Summary called for unknown vehicle — must short-circuit on existence check")
	}
}

// ---------- VehicleExists runs even when data would be returned ----------

// Defends the rubber-duck finding: mig 000187 has no FK on
// fsm_transitions.vehicle_id, so dangling rows could resurrect a deleted
// vehicle if VehicleExists were only consulted on empty results.
func TestVehicleStates_VehicleExists_AlwaysRuns(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	t1 := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)

	repo := &fakeVehicleStatesRepo{
		exists: map[int64]bool{}, // unknown vehicle
		// But the repo has dangling transition rows we must NEVER reach.
		timeline: []database.VehicleStateTransition{
			{Ts: t1, FromState: vsPtrStr("Online"), ToState: "Driving", TriggerField: vsPtrStr("Gear"), TriggerValue: vsPtrStr("D")},
		},
	}
	h := newVehicleStatesHandlerForTest(repo, now)
	rec := httptest.NewRecorder()
	h.Timeline(rec, vsRequest("/vehicle-states/timeline?vehicle_id=999"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rec.Code, rec.Body.String())
	}
	if len(repo.gotTimelineCalls) != 0 {
		t.Errorf("Timeline called despite VehicleExists=false — defends dangling-row safety")
	}
}

// ---------- Repo errors propagate as 500 ----------

func TestVehicleStates_RepoError_500(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	t.Run("timeline_existence_err", func(t *testing.T) {
		t.Parallel()
		repo := &fakeVehicleStatesRepo{existsErr: errors.New("db down")}
		h := newVehicleStatesHandlerForTest(repo, now)
		rec := httptest.NewRecorder()
		h.Timeline(rec, vsRequest("/vehicle-states/timeline?vehicle_id=42"))
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500", rec.Code)
		}
	})
	t.Run("timeline_query_err", func(t *testing.T) {
		t.Parallel()
		repo := &fakeVehicleStatesRepo{
			exists:      map[int64]bool{42: true},
			timelineErr: errors.New("query failed"),
		}
		h := newVehicleStatesHandlerForTest(repo, now)
		rec := httptest.NewRecorder()
		h.Timeline(rec, vsRequest("/vehicle-states/timeline?vehicle_id=42"))
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500", rec.Code)
		}
	})
	t.Run("summary_query_err", func(t *testing.T) {
		t.Parallel()
		repo := &fakeVehicleStatesRepo{
			exists:     map[int64]bool{42: true},
			summaryErr: errors.New("query failed"),
		}
		h := newVehicleStatesHandlerForTest(repo, now)
		rec := httptest.NewRecorder()
		h.Summary(rec, vsRequest("/vehicle-states/summary?vehicle_id=42"))
		if rec.Code != http.StatusInternalServerError {
			t.Errorf("status = %d, want 500", rec.Code)
		}
	})
}

// ---------- Production constructor sanity ----------

// NewVehicleStatesHandler with a real (nil-pool-rejecting) repo isn't
// exercised here because constructing a real *VehicleStatesRepo would
// require a live pool; the repo's nil-pool panic is covered in
// TestNewVehicleStatesRepo_NilPoolPanics (vehicle_states_repo_test.go).
// This test just confirms the production constructor accepts a typed
// *database.VehicleStatesRepo without compile errors.
var _ = NewVehicleStatesHandler // ensure exported constructor symbol

func TestVehicleStatesHandler_ImplementsContract(t *testing.T) {
	t.Parallel()
	// Pure compile-time interface-conformance check for the fake.
	var _ vehicleStatesRepository = (*fakeVehicleStatesRepo)(nil)
}
