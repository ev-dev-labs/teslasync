package fsd

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// fakeRepo is the in-memory insightsRepository used by handler tests so
// Insights can be exercised end-to-end without a live pgx pool.
//
// It records the CONTEXT of every call as well as the arguments, which is what
// lets the deadline tests prove both reads share one budget.
type fakeRepo struct {
	window      []Sample
	windowErr   error
	baseline    []Sample
	baselineErr error

	gotWindowFrom  time.Time
	gotWindowTo    time.Time
	gotBaselineCut time.Time
	gotFields      []string
	gotVehicleIDs  []int64

	gotWindowCtx   context.Context
	gotBaselineCtx context.Context
	// onBaseline runs inside BaselineSamples, so a test can simulate time
	// passing (or the caller disconnecting) between the two reads.
	onBaseline func()
}

func (f *fakeRepo) WindowSamples(ctx context.Context, vehicleID int64, fields []string, from, to time.Time) ([]Sample, error) {
	f.gotVehicleIDs = append(f.gotVehicleIDs, vehicleID)
	f.gotFields = fields
	f.gotWindowFrom = from
	f.gotWindowTo = to
	f.gotWindowCtx = ctx
	if f.windowErr != nil {
		return nil, f.windowErr
	}
	return f.window, nil
}

func (f *fakeRepo) BaselineSamples(ctx context.Context, vehicleID int64, fields []string, before time.Time) ([]Sample, error) {
	f.gotVehicleIDs = append(f.gotVehicleIDs, vehicleID)
	f.gotFields = fields
	f.gotBaselineCut = before
	f.gotBaselineCtx = ctx
	if f.onBaseline != nil {
		f.onBaseline()
	}
	if f.baselineErr != nil {
		return nil, f.baselineErr
	}
	return f.baseline, nil
}

var _ insightsRepository = (*fakeRepo)(nil)

func fixedClock(t *testing.T, iso string) clock {
	t.Helper()
	now := at(t, iso)
	return func() time.Time { return now }
}

func doGet(t *testing.T, h *Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.Insights(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) Response {
	t.Helper()
	var resp Response
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, rec.Body.String())
	}
	return resp
}

type errorPayload struct {
	Error string `json:"error"`
	Code  string `json:"code"`
	Max   int    `json:"max"`
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) errorPayload {
	t.Helper()
	var payload errorPayload
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error payload: %v (body=%s)", err, rec.Body.String())
	}
	return payload
}

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

func TestInsights_ValidationRejectsBadInput(t *testing.T) {
	cases := []struct {
		name   string
		target string
		want   string
	}{
		{"missing vehicle_id", "/analytics/fsd", "vehicle_id is required"},
		{"blank vehicle_id", "/analytics/fsd?vehicle_id=", "vehicle_id is required"},
		{"non-numeric vehicle_id", "/analytics/fsd?vehicle_id=abc", "vehicle_id must be a positive integer"},
		{"zero vehicle_id", "/analytics/fsd?vehicle_id=0", "vehicle_id must be a positive integer"},
		{"negative vehicle_id", "/analytics/fsd?vehicle_id=-3", "vehicle_id must be a positive integer"},
		{"non-numeric days", "/analytics/fsd?vehicle_id=1&days=week", "days must be an integer"},
		{"zero days", "/analytics/fsd?vehicle_id=1&days=0", "days must be >= 1"},
		{"negative days", "/analytics/fsd?vehicle_id=1&days=-7", "days must be >= 1"},
		{"days over cap", "/analytics/fsd?vehicle_id=1&days=400", "days exceeds maximum"},
		{"unknown timezone", "/analytics/fsd?vehicle_id=1&timezone=Mars/Olympus", "timezone must be a valid IANA timezone"},
		{"oversized timezone", "/analytics/fsd?vehicle_id=1&timezone=" + strings.Repeat("A", maxTimezoneLen+1), "timezone must be a valid IANA timezone"},
	}

	repo := &fakeRepo{}
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := doGet(t, h, tc.target)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400", rec.Code)
			}
			payload := decodeError(t, rec)
			if payload.Error != tc.want {
				t.Errorf("error = %v, want %q", payload.Error, tc.want)
			}
			if payload.Code != "BAD_REQUEST" {
				t.Errorf("code = %v, want BAD_REQUEST", payload.Code)
			}
		})
	}

	if len(repo.gotVehicleIDs) != 0 {
		t.Errorf("rejected requests must not touch the database, got %v", repo.gotVehicleIDs)
	}
}

