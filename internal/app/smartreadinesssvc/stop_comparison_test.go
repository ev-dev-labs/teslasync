package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestCompareTripChargingStopsKeepsReachabilityAndWaitInTheDecision(t *testing.T) {
	departure := time.Date(2026, 4, 7, 8, 0, 0, 0, time.UTC)
	trip := domain.StopTripEnergy{
		CapacityWh: 80000, StartChargeWh: 30000, ReserveWh: 10000,
		ChargeLimitWh: 64000, HighUsageWhPerM: 0.25, DepartureAt: departure,
	}
	routes := domain.StopRoutes{
		Direct: domain.RoadLeg{DistanceM: 130000, DurationS: 6400},
		Via: []domain.StopRoute{
			{PlaceID: 8, ToStop: domain.RoadLeg{DistanceM: 55000, DurationS: 2700},
				AfterStop: domain.RoadLeg{DistanceM: 78000, DurationS: 3800}},
			{PlaceID: 9, ToStop: domain.RoadLeg{DistanceM: 65000, DurationS: 3200},
				AfterStop: domain.RoadLeg{DistanceM: 73000, DurationS: 3500}},
		},
	}
	fullHistory := func(id int64, at time.Time, fromPct, toPct float64) (domain.StopHistoryEstimate, bool) {
		if id == 8 {
			if !at.Equal(departure.Add(45*time.Minute)) || fromPct != 20.3125 || toPct != 36.875 {
				t.Fatalf("unexpected range or arrival bucket for site 8: %v, %g–%g%%", at, fromPct, toPct)
			}
			return domain.StopHistoryEstimate{
				ExpectedWaitS: 1200, ConservativePackPowerW: 60000, WaitSampleCount: 12, ChargeSampleCount: 5,
			}, true
		}
		return domain.StopHistoryEstimate{
			ExpectedWaitS: 60, ConservativePackPowerW: 50000, WaitSampleCount: 11, ChargeSampleCount: 4,
		}, true
	}
	got := CompareTripChargingStops(trip, routes, fullHistory)
	if len(got) != 2 || got[0].PlaceID != 9 || got[0].DetourM != 8000 || got[0].DetourS != 300 ||
		got[0].StationArrivalWh != 13750 || got[0].DestinationChargeWh != 10000 ||
		got[0].ExpectedWaitS != 60 || got[0].EstimatedChargeS != 1044 ||
		got[1].PlaceID != 8 || got[1].EstimatedChargeS != 795 {
		t.Fatalf("expected the slower charger to win because of a shorter historical wait: %+v", got)
	}
	sparseHistory := func(id int64, at time.Time, fromPct, toPct float64) (domain.StopHistoryEstimate, bool) {
		result, ok := fullHistory(id, at, fromPct, toPct)
		if id == 9 {
			result.WaitSampleCount = 1
		}
		return result, ok
	}
	if got := CompareTripChargingStops(trip, routes, sparseHistory); len(got) != 0 {
		t.Fatalf("incomplete wait history should not produce a comparison: %+v", got)
	}
	routes.Via[1].ToStop.DistanceM = 81000
	failingHistory := func(id int64, at time.Time, fromPct, toPct float64) (domain.StopHistoryEstimate, bool) {
		if id == 9 {
			t.Fatal("looked up history for a stop that would breach the reserve on arrival")
		}
		return fullHistory(id, at, fromPct, toPct)
	}
	if got := CompareTripChargingStops(trip, routes, failingHistory); len(got) != 0 {
		t.Fatalf("unreachable stop should prevent a qualified comparison: %+v", got)
	}
	trip.StartChargeWh = 60000
	if got := CompareTripChargingStops(trip, routes, func(int64, time.Time, float64, float64) (domain.StopHistoryEstimate, bool) {
		t.Fatal("looked up station history even though the direct leg meets its reserve")
		return domain.StopHistoryEstimate{}, false
	}); len(got) != 0 {
		t.Fatalf("unnecessary charge stop comparison: %+v", got)
	}
}
