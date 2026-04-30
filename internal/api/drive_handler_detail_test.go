package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
)

// fakeDriveByIDFetcher is the in-memory drive lookup used by drive_handler_detail
// tests so the migrated handlers can be exercised end-to-end without a real
// *database.DriveRepo / pgx pool.
type fakeDriveByIDFetcher struct {
	drive *models.Drive
	err   error
	calls int
}

func (f *fakeDriveByIDFetcher) GetByID(_ context.Context, _ int64) (*models.Drive, error) {
	f.calls++
	return f.drive, f.err
}

// newDriveDetailRequest builds an *http.Request with the chi route context wired
// so urlParamInt64(r, "driveID") inside the handler resolves to driveID.
func newDriveDetailRequest(t *testing.T, driveID, target string) *http.Request {
	t.Helper()
	if target == "" {
		target = "/drives/" + driveID
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("driveID", driveID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

// completedDrive is a minimal *models.Drive fixture for tests that exercise
// the completed-drive path (EndTs != nil → enrichLiveDrive is NOT invoked).
func completedDrive(driveID, vehicleID int64, start, end time.Time) *models.Drive {
	endCopy := end
	return &models.Drive{
		ID:        driveID,
		VehicleID: vehicleID,
		StartTs:   start,
		EndTs:     &endCopy,
	}
}

// inProgressDrive is a minimal *models.Drive fixture for tests that exercise
// the in-progress path (EndTs == nil → enrichLiveDrive IS invoked).
func inProgressDrive(driveID, vehicleID int64, start time.Time) *models.Drive {
	return &models.Drive{
		ID:        driveID,
		VehicleID: vehicleID,
		StartTs:   start,
		EndTs:     nil,
	}
}

// TestDriveDetail_Telemetry_ChartMode_NoCollapse locks in the chart-mode
// contract: TelemetryReadings MUST call Timeline with an empty CollapseBy
// slice so every change-feed emission becomes one row (forward-folded
// values appear at every later timestamp). A non-empty CollapseBy would
// drop "still 65 mph, still 80%" rows and break stepped-line chart
// rendering on the frontend.
func TestDriveDetail_Telemetry_ChartMode_NoCollapse(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(2 * time.Minute)
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, nil
		},
	}
	drives := &fakeDriveByIDFetcher{drive: completedDrive(7, 42, t0, t1)}
	h := &driveDetailHandler{state: fake, drives: drives}

	rec := httptest.NewRecorder()
	h.TelemetryReadings(rec, newDriveDetailRequest(t, "7", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
}

// TestDriveDetail_Telemetry_CarriesForwardSeed verifies that the handler
// faithfully relays Timeline rows whose Fields contain forward-folded seed
// values (i.e. values inherited from a prior emission in chart mode). The
// migrated handler must not strip or filter "unchanged" values; the
// frontend depends on every row carrying every projected field.
func TestDriveDetail_Telemetry_CarriesForwardSeed(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(5 * time.Minute)
	// Row at t0 establishes the seed (battery_level=80). Row at t0+1m only
	// changes speed; battery_level=80 here represents a forward-folded value.
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return []signal.TimelineRow{
				{Timestamp: t0, Fields: map[string]signal.SignalValue{"speed": 0.0, "battery_level": 80.0}},
				{Timestamp: t0.Add(1 * time.Minute), Fields: map[string]signal.SignalValue{"speed": 65.0, "battery_level": 80.0}},
				{Timestamp: t0.Add(2 * time.Minute), Fields: map[string]signal.SignalValue{"speed": 65.0, "battery_level": 79.0}},
			}, nil
		},
	}
	drives := &fakeDriveByIDFetcher{drive: completedDrive(7, 42, t0, t1)}
	h := &driveDetailHandler{state: fake, drives: drives}

	rec := httptest.NewRecorder()
	h.TelemetryReadings(rec, newDriveDetailRequest(t, "7", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if len(got) != 3 {
		t.Fatalf("response row count = %d, want 3", len(got))
	}
	// The middle row's battery_level (forward-folded seed value) MUST appear
	// in the response — otherwise stepped-line charts will show gaps.
	bat, ok := got[1]["battery_level"]
	if !ok {
		t.Fatalf("middle row missing battery_level (forward-folded seed dropped); row=%v", got[1])
	}
	if bat != 80.0 {
		t.Fatalf("middle row battery_level = %#v, want 80.0 (forward-folded seed)", bat)
	}
	// And the speed change at the same timestamp must also be present.
	spd, ok := got[1]["speed"]
	if !ok || spd != 65.0 {
		t.Fatalf("middle row speed = %#v, want 65.0", spd)
	}
}

// TestDriveDetail_Positions_ReturnsRowsForDriveWindow verifies that the
// Positions handler queries Timeline with the drive's [StartTs, EndTs]
// window. A wider window would leak positions from adjacent drives into
// the response; a narrower window would clip the start/end of the route.
func TestDriveDetail_Positions_ReturnsRowsForDriveWindow(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 0, 0, time.UTC)
	endTs := time.Date(2026, 4, 30, 10, 15, 0, 0, time.UTC)
	var gotFrom, gotTo time.Time
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, from, to time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			gotFrom, gotTo = from, to
			return []signal.TimelineRow{
				{Timestamp: startTs.Add(1 * time.Minute), Fields: map[string]signal.SignalValue{"latitude": 37.0, "longitude": -122.0}},
			}, nil
		},
	}
	drives := &fakeDriveByIDFetcher{drive: completedDrive(11, 42, startTs, endTs)}
	h := &driveDetailHandler{state: fake, drives: drives}

	rec := httptest.NewRecorder()
	h.Positions(rec, newDriveDetailRequest(t, "11", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !gotFrom.Equal(startTs) {
		t.Fatalf("Timeline from = %v, want %v (drive.StartTs)", gotFrom, startTs)
	}
	if !gotTo.Equal(endTs) {
		t.Fatalf("Timeline to = %v, want %v (drive.EndTs)", gotTo, endTs)
	}
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Positions Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
}

// stateCallRecord captures one State() invocation's vehicleID + at so tests
// can assert the at parameter passed by enrichLiveDrive / currentSignals.
type stateCallRecord struct {
	vehicleID int64
	at        time.Time
}

// TestDriveDetail_StartSnapshot_UsesDriveStartTime verifies that
// enrichLiveDrive resolves the start-of-drive baseline by calling
// StateReader.State with the drive's StartTs (NOT time.Now() and NOT a
// recent rolling window). Distance and battery deltas depend on this
// baseline being anchored to the actual drive start.
func TestDriveDetail_StartSnapshot_UsesDriveStartTime(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 15, 0, time.UTC)
	drive := inProgressDrive(11, 42, startTs)
	var calls []stateCallRecord
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			calls = append(calls, stateCallRecord{vid, at})
			return signal.State{}, nil
		},
	}
	h := &driveDetailHandler{DriveHandler: &DriveHandler{}, state: fake}

	if err := h.enrichLiveDrive(context.Background(), drive, time.Now()); err != nil {
		t.Fatalf("enrichLiveDrive: %v", err)
	}
	if len(calls) < 1 {
		t.Fatalf("State call count = %d, want at least 1 (start snapshot)", len(calls))
	}
	if calls[0].vehicleID != drive.VehicleID {
		t.Fatalf("State[0].vehicleID = %d, want %d", calls[0].vehicleID, drive.VehicleID)
	}
	if !calls[0].at.Equal(startTs) {
		t.Fatalf("State[0].at = %v, want %v (drive.StartTs)", calls[0].at, startTs)
	}
}

