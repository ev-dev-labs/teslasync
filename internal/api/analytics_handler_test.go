package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// fakeVehicleListFetcher is the in-memory vehicleListFetcher used by
// analytics handler tests so the migrated Fleet endpoint can be exercised
// end-to-end without a real *database.VehicleRepo / pgx pool.
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

func (fakeDriveByVehicleFetcher) GetByVehicle(_ context.Context, _ int64, _, _ int, _, _ time.Time) ([]*models.Drive, error) {
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
