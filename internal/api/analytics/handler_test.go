package analytics

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type stateCallRecord struct {
	vehicleID int64
	at        time.Time
}

type fakeStateReader struct {
	stateFn func(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error)
}

func (f *fakeStateReader) State(ctx context.Context, vehicleID int64, at time.Time) (signal.State, error) {
	if f.stateFn == nil {
		return signal.State{}, nil
	}
	return f.stateFn(ctx, vehicleID, at)
}

func (f *fakeStateReader) SignalAt(context.Context, int64, string, time.Time) (signal.SignalValue, error) {
	return nil, nil
}

func (f *fakeStateReader) Timeline(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error) {
	return nil, nil
}

var _ signal.StateReader = (*fakeStateReader)(nil)

// fakeVehicleListFetcher is the in-memory vehicleListFetcher used by
// analytics handler tests so the migrated Fleet endpoint can be exercised
// end-to-end without a real *vehicledb.VehicleRepo / pgx pool.
type fakeVehicleListFetcher struct {
	vehicles []*vehiclemodel.Vehicle
	err      error
	calls    int
}

func (f *fakeVehicleListFetcher) GetAll(_ context.Context) ([]*vehiclemodel.Vehicle, error) {
	f.calls++
	return f.vehicles, f.err
}

// fakeDriveByVehicleFetcher returns no drives so the per-vehicle loop
// body in Fleet does not require a real driveRepo when the test is
// focused on the StateReader integration / error propagation contract.
type fakeDriveByVehicleFetcher struct{}

func (fakeDriveByVehicleFetcher) GetByVehicle(_ context.Context, _ int64, _, _ int, _, _ time.Time) ([]*drivemodel.Drive, error) {
	return nil, nil
}

// fakeChargingByVehicleFetcher returns no sessions so the per-vehicle
// loop body in Fleet does not require a real chargingRepo when the test
// is focused on the StateReader integration / error propagation
// contract.
type fakeChargingByVehicleFetcher struct{}

func (fakeChargingByVehicleFetcher) GetByVehicle(_ context.Context, _ int64, _, _ int, _, _ time.Time) ([]*chargingmodel.ChargingSession, error) {
	return nil, nil
}

// TestAnalyticsHandler_FleetSummary_UsesNowSnapshot verifies that the
// Fleet endpoint resolves each vehicle's current battery snapshot via
// StateReader.State at time.Now() — NOT a stale rolling window or a
// fixed archive timestamp. Forward-folded "now" snapshots are what feed
// per-vehicle BatteryLevel into the fleet battery_trend response, so a
// future regression that anchors this lookup to the period start would
// freeze battery health at the beginning of the lookback window and is
// caught here.
func TestAnalyticsHandler_FleetSummary_UsesNowSnapshot(t *testing.T) {
	vid := int64(42)
	var calls []stateCallRecord
	fake := &fakeStateReader{
		stateFn: func(_ context.Context, v int64, at time.Time) (signal.State, error) {
			calls = append(calls, stateCallRecord{vehicleID: v, at: at})
			return signal.State{"BatteryLevel": 87.0}, nil
		},
	}
	h := &AnalyticsHandler{
		vehicleRepo:  &fakeVehicleListFetcher{vehicles: []*vehiclemodel.Vehicle{{ID: vid, DisplayName: "Test"}}},
		driveRepo:    fakeDriveByVehicleFetcher{},
		chargingRepo: fakeChargingByVehicleFetcher{},
		state:        fake,
	}

	before := time.Now()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/analytics/fleet", nil)
	h.Fleet(rec, req)
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if len(calls) != 1 {
		t.Fatalf("State call count = %d, want 1 (one per vehicle)", len(calls))
	}
	if calls[0].vehicleID != vid {
		t.Fatalf("State.vehicleID = %d, want %d", calls[0].vehicleID, vid)
	}
	if calls[0].at.Before(before.Add(-time.Second)) || calls[0].at.After(after.Add(time.Second)) {
		t.Fatalf("State.at = %v, want within [%v, %v] (≈ time.Now())", calls[0].at, before, after)
	}
}

