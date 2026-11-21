package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestTripMaintenanceCrossesRecordedIntervalBeforeDeparture(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	plan := domain.Plan{ID: 8, VehicleID: 7, Version: 2, Enabled: true, DepartureAt: now.Add(12 * time.Hour)}
	setup := domain.TripMaintenanceSetup{
		PlanVersion: 2, ServiceLabel: "Documented tire rotation",
		ServiceCompletedAt: now.AddDate(0, -2, 0), ServiceOdometerM: 71_000_000, IntervalM: 10_000_000,
		TripDistanceLowM: 700_000, TripDistanceHighM: 900_000,
	}
	odometer := domain.TripOdometerObservation{VehicleID: 7, OdometerM: 80_400_000, ObservedAt: now.Add(-6 * time.Hour)}

	projection, reason := EvaluateTripMaintenance(plan, setup, odometer, now)
	if reason != domain.TripMaintenanceEligible || projection == nil || projection.DueOdometerM != 81_000_000 ||
		projection.ArrivalOdometerLowM != 81_100_000 || projection.ArrivalOdometerHighM != 81_300_000 ||
		!projection.RecordedAt.Equal(odometer.ObservedAt) || !projection.ExpiresAt.Equal(now.Add(10*time.Hour)) {
		t.Fatalf("incorrect decision for recorded service and trip: %+v, %s", projection, reason)
	}

	cases := []struct {
		name   string
		reason domain.TripMaintenanceReason
		change func(*domain.Plan, *domain.TripMaintenanceSetup, *domain.TripOdometerObservation)
	}{
		{"optimistic estimate does not establish a crossing", domain.TripMaintenanceBelowInterval, func(_ *domain.Plan, trip *domain.TripMaintenanceSetup, _ *domain.TripOdometerObservation) {
			trip.TripDistanceLowM = 500_000
		}},
		{"already due is not a trip-triggered crossing", domain.TripMaintenanceAlreadyDue, func(_ *domain.Plan, _ *domain.TripMaintenanceSetup, reading *domain.TripOdometerObservation) {
			reading.OdometerM = 81_000_000
		}},
		{"odometer before the recorded service", domain.TripMaintenanceUnknownOdometer, func(_ *domain.Plan, trip *domain.TripMaintenanceSetup, reading *domain.TripOdometerObservation) {
			reading.ObservedAt = trip.ServiceCompletedAt.Add(-time.Hour)
		}},
		{"stale evidence", domain.TripMaintenanceUnknownOdometer, func(_ *domain.Plan, _ *domain.TripMaintenanceSetup, reading *domain.TripOdometerObservation) {
			reading.ObservedAt = now.Add(-48 * time.Hour)
		}},
		{"another vehicle", domain.TripMaintenanceUnknownOdometer, func(_ *domain.Plan, _ *domain.TripMaintenanceSetup, reading *domain.TripOdometerObservation) {
			reading.VehicleID = 9
		}},
		{"edited departure has not been reviewed", domain.TripMaintenancePlanUnavailable, func(trip *domain.Plan, _ *domain.TripMaintenanceSetup, _ *domain.TripOdometerObservation) {
			trip.Version++
		}},
		{"paused plan", domain.TripMaintenancePlanUnavailable, func(trip *domain.Plan, _ *domain.TripMaintenanceSetup, _ *domain.TripOdometerObservation) {
			trip.Enabled = false
		}},
		{"too late to act", domain.TripMaintenanceOutsideWindow, func(trip *domain.Plan, _ *domain.TripMaintenanceSetup, _ *domain.TripOdometerObservation) {
			trip.DepartureAt = now.Add(2 * time.Hour)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			trip, record, reading := plan, setup, odometer
			tc.change(&trip, &record, &reading)
			if got, reason := EvaluateTripMaintenance(trip, record, reading, now); got != nil || reason != tc.reason {
				t.Fatalf("expected %s, got %+v, %s", tc.reason, got, reason)
			}
		})
	}
}
