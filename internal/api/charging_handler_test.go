package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/go-chi/chi/v5"
)

// fakeChargingByIDFetcher is the in-memory charging session lookup used by
// charging_handler tests so the migrated handlers can be exercised end-to-end
// without a real *database.ChargingRepo / pgx pool.
type fakeChargingByIDFetcher struct {
	session *chargingmodel.ChargingSession
	err     error
	calls   int
}

func (f *fakeChargingByIDFetcher) GetByID(_ context.Context, _ int64) (*chargingmodel.ChargingSession, error) {
	f.calls++
	return f.session, f.err
}

// newChargingRequest builds an *http.Request with the chi route context wired
// so urlParamInt64(r, "sessionID") inside the handler resolves to sessionID.
func newChargingRequest(t *testing.T, sessionID, target string) *http.Request {
	t.Helper()
	if target == "" {
		target = "/charging/" + sessionID
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("sessionID", sessionID)
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

// completedChargingSession is a minimal fixture for tests that exercise the
// completed-session path (EndedAt != nil → enrichLiveCharge is NOT invoked).
func completedChargingSession(sessionID, vehicleID int64, start, end time.Time) *chargingmodel.ChargingSession {
	endCopy := end
	return &chargingmodel.ChargingSession{
		ID:        sessionID,
		VehicleID: vehicleID,
		StartedAt: start,
		EndedAt:   &endCopy,
	}
}

// inProgressChargingSession is a minimal fixture for tests that exercise the
// in-progress path (EndedAt == nil → enrichLiveCharge IS invoked).
func inProgressChargingSession(sessionID, vehicleID int64, start time.Time) *chargingmodel.ChargingSession {
	return &chargingmodel.ChargingSession{
		ID:        sessionID,
		VehicleID: vehicleID,
		StartedAt: start,
		EndedAt:   nil,
	}
}

// TestChargingHandler_SessionDetails_UsesStartSnapshot verifies that
// enrichLiveCharge resolves the start-of-session baseline by calling
// StateReader.State with session.StartTs (NOT time.Now() and NOT a recent
// rolling window). Battery and energy-added deltas depend on this baseline
// being anchored to the actual session start.
func TestChargingHandler_SessionDetails_UsesStartSnapshot(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 15, 0, time.UTC)
	session := inProgressChargingSession(11, 42, startTs)
	var calls []stateCallRecord
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			calls = append(calls, stateCallRecord{vid, at})
			return signal.State{}, nil
		},
	}
	charging := &fakeChargingByIDFetcher{session: session}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.Get(rec, newChargingRequest(t, "11", ""))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(calls) < 1 {
		t.Fatalf("State call count = %d, want at least 1 (start snapshot)", len(calls))
	}
	if calls[0].vehicleID != session.VehicleID {
		t.Fatalf("State[0].vehicleID = %d, want %d", calls[0].vehicleID, session.VehicleID)
	}
	if !calls[0].at.Equal(startTs) {
		t.Fatalf("State[0].at = %v, want %v (session.StartTs)", calls[0].at, startTs)
	}
}

// TestChargingHandler_Latest_UsesNowSnapshot verifies that currentSignals
// falls back to StateReader.State(time.Now().UTC()) when no Redis cache is
// configured. The "now" anchor matters because in-progress charge metrics
// (current battery, current power, energy-added delta endpoint) all derive
// from this snapshot.
func TestChargingHandler_Latest_UsesNowSnapshot(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 0, 0, time.UTC)
	session := inProgressChargingSession(11, 42, startTs)
	var calls []stateCallRecord
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, vid int64, at time.Time) (signal.State, error) {
			calls = append(calls, stateCallRecord{vid, at})
			return signal.State{}, nil
		},
	}
	charging := &fakeChargingByIDFetcher{session: session}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	before := time.Now().UTC()
	rec := httptest.NewRecorder()
	h.Get(rec, newChargingRequest(t, "11", ""))
	after := time.Now().UTC()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	// enrichLiveCharge issues two State() calls: [0] start snapshot, [1] current.
	if len(calls) < 2 {
		t.Fatalf("State call count = %d, want at least 2 (start + current)", len(calls))
	}
	cur := calls[1]
	if cur.vehicleID != session.VehicleID {
		t.Fatalf("State[1].vehicleID = %d, want %d", cur.vehicleID, session.VehicleID)
	}
	// Allow a 1-second tolerance window around the wall-clock observation.
	if cur.at.Before(before.Add(-time.Second)) || cur.at.After(after.Add(time.Second)) {
		t.Fatalf("State[1].at = %v, want within [%v, %v] (≈ time.Now())", cur.at, before, after)
	}
}

