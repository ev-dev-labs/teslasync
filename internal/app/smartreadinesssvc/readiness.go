// Package smartreadinesssvc evaluates private, user-confirmed charging plans.
package smartreadinesssvc

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

const (
	minimumRemedyTime = 30 * time.Minute
	materialShortfall = 5.0
	maxLocationSkew   = 10 * time.Second
)

type Plan = domain.Plan
type Reason = domain.Reason
type Decision = domain.Decision

const (
	ReasonEligible     = domain.ReasonEligible
	ReasonDisabled     = domain.ReasonDisabled
	ReasonNotDue       = domain.ReasonNotDue
	ReasonExpired      = domain.ReasonExpired
	ReasonInvalidPlan  = domain.ReasonInvalidPlan
	ReasonUnknownState = domain.ReasonUnknownState
	ReasonNotParked    = domain.ReasonNotParked
	ReasonPlugged      = domain.ReasonPlugged
	ReasonOutsideSite  = domain.ReasonOutsideSite
	ReasonEnoughCharge = domain.ReasonEnoughCharge
	ReasonUnachievable = domain.ReasonUnachievable
)

// Evaluate never contacts a vehicle. The site matcher must represent the
// user's selected, active charging place rather than an inferred home.
func Evaluate(
	plan Plan, values map[string]*signal.Value, now time.Time, atChargingSite func(float64, float64) bool,
) Decision {
	if !plan.Enabled {
		return Decision{Reason: ReasonDisabled}
	}
	if !validPlan(plan) {
		return Decision{Reason: ReasonInvalidPlan}
	}
	if now.Before(plan.NotifyAt) {
		return Decision{Reason: ReasonNotDue}
	}
	deadline := plan.DepartureAt.Add(-minimumRemedyTime)
	if !now.Before(deadline) {
		return Decision{Reason: ReasonExpired}
	}

	names := []string{"BatteryLevel", "DetailedChargeState", "Gear", "LocationLatitude", "LocationLongitude"}
	observedAt := now
	for _, name := range names {
		value := values[name]
		if !freshObservation(value, now) {
			return Decision{Reason: ReasonUnknownState}
		}
		if value.Timestamp.Before(observedAt) {
			observedAt = value.Timestamp
		}
	}
	battery, ok := signal.Float64(values["BatteryLevel"].Raw)
	if !ok || !finiteBetween(battery, 0, 100) {
		return Decision{Reason: ReasonUnknownState}
	}
	gear, ok := values["Gear"].Raw.(string)
	if !ok || gear == "" {
		return Decision{Reason: ReasonUnknownState}
	}
	if gear != enums.GearPark {
		return Decision{Reason: ReasonNotParked}
	}
	state, ok := values["DetailedChargeState"].Raw.(string)
	if !ok {
		return Decision{Reason: ReasonUnknownState}
	}
	chargeState, err := protomodel.ParseDetailedChargeStateValue(state)
	if err != nil || chargeState == protomodel.DetailedChargeStateValue_DetailedChargeStateUnknown {
		return Decision{Reason: ReasonUnknownState}
	}
	pendingState := chargeState == protomodel.DetailedChargeStateValue_DetailedChargeStateNoPower ||
		chargeState == protomodel.DetailedChargeStateValue_DetailedChargeStateStopped
	if chargeState != protomodel.DetailedChargeStateValue_DetailedChargeStateDisconnected &&
		chargeState != protomodel.DetailedChargeStateValue_DetailedChargeStateCharging &&
		(!pendingState || plan.ScheduledStart == nil) {
		return Decision{Reason: ReasonPlugged}
	}
	latitude, longitude, _, locationOK := freshLocation(values, now)
	if !locationOK {
		return Decision{Reason: ReasonUnknownState}
	}
	if atChargingSite == nil || !atChargingSite(latitude, longitude) {
		return Decision{Reason: ReasonOutsideSite}
	}
	kind := domain.DecisionPlugIn
	projectedBattery := battery
	var powerW float64
	_, _, lowPossible, _ := departureRequirements(plan)
	if pendingState {
		scheduleAt, matches := latePendingStart(plan, values, now)
		if !lowPossible || !matches {
			return Decision{Reason: ReasonPlugged}
		}
		kind = domain.DecisionScheduleConflict
		if scheduleAt.Before(observedAt) {
			observedAt = scheduleAt
		}
	} else if plan.TripLegs != nil && !lowPossible {
		kind = domain.DecisionTripReview
	} else if chargeState == protomodel.DetailedChargeStateValue_DetailedChargeStateCharging {
		if !lowPossible {
			return Decision{Reason: ReasonUnachievable}
		}
		capacity := values["NominalFullPackEnergyKwh"]
		if !freshObservation(capacity, now) {
			return Decision{Reason: ReasonUnknownState}
		}
		capacityWh, ok := signal.Float64(capacity.Raw)
		if !ok || !finiteBetween(capacityWh, 1, 500000) {
			return Decision{Reason: ReasonUnknownState}
		}
		var powerAt time.Time
		powerW, powerAt, ok = measuredChargingPower(values, now, true)
		if !ok {
			return Decision{Reason: ReasonUnknownState}
		}
		kind = domain.DecisionSlowCharging
		projectedBattery = math.Min(100, battery+powerW*plan.DepartureAt.Sub(now).Hours()/capacityWh*100)
		if capacity.Timestamp.Before(observedAt) {
			observedAt = capacity.Timestamp
		}
		if powerAt.Before(observedAt) {
			observedAt = powerAt
		}
	}
	projection, bestDestination, bestReturn := projectTrip(plan, projectedBattery)
	low := math.Max(0, projectedBattery-plan.TripUseHighPct)
	high := math.Max(0, bestReturn)
	if projection != nil {
		low, high = 0, 0
		if projection.ReturnLowPct != nil && projection.ReturnHighPct != nil {
			low, high = *projection.ReturnLowPct, *projection.ReturnHighPct
		}
	}
	if bestDestination >= plan.ReservePct-materialShortfall && bestReturn >= plan.ReservePct-materialShortfall {
		return Decision{Reason: ReasonEnoughCharge}
	}
	var currentLimit *domain.ChargingCurrentLimit
	if kind == domain.DecisionSlowCharging {
		var currentAt time.Time
		currentLimit, currentAt = currentLimitEvidence(values, now)
		if currentLimit != nil && currentAt.Before(observedAt) {
			observedAt = currentAt
		}
	}
	expiresAt := observedAt.Add(signal.LiveSignalFreshnessThreshold)
	if deadline.Before(expiresAt) {
		expiresAt = deadline
	}
	if !now.Before(expiresAt) {
		return Decision{Reason: ReasonUnknownState}
	}
	return Decision{
		Reason: ReasonEligible, Kind: kind, BatteryPct: battery, ChargingPowerW: powerW, CurrentLimit: currentLimit,
		ArrivalLowPct: low, ArrivalHighPct: high, TripProjection: projection,
		ObservedAt: observedAt.UTC(), ExpiresAt: expiresAt.UTC(),
	}
}

