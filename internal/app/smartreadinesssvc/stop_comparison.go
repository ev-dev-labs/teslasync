package smartreadinesssvc

import (
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

const (
	minStopWaitSamples   = 8
	minStopChargeSamples = 3
)

func CompareTripChargingStops(
	trip domain.StopTripEnergy, routes domain.StopRoutes,
	historyAt func(int64, time.Time, float64, float64) (domain.StopHistoryEstimate, bool),
) []domain.ChargingStopComparison {
	if historyAt == nil || !finiteBetween(trip.CapacityWh, 1, 500000) ||
		!finiteBetween(trip.StartChargeWh, 0, trip.CapacityWh) ||
		!finiteBetween(trip.ReserveWh, 0, trip.StartChargeWh) ||
		!finiteBetween(trip.ChargeLimitWh, trip.ReserveWh, trip.CapacityWh) ||
		!finiteBetween(trip.HighUsageWhPerM, 0.000001, 2) ||
		trip.DepartureAt.IsZero() || !validStopComparisonLeg(routes.Direct) || len(routes.Via) < 2 || len(routes.Via) > 4 {
		return nil
	}
	if trip.StartChargeWh-float64(routes.Direct.DistanceM)*trip.HighUsageWhPerM >= trip.ReserveWh {
		return nil
	}
	result := make([]domain.ChargingStopComparison, 0, len(routes.Via))
	seen := make(map[int64]bool, len(routes.Via))
	for _, route := range routes.Via {
		if route.PlaceID < 1 || seen[route.PlaceID] ||
			!validStopComparisonLeg(route.ToStop) || !validStopComparisonLeg(route.AfterStop) {
			return nil
		}
		seen[route.PlaceID] = true
		stationArrivalWh := trip.StartChargeWh - float64(route.ToStop.DistanceM)*trip.HighUsageWhPerM
		afterStopWh := float64(route.AfterStop.DistanceM) * trip.HighUsageWhPerM
		chargeWh := afterStopWh + trip.ReserveWh - stationArrivalWh
		if stationArrivalWh < trip.ReserveWh || chargeWh <= 0 ||
			afterStopWh+trip.ReserveWh > trip.ChargeLimitWh {
			continue
		}
		arriveAt := trip.DepartureAt.Add(time.Duration(route.ToStop.DurationS) * time.Second)
		history, ok := historyAt(route.PlaceID, arriveAt, stationArrivalWh/trip.CapacityWh*100,
			(afterStopWh+trip.ReserveWh)/trip.CapacityWh*100)
		if !ok || history.WaitSampleCount < minStopWaitSamples || history.ChargeSampleCount < minStopChargeSamples ||
			!finiteBetween(history.ExpectedWaitS, 0, 4*3600) || !finiteBetween(history.ConservativePackPowerW, 1, 500000) {
			continue
		}
		chargeS := math.Ceil(chargeWh / history.ConservativePackPowerW * 3600)
		if !finiteBetween(chargeS, 1, 24*3600) {
			continue
		}
		result = append(result, domain.ChargingStopComparison{
			PlaceID: route.PlaceID, ArriveAt: arriveAt.UTC(),
			DetourM:          max(0, route.ToStop.DistanceM+route.AfterStop.DistanceM-routes.Direct.DistanceM),
			DetourS:          max(0, route.ToStop.DurationS+route.AfterStop.DurationS-routes.Direct.DurationS),
			StationArrivalWh: stationArrivalWh, DestinationChargeWh: trip.ReserveWh,
			EstimatedChargeS: int64(chargeS), ExpectedWaitS: history.ExpectedWaitS,
			WaitSampleCount: history.WaitSampleCount, ChargeSampleCount: history.ChargeSampleCount,
		})
	}
	if len(result) < 2 {
		return nil
	}
	sort.SliceStable(result, func(i, j int) bool {
		a, b := result[i], result[j]
		aS := float64(a.DetourS+a.EstimatedChargeS) + a.ExpectedWaitS
		bS := float64(b.DetourS+b.EstimatedChargeS) + b.ExpectedWaitS
		return aS < bS || (aS == bS && a.PlaceID < b.PlaceID)
	})
	return result
}

func validStopComparisonLeg(leg domain.RoadLeg) bool {
	return leg.DistanceM > 0 && leg.DistanceM <= 3_000_000 &&
		leg.DurationS > 0 && leg.DurationS <= 3*24*3600
}