// TestChargingHandler_Telemetry_ChartMode locks in the chart-mode contract:
// TelemetryReadings MUST call Timeline with an empty CollapseBy slice so
// every change-feed emission becomes one row (forward-folded values appear
// at every later timestamp). A non-empty CollapseBy would drop rows with
// "still 50 kW, still 65%" tuples and break stepped-line chart rendering on
// the frontend's charging-session detail page.
func TestChargingHandler_Telemetry_ChartMode(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(15 * time.Minute)
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, nil
		},
	}
	charging := &fakeChargingByIDFetcher{session: completedChargingSession(7, 42, t0, t1)}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.TelemetryReadings(rec, newChargingRequest(t, "7", "/charging/7/telemetry"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(fake.gotTimelineOpts.CollapseBy) != 0 {
		t.Fatalf("Timeline opts.CollapseBy = %v, want empty (chart mode)", fake.gotTimelineOpts.CollapseBy)
	}
	if fake.gotTimelineCalls != 1 {
		t.Fatalf("Timeline call count = %d, want 1", fake.gotTimelineCalls)
	}
	// The mappings passed in must be the canonical charge telemetry set so
	// the frontend wire shape (battery_level, voltage, power_kw, ...) is
	// preserved.
	if len(fake.gotTimelineFields) != len(chargeTelemetryFieldMappings) {
		t.Fatalf("Timeline fields count = %d, want %d", len(fake.gotTimelineFields), len(chargeTelemetryFieldMappings))
	}
}

// TestChargingHandler_Telemetry_PropagatesError verifies that a Timeline
// transport error (e.g. pgx connection drop) becomes a 500 to the client.
// The legacy handler also returned 500 here; this test locks the contract
// in for the migrated implementation so a future regression that swallows
// the error is caught.
func TestChargingHandler_Telemetry_PropagatesError(t *testing.T) {
	t0 := time.Date(2026, 4, 30, 10, 0, 0, 0, time.UTC)
	t1 := t0.Add(15 * time.Minute)
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		timelineFn: func(_ context.Context, _ int64, _ []signal.FieldMapping, _, _ time.Time, _ signal.TimelineOptions) ([]signal.TimelineRow, error) {
			return nil, wantErr
		},
	}
	charging := &fakeChargingByIDFetcher{session: completedChargingSession(7, 42, t0, t1)}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.TelemetryReadings(rec, newChargingRequest(t, "7", "/charging/7/telemetry"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

// TestChargingHandler_Latest_PropagatesError verifies that a State transport
// error on the CURRENT (now) snapshot lookup becomes a 500 for an
// in-progress session. The start snapshot succeeds, isolating the error to
// the latest-snapshot path; the legacy handler degraded to an empty current
// snapshot (silently zeroing battery/power), but the migrated handler
// surfaces the failure so the frontend can show an error state instead of
// rendering wrong live numbers.
func TestChargingHandler_Latest_PropagatesError(t *testing.T) {
	startTs := time.Date(2026, 4, 30, 9, 30, 0, 0, time.UTC)
	wantErr := errors.New("simulated pgx connection lost on current snapshot")
	var stateCalls int
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, _ int64, at time.Time) (signal.State, error) {
			stateCalls++
			if at.Equal(startTs) {
				return signal.State{}, nil
			}
			return nil, wantErr
		},
	}
	charging := &fakeChargingByIDFetcher{session: inProgressChargingSession(7, 42, startTs)}
	h := &ChargingHandler{state: fake, live: newTestLiveStateReader(fake), charging: charging}

	rec := httptest.NewRecorder()
	h.Get(rec, newChargingRequest(t, "7", ""))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
	if stateCalls < 2 {
		t.Fatalf("State call count = %d, want >= 2 (start succeeds, current fails)", stateCalls)
	}
}
