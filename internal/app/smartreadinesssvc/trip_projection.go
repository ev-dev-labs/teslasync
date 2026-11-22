package smartreadinesssvc

import (
	"math"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func validTripLegs(legs *domain.TripLegs) bool {
	if legs == nil {
		return true
	}
	return finiteBetween(legs.OutboundUseLowPct, 0, 100) &&
		finiteBetween(legs.OutboundUseHighPct, legs.OutboundUseLowPct, 100) &&
		finiteBetween(legs.ReturnUseLowPct, 0, 100) &&
		finiteBetween(legs.ReturnUseHighPct, legs.ReturnUseLowPct, 100) &&
		(legs.DestinationChargePct == nil || finiteBetween(*legs.DestinationChargePct, 0, 100))
}

func setTripUseFromLegs(plan *domain.Plan) {
	if plan.TripLegs == nil {
		return
	}
	plan.TripUseLowPct = math.Min(100, plan.TripLegs.OutboundUseLowPct+plan.TripLegs.ReturnUseLowPct)
	plan.TripUseHighPct = math.Min(100, plan.TripLegs.OutboundUseHighPct+plan.TripLegs.ReturnUseHighPct)
}

func tripUseMatchesLegs(plan domain.Plan) bool {
	if plan.TripLegs == nil {
		return true
	}
	expected := plan
	setTripUseFromLegs(&expected)
	return math.Abs(plan.TripUseLowPct-expected.TripUseLowPct) < 1e-8 &&
		math.Abs(plan.TripUseHighPct-expected.TripUseHighPct) < 1e-8
}

func departureRequirements(plan domain.Plan) (low, high float64, lowPossible, highPossible bool) {
	if plan.TripLegs == nil {
		low, high = plan.TripUseLowPct+plan.ReservePct, plan.TripUseHighPct+plan.ReservePct
		return low, high, low <= 100, high <= 100
	}
	legs := plan.TripLegs
	added := 0.0
	if legs.DestinationChargePct != nil {
		added = *legs.DestinationChargePct
	}
	low = legs.OutboundUseLowPct + math.Max(plan.ReservePct, legs.ReturnUseLowPct+plan.ReservePct-added)
	high = legs.OutboundUseHighPct + math.Max(plan.ReservePct, legs.ReturnUseHighPct+plan.ReservePct-added)
	return low, high, low <= 100 && legs.ReturnUseLowPct+plan.ReservePct <= 100,
		high <= 100 && legs.ReturnUseHighPct+plan.ReservePct <= 100
}

func projectTrip(plan domain.Plan, startingBattery float64) (*domain.TripProjection, float64, float64) {
	if plan.TripLegs == nil {
		return nil, math.Inf(1), startingBattery - plan.TripUseLowPct
	}
	legs := plan.TripLegs
	added := 0.0
	if legs.DestinationChargePct != nil {
		added = *legs.DestinationChargePct
	}
	destinationLow := startingBattery - legs.OutboundUseHighPct
	destinationHigh := startingBattery - legs.OutboundUseLowPct
	returnLow := math.Min(100, math.Max(0, destinationLow)+added) - legs.ReturnUseHighPct
	returnHigh := math.Min(100, math.Max(0, destinationHigh)+added) - legs.ReturnUseLowPct
	projection := &domain.TripProjection{
		StartingBatteryPct: startingBattery,
		DestinationLowPct:  math.Max(0, destinationLow), DestinationHighPct: math.Max(0, destinationHigh),
		DestinationReachability: reachability(destinationLow, destinationHigh),
		ReturnReachability:      "unknown",
		DestinationChargePct:    legs.DestinationChargePct,
	}
	if destinationHigh >= 0 {
		projection.ReturnReachability = reachability(returnLow, returnHigh)
		if returnHigh >= 0 {
			low, high := math.Max(0, returnLow), returnHigh
			projection.ReturnLowPct, projection.ReturnHighPct = &low, &high
		}
	}
	return projection, destinationHigh, returnHigh
}

func reachability(low, high float64) string {
	if high < 0 {
		return "unreachable"
	}
	if low < 0 {
		return "uncertain"
	}
	return "estimated_reachable"
}