func TestInsights_DaysOverCapAdvertisesTheMaximum(t *testing.T) {
	h := newHandler(&fakeRepo{}, fixedClock(t, "2026-03-03T18:00:00Z"))
	rec := doGet(t, h, "/analytics/fsd?vehicle_id=1&days=1000")

	payload := decodeError(t, rec)
	if payload.Max != maxDays {
		t.Errorf("max = %v, want %d", payload.Max, maxDays)
	}
}

func TestInsights_AcceptsTheSupportedPeriodPresets(t *testing.T) {
	for _, days := range []int{7, 30, 90, 365, 366} {
		repo := &fakeRepo{}
		h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))
		rec := doGet(t, h, "/analytics/fsd?vehicle_id=4&days="+strconv.Itoa(days))
		if rec.Code != http.StatusOK {
			t.Fatalf("days=%d status = %d, want 200", days, rec.Code)
		}
		resp := decode(t, rec)
		if resp.Period.Days != days || len(resp.Daily) != days {
			t.Errorf("days=%d → period %d / series %d", days, resp.Period.Days, len(resp.Daily))
		}
	}
}

func TestInsights_DefaultsToThirtyUtcDaysEndingToday(t *testing.T) {
	repo := &fakeRepo{}
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	rec := doGet(t, h, "/analytics/fsd?vehicle_id=11")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	resp := decode(t, rec)

	if resp.Period.Days != defaultDays {
		t.Errorf("days = %d, want %d", resp.Period.Days, defaultDays)
	}
	if resp.Period.Timezone != "UTC" {
		t.Errorf("timezone = %q, want UTC", resp.Period.Timezone)
	}
	if resp.Period.StartDate != "2026-02-02" || resp.Period.EndDate != "2026-03-03" {
		t.Errorf("period = %s..%s", resp.Period.StartDate, resp.Period.EndDate)
	}
	if resp.VehicleID != 11 {
		t.Errorf("vehicle_id = %d, want 11", resp.VehicleID)
	}
	want := at(t, "2026-02-02T00:00:00Z")
	if !repo.gotWindowFrom.Equal(want) {
		t.Errorf("window from = %v, want %v", repo.gotWindowFrom, want)
	}
	if !repo.gotBaselineCut.Equal(want) {
		t.Errorf("baseline cutoff = %v, want the window start", repo.gotBaselineCut)
	}
	if !repo.gotWindowTo.Equal(at(t, "2026-03-03T18:00:00Z")) {
		t.Errorf("window to = %v", repo.gotWindowTo)
	}
	if len(repo.gotFields) != 2 {
		t.Errorf("fields = %v", repo.gotFields)
	}
}

func TestInsights_LocalTimezoneShiftsTheWindowStart(t *testing.T) {
	repo := &fakeRepo{}
	h := newHandler(repo, fixedClock(t, "2026-03-03T02:00:00Z")) // 2026-03-02 18:00 PST

	rec := doGet(t, h, "/analytics/fsd?vehicle_id=11&days=2&timezone=America/Los_Angeles")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	resp := decode(t, rec)

	if resp.Period.Timezone != "America/Los_Angeles" {
		t.Errorf("timezone = %q", resp.Period.Timezone)
	}
	if resp.Period.StartDate != "2026-03-01" || resp.Period.EndDate != "2026-03-02" {
		t.Errorf("period = %s..%s, want 2026-03-01..2026-03-02", resp.Period.StartDate, resp.Period.EndDate)
	}
	// Local midnight on 2026-03-01 in PST is 08:00Z.
	if !repo.gotWindowFrom.Equal(at(t, "2026-03-01T08:00:00Z")) {
		t.Errorf("window from = %v, want 2026-03-01T08:00:00Z", repo.gotWindowFrom.UTC())
	}
}