func validPlan(plan Plan) bool {
	return !plan.NotifyAt.IsZero() && !plan.DepartureAt.IsZero() &&
		plan.NotifyAt.Before(plan.DepartureAt.Add(-minimumRemedyTime)) &&
		finiteBetween(plan.TripUseLowPct, 0, 100) &&
		finiteBetween(plan.TripUseHighPct, plan.TripUseLowPct, 100) &&
		finiteBetween(plan.ReservePct, 0, 100) &&
		validTripLegs(plan.TripLegs) && tripUseMatchesLegs(plan)
}

func finiteBetween(value, low, high float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= low && value <= high
}

func freshObservation(value *signal.Value, now time.Time) bool {
	return value != nil && !value.TimestampSynthetic && !value.Timestamp.After(now) &&
		signal.IsLiveSignalFresh(value, now)
}

func freshLocation(values map[string]*signal.Value, now time.Time) (float64, float64, time.Time, bool) {
	latitudeValue, longitudeValue := values["LocationLatitude"], values["LocationLongitude"]
	if !freshObservation(latitudeValue, now) || !freshObservation(longitudeValue, now) ||
		absDuration(latitudeValue.Timestamp.Sub(longitudeValue.Timestamp)) > maxLocationSkew {
		return 0, 0, time.Time{}, false
	}
	latitude, latitudeOK := signal.Float64(latitudeValue.Raw)
	longitude, longitudeOK := signal.Float64(longitudeValue.Raw)
	if !latitudeOK || !longitudeOK || !finiteBetween(latitude, -90, 90) ||
		!finiteBetween(longitude, -180, 180) {
		return 0, 0, time.Time{}, false
	}
	observedAt := latitudeValue.Timestamp
	if longitudeValue.Timestamp.Before(observedAt) {
		observedAt = longitudeValue.Timestamp
	}
	return latitude, longitude, observedAt, true
}

func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}