// TestDriveDetail_CurrentSnapshot_UsesNow verifies that currentSignals
// falls back to StateReader.State(time.Now().UTC()) when no Redis cache is
// configured. The "now" anchor matters because in-progress drive metrics
// (current battery, current speed, current location) all derive from this
// snapshot.
func TestDriveDetail_CurrentSnapshot_UsesNow(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 0, 0, time.UTC)
	drive := inProgressDrive(11, 42, startTs)
	var calls []stateCallRecord
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			calls = append(calls, stateCallRecord{vid, at})
			return signal.State{}, nil
		},
	}
	h := &driveDetailHandler{DriveHandler: &DriveHandler{}, state: fake}

	before := time.Now().UTC()
	if err := h.enrichLiveDrive(context.Background(), drive, time.Now()); err != nil {
		t.Fatalf("enrichLiveDrive: %v", err)
	}
	after := time.Now().UTC()
	// enrichLiveDrive issues two State() calls: [0] start snapshot, [1] current.
	if len(calls) < 2 {
		t.Fatalf("State call count = %d, want at least 2 (start + current)", len(calls))
	}
	cur := calls[1]
	if cur.vehicleID != drive.VehicleID {
		t.Fatalf("State[1].vehicleID = %d, want %d", cur.vehicleID, drive.VehicleID)
	}
	// Allow a 1-second tolerance window around the wall-clock observation.
	if cur.at.Before(before.Add(-time.Second)) || cur.at.After(after.Add(time.Second)) {
		t.Fatalf("State[1].at = %v, want within [%v, %v] (≈ time.Now())", cur.at, before, after)
	}
}

// TestDriveDetail_Telemetry_PropagatesError verifies that a Timeline
// transport error (e.g. pgx connection drop) becomes a 500 to the client.
// The legacy handler swallowed errors and returned an empty array; this
// migration tightens error handling so the frontend can surface the
// failure rather than silently rendering an empty chart.
func TestDriveDetail_Telemetry_PropagatesError(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(2 * time.Minute)
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, wantErr
		},
	}
	drives := &fakeDriveByIDFetcher{drive: completedDrive(7, 42, t0, t1)}
	h := &driveDetailHandler{state: fake, drives: drives}

	rec := httptest.NewRecorder()
	h.TelemetryReadings(rec, newDriveDetailRequest(t, "7", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestDriveDetail_StartSnapshot_PropagatesError verifies that a State
// transport error from the start-of-drive snapshot lookup becomes a 500
// for an in-progress drive. The live derivation depends on the start
// baseline (distance / battery deltas), so silently degrading to an empty
// baseline would produce wrong numbers, not no numbers.
func TestDriveDetail_StartSnapshot_PropagatesError(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 0, 0, time.UTC)
	wantErr := errors.New("simulated pgx connection lost on start snapshot")
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, _ time.Time) (signal.State, error) {
			return nil, wantErr
		},
	}
	drives := &fakeDriveByIDFetcher{drive: inProgressDrive(7, 42, startTs)}
	h := &driveDetailHandler{state: fake, drives: drives}

	rec := httptest.NewRecorder()
	h.Get(rec, newDriveDetailRequest(t, "7", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}