func TestInsights_MidnightDstGapUsesFirstValidInstantOfLocalDate(t *testing.T) {
	repo := &fakeRepo{}
	h := newHandler(repo, fixedClock(t, "2025-09-07T12:00:00Z"))

	rec := doGet(t, h, "/analytics/fsd?vehicle_id=11&days=1&timezone=America/Santiago")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	resp := decode(t, rec)

	if resp.Period.StartDate != "2025-09-07" || resp.Period.EndDate != "2025-09-07" {
		t.Errorf("period = %s..%s, want the requested local date", resp.Period.StartDate, resp.Period.EndDate)
	}
	// Santiago advances from 23:59:59 on September 6 directly to 01:00 on
	// September 7. Local midnight does not exist; the SQL range must start at
	// the first real instant of September 7, not normalize into September 6.
	want := at(t, "2025-09-07T04:00:00Z")
	if !repo.gotWindowFrom.Equal(want) {
		t.Errorf("window from = %v, want %v", repo.gotWindowFrom.UTC(), want)
	}
	if !repo.gotBaselineCut.Equal(want) {
		t.Errorf("baseline cutoff = %v, want %v", repo.gotBaselineCut.UTC(), want)
	}
}

// ---------------------------------------------------------------------------
// happy path + degraded data
// ---------------------------------------------------------------------------

func TestInsights_CombinesBaselineAndWindowSamples(t *testing.T) {
	repo := &fakeRepo{
		baseline: []Sample{
			fsdSample(t, "2026-02-28T23:00:00Z", fp(1000)),
			drivingSample(t, "2026-02-28T23:00:00Z", fp(4000)),
		},
		window: []Sample{
			fsdSample(t, "2026-03-02T09:00:00Z", fp(1500)),
			drivingSample(t, "2026-03-02T09:00:00Z", fp(6000)),
			fsdSample(t, "2026-03-03T09:00:00Z", fp(1700)),
			drivingSample(t, "2026-03-03T09:00:00Z", fp(6800)),
		},
	}
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	rec := doGet(t, h, "/analytics/fsd?vehicle_id=8&days=3")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("content-type = %q", ct)
	}
	resp := decode(t, rec)

	wantMeasured(t, resp.Totals.FSDDistanceM, 700, "total fsd")
	wantMeasured(t, resp.Totals.DrivingDistanceM, 2800, "total driving")
	wantMeasured(t, resp.Totals.FSDSharePct, 25, "share")
	if !resp.Quality.FSDBaselineAvailable {
		t.Error("baseline must be reported available")
	}
	if !resp.Quality.FSDReportedInPeriod || !resp.Quality.FSDDistanceDerivable {
		t.Errorf("quality = %+v, want fsd reported + derivable", resp.Quality)
	}
	if len(resp.Daily) != 3 {
		t.Fatalf("series length = %d, want 3", len(resp.Daily))
	}
}

func TestInsights_NoCounterObservationsIsATwoHundredWithADenseUnmeasuredSeries(t *testing.T) {
	h := newHandler(&fakeRepo{}, fixedClock(t, "2026-03-03T18:00:00Z"))

	rec := doGet(t, h, "/analytics/fsd?vehicle_id=99&days=7")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (an untelemetered vehicle is not an error)", rec.Code)
	}
	resp := decode(t, rec)

	if len(resp.Daily) != 7 {
		t.Fatalf("series length = %d, want 7", len(resp.Daily))
	}
	if resp.Quality.CounterObservationDays != 0 ||
		resp.Quality.DaysWithoutCounterObservation != 7 {
		t.Errorf("quality = %+v", resp.Quality)
	}
	if resp.Totals.FSDSharePct != nil || resp.Totals.DrivingDistanceM != nil || resp.Totals.FSDDistanceM != nil {
		t.Error("nothing observed must serialize as null, not zero")
	}
	for _, d := range resp.Daily {
		if d.HasCounterObservation {
			t.Fatalf("day %s claims a counter observation", d.Date)
		}
		if d.FSDDistanceM != nil {
			t.Fatalf("day %s claims a measured distance", d.Date)
		}
	}
}