// TestAnalyticsHandler_PropagatesError verifies that a vehicleRepo.GetAll
// transport error (e.g. pgx connection drop) becomes a 500 to the client
// for the Fleet endpoint. The legacy handler also returned 500 here;
// this test locks the contract in for the migrated implementation so a
// future regression that swallows the error or returns an empty payload
// is caught.
func TestAnalyticsHandler_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	h := &AnalyticsHandler{
		vehicleRepo:  &fakeVehicleListFetcher{err: wantErr},
		driveRepo:    fakeDriveByVehicleFetcher{},
		chargingRepo: fakeChargingByVehicleFetcher{},
		state:        &fakeStateReader{},
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/analytics/fleet", nil)
	h.Fleet(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestAnalyticsWindow_BoundsAndValidatesRequests(t *testing.T) {
	now := time.Date(2026, time.August, 26, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name          string
		target        string
		wantErr       bool
		wantDays      int
		wantUnbounded bool
		wantStart     time.Time
		wantEndZero   bool
	}{
		{name: "all history remains unbounded", target: "/analytics/fleet", wantUnbounded: true},
		{name: "explicit days", target: "/analytics/fleet?days=30", wantDays: 30},
		{name: "one year leap window", target: "/analytics/fleet?days=366", wantDays: 366},
		{name: "shipped one year preset", target: "/analytics/fleet?days=367", wantDays: 367},
		{name: "zero days", target: "/analytics/fleet?days=0", wantErr: true},
		{name: "invalid date", target: "/analytics/fleet?start=not-a-date", wantErr: true},
		{name: "reversed range", target: "/analytics/fleet?start=2026-08-27&end=2026-08-26", wantErr: true},
		{name: "long explicit range remains valid", target: "/analytics/fleet?start=2024-01-01&end=2026-08-26"},
		{
			name:        "one sided old start remains valid",
			target:      "/analytics/fleet?start=2020-01-01",
			wantStart:   time.Date(2020, time.January, 1, 0, 0, 0, 0, time.UTC),
			wantEndZero: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.target, nil)
			start, end, err := analyticsWindow(req, now)
			if (err != nil) != tt.wantErr {
				t.Fatalf("analyticsWindow() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if tt.wantUnbounded {
				if !start.IsZero() || !end.IsZero() {
					t.Fatalf("all-history window = (%s, %s), want unbounded zero values", start, end)
				}
				return
			}
			if tt.wantEndZero && !end.IsZero() {
				t.Fatalf("one-sided start end = %s, want zero", end)
			}
			if !tt.wantStart.IsZero() && !start.Equal(tt.wantStart) {
				t.Fatalf("start = %s, want %s", start, tt.wantStart)
			}
			if tt.wantDays > 0 {
				if got := int(end.Sub(start).Hours() / 24); got != tt.wantDays {
					t.Fatalf("window length = %d days, want %d", got, tt.wantDays)
				}
			}
		})
	}
}

func TestAnalyticsHandler_FleetAcceptsHistoricalAndOneYearPresets(t *testing.T) {
	tests := []struct {
		name   string
		target string
	}{
		{name: "all history", target: "/analytics/fleet"},
		{name: "leap year", target: "/analytics/fleet?days=366"},
		{name: "shipped one year preset", target: "/analytics/fleet?days=367"},
		{name: "one sided historical start", target: "/analytics/fleet?start=2020-01-01"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := &AnalyticsHandler{
				vehicleRepo:  &fakeVehicleListFetcher{},
				driveRepo:    fakeDriveByVehicleFetcher{},
				chargingRepo: fakeChargingByVehicleFetcher{},
				state:        &fakeStateReader{},
			}
			rec := httptest.NewRecorder()
			h.Fleet(rec, httptest.NewRequest(http.MethodGet, tt.target, nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}