func TestInsights_DrivingOnlyVehicleSerializesNullSelfDrivingDistance(t *testing.T) {
	// The wire shape is what the frontend branches on, so assert on the raw
	// JSON rather than only on the decoded struct: `"fsd_distance_m": null`
	// must never become `0`.
	repo := &fakeRepo{
		baseline: []Sample{drivingSample(t, "2026-02-28T23:00:00Z", fp(4000))},
		window: []Sample{
			drivingSample(t, "2026-03-01T09:00:00Z", fp(20000)),
			drivingSample(t, "2026-03-02T09:00:00Z", fp(41000)),
		},
	}
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	rec := doGet(t, h, "/analytics/fsd?vehicle_id=8&days=3")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	var raw struct {
		Totals  map[string]json.RawMessage `json:"totals"`
		Quality struct {
			FSDReportedInPeriod  bool `json:"fsd_reported_in_period"`
			FSDDistanceDerivable bool `json:"fsd_distance_derivable"`
		} `json:"quality"`
		Daily []map[string]json.RawMessage `json:"daily"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode raw: %v", err)
	}
	if got, ok := raw.Totals["fsd_distance_m"]; !ok {
		t.Fatal("totals.fsd_distance_m key missing")
	} else if string(got) != "null" {
		t.Errorf("totals.fsd_distance_m = %s, want null", got)
	}
	if got, ok := raw.Totals["driving_distance_m"]; !ok || string(got) == "null" {
		t.Error("totals.driving_distance_m must still be measured")
	}

	if raw.Quality.FSDReportedInPeriod || raw.Quality.FSDDistanceDerivable {
		t.Errorf(
			"quality flags = %v / %v, want false / false",
			raw.Quality.FSDReportedInPeriod,
			raw.Quality.FSDDistanceDerivable,
		)
	}

	if len(raw.Daily) != 3 {
		t.Fatalf("daily length = %d, want 3", len(raw.Daily))
	}
	for _, day := range raw.Daily {
		got, ok := day["fsd_distance_m"]
		if !ok || string(got) != "null" {
			t.Errorf(
				"day %s fsd_distance_m = %s, want null",
				day["date"],
				got,
			)
		}
	}
}

func TestInsights_ResetAndMissingDenominatorSurfaceInQuality(t *testing.T) {
	repo := &fakeRepo{
		window: []Sample{
			fsdSample(t, "2026-03-01T09:00:00Z", fp(5000)),
			fsdSample(t, "2026-03-02T09:00:00Z", fp(120)),
			fsdSample(t, "2026-03-03T09:00:00Z", fp(400)),
		},
	}
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	resp := decode(t, doGet(t, h, "/analytics/fsd?vehicle_id=8&days=3"))

	if resp.Quality.FSDResetCount != 1 {
		t.Errorf("reset count = %d, want 1", resp.Quality.FSDResetCount)
	}
	if resp.Quality.FSDBaselineAvailable {
		t.Error("baseline must be reported unavailable")
	}
	if resp.Quality.DrivingDenominatorAvailable {
		t.Error("denominator must be reported unavailable")
	}
	if resp.Totals.FSDSharePct != nil {
		t.Errorf("share = %v, want null", resp.Totals.FSDSharePct)
	}
	wantMeasured(t, resp.Totals.FSDDistanceM, 280, "total fsd")
}

// ---------------------------------------------------------------------------
// read deadline — ONE budget for the whole request
// ---------------------------------------------------------------------------

func TestInsights_BothReadsShareASingleDeadline(t *testing.T) {
	repo := &fakeRepo{}
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	doGet(t, h, "/analytics/fsd?vehicle_id=8&days=3")

	if repo.gotBaselineCtx == nil || repo.gotWindowCtx == nil {
		t.Fatal("both reads must receive a context")
	}
	baselineDeadline, ok := repo.gotBaselineCtx.Deadline()
	if !ok {
		t.Fatal("the baseline read must run under a deadline")
	}
	windowDeadline, ok := repo.gotWindowCtx.Deadline()
	if !ok {
		t.Fatal("the window read must run under a deadline")
	}
	// Identical instants: the second query does NOT get a fresh budget after
	// the first has already spent part of the request's time.
	if !baselineDeadline.Equal(windowDeadline) {
		t.Errorf("deadlines differ (%v vs %v) — the second read got a fresh budget",
			baselineDeadline, windowDeadline)
	}
	// It is the same context object, not merely one with an equal deadline.
	if repo.gotBaselineCtx != repo.gotWindowCtx {
		t.Error("both reads must run under the SAME context value")
	}
	if remaining := time.Until(baselineDeadline); remaining > insightsQueryBudget {
		t.Errorf("remaining budget %v exceeds insightsQueryBudget %v", remaining, insightsQueryBudget)
	}
}

func TestInsights_ASlowFirstReadDoesNotRefreshTheBudget(t *testing.T) {
	repo := &fakeRepo{}
	// Burn a slice of the budget inside the first read; the second read must
	// inherit what is LEFT, not a new allowance.
	const burn = 40 * time.Millisecond
	repo.onBaseline = func() { time.Sleep(burn) }
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	doGet(t, h, "/analytics/fsd?vehicle_id=8&days=3")

	baselineDeadline, _ := repo.gotBaselineCtx.Deadline()
	windowDeadline, _ := repo.gotWindowCtx.Deadline()
	if !baselineDeadline.Equal(windowDeadline) {
		t.Fatalf("window deadline moved from %v to %v after a slow baseline read",
			baselineDeadline, windowDeadline)
	}
}

func TestInsights_ClientDisconnectCancelsTheReads(t *testing.T) {
	repo := &fakeRepo{}
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/analytics/fsd?vehicle_id=8&days=3", nil).WithContext(ctx)
	// Simulate the caller going away while the first read is in flight.
	repo.onBaseline = cancel

	h.Insights(httptest.NewRecorder(), req)

	if repo.gotWindowCtx == nil {
		t.Fatal("the window read should still have been attempted")
	}
	if err := repo.gotWindowCtx.Err(); !errors.Is(err, context.Canceled) {
		t.Errorf("window ctx err = %v, want context.Canceled — request cancellation must propagate", err)
	}
}

func TestInsightsQueryBudget_IsBoundedByTheLatencyObjective(t *testing.T) {
	// fsd_insights_latency_1s targets p99 < 1s. A read still running many
	// multiples of that is failing the objective anyway and should be cut
	// loose rather than holding a pool connection.
	if insightsQueryBudget <= 0 || insightsQueryBudget > 10*time.Second {
		t.Fatalf("insightsQueryBudget = %v, want a small positive bound near the SLO", insightsQueryBudget)
	}
}

// ---------------------------------------------------------------------------
// failure paths
// ---------------------------------------------------------------------------

func TestInsights_RepoFailuresReturnASafeFiveHundred(t *testing.T) {
	cases := []struct {
		name string
		repo *fakeRepo
	}{
		{"baseline query", &fakeRepo{baselineErr: errors.New("pg: relation locked at 10.0.0.5:5432")}},
		{"window query", &fakeRepo{windowErr: errors.New("pg: relation locked at 10.0.0.5:5432")}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHandler(tc.repo, fixedClock(t, "2026-03-03T18:00:00Z"))
			rec := doGet(t, h, "/analytics/fsd?vehicle_id=8&days=3")

			if rec.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500", rec.Code)
			}
			payload := decodeError(t, rec)
			if payload.Error != "failed to load FSD insights" {
				t.Errorf("error = %v, want the generic message", payload.Error)
			}
			if body := rec.Body.String(); strings.Contains(body, "10.0.0.5") || strings.Contains(body, "relation locked") {
				t.Errorf("internal detail leaked to the client: %s", body)
			}
		})
	}
}

func TestInsights_BaselineFailureShortCircuitsBeforeTheWindowQuery(t *testing.T) {
	repo := &fakeRepo{baselineErr: errors.New("boom")}
	h := newHandler(repo, fixedClock(t, "2026-03-03T18:00:00Z"))

	doGet(t, h, "/analytics/fsd?vehicle_id=8&days=3")

	if !repo.gotWindowFrom.IsZero() {
		t.Error("window query must not run after the baseline query failed")
	}
}

// ---------------------------------------------------------------------------
// period boundary helper
// ---------------------------------------------------------------------------

func TestPeriodStart(t *testing.T) {
	la := mustLoc(t, "America/Los_Angeles")

	got := periodStart(at(t, "2026-03-03T18:00:00Z"), 1, time.UTC)
	if !got.Equal(at(t, "2026-03-03T00:00:00Z")) {
		t.Errorf("days=1 → %v, want the current local midnight", got.UTC())
	}

	got = periodStart(at(t, "2026-03-03T02:00:00Z"), 3, la)
	if !got.Equal(at(t, "2026-02-28T08:00:00Z")) {
		t.Errorf("days=3 in PST → %v, want 2026-02-28T08:00:00Z", got.UTC())
	}

	// Defensive normalisation: never produce an empty or reversed window.
	if got := periodStart(at(t, "2026-03-03T18:00:00Z"), 0, nil); !got.Equal(at(t, "2026-03-03T00:00:00Z")) {
		t.Errorf("days=0 → %v", got.UTC())
	}
}

func TestHandler_NowFallsBackToWallClock(t *testing.T) {
	h := &Handler{repo: &fakeRepo{}}
	before := time.Now().UTC().Add(-time.Second)
	if got := h.now(); got.Before(before) {
		t.Errorf("now() = %v, want a fresh wall-clock reading", got)
	}
}
