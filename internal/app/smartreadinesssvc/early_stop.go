package smartreadinesssvc

import (
	"context"
	"math"
	"time"

	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func (s *Service) evaluateEarlyStop(
	ctx context.Context, plan domain.Plan, values map[string]*signal.Value, now time.Time,
	atChargingSite func(float64, float64) bool,
) (domain.Decision, error) {
	ret := domain.Decision{Reason: ReasonPlugged}
	if !plan.EarlyStopWatch || plan.Subject == personaldomain.OpenSubject || plan.ChargingPlaceID == nil {
		return ret, nil
	}
	const grace = time.Minute
	state, gear, latch := values["DetailedChargeState"], values["Gear"], values["ChargePortLatch"]
	if !freshObservation(state, now) || !boundedEarlyStopObservation(gear, now, 2*time.Hour) ||
		!boundedEarlyStopObservation(latch, now, 2*time.Hour) ||
		now.Before(state.Timestamp.Add(grace)) || state.Timestamp.Before(plan.UpdatedAt) || gear.Raw != enums.GearPark {
		return ret, nil
	}
	rawState, _ := state.Raw.(string)
	rawLatch, _ := latch.Raw.(string)
	chargeState, stateErr := protomodel.ParseDetailedChargeStateValue(rawState)
	portLatch, latchErr := protomodel.ParseChargePortLatchValue(rawLatch)
	// A generic stop, disconnect or pending start cannot distinguish user intent.
	if stateErr != nil || chargeState != protomodel.DetailedChargeStateValue_DetailedChargeStateNoPower ||
		latchErr != nil || portLatch != protomodel.ChargePortLatchValue_ChargePortLatchEngaged ||
		(plan.ScheduledStart != nil && plan.ScheduledStart.At.After(state.Timestamp)) {
		return ret, nil
	}
	if pending := values["ScheduledChargingPending"]; pending != nil && pending.Raw == true {
		return ret, nil
	}
	if enabled := values["ChargeEnableRequest"]; enabled != nil && enabled.Raw == false {
		return ret, nil
	}
	if _, at, ok := freshNumeric(values["ACChargingPower"], now, 1, 500000); ok && !at.Before(state.Timestamp) {
		return ret, nil
	}
	battery, batteryOK := earlyStopNumeric(values["BatteryLevel"], now, 15*time.Minute, 0, 100)
	capacity, capacityOK := earlyStopNumeric(values["NominalFullPackEnergyKwh"], now, 2*time.Hour, 1, 500000)
	limit, limitOK := earlyStopNumeric(values["ChargeLimitSoc"], now, 2*time.Hour, 1, 100)
	latitude, longitude := values["LocationLatitude"], values["LocationLongitude"]
	lat, latOK := earlyStopNumeric(latitude, now, 2*time.Hour, -90, 90)
	lon, lonOK := earlyStopNumeric(longitude, now, 2*time.Hour, -180, 180)
	bestTarget, target, _, possible := departureRequirements(plan)
	if !batteryOK || !capacityOK || !limitOK || !latOK || !lonOK || (lat == 0 && lon == 0) ||
		absDuration(latitude.Timestamp.Sub(longitude.Timestamp)) > maxLocationSkew || !possible ||
		minTime(latitude.Timestamp, longitude.Timestamp).Before(gear.Timestamp.Add(-2*time.Minute)) ||
		limit < target || bestTarget-battery < materialShortfall || !atChargingSite(lat, lon) {
		return ret, nil
	}
	watts, err := s.repository.PriorInterruptedChargingPower(ctx, plan, state.Timestamp, now)
	if err != nil || !finiteBetween(watts, 1, 500000) {
		return ret, err
	}
	// Do not alarm for an interruption that did not create an actionable shortfall.
	available := plan.DepartureAt.Sub(now.Add(15 * time.Minute)).Hours()
	if plan.ScheduledStart != nil && plan.ScheduledStart.PowerCeilingW != nil {
		watts = min(watts, *plan.ScheduledStart.PowerCeilingW)
	}
	projected := min(limit, battery+watts*available/latestStartSafetyFactor/capacity*100)
	if projected < target {
		return ret, nil
	}
	projection, _, bestReturn := projectTrip(plan, battery)
	low, high := math.Max(0, battery-plan.TripUseHighPct), math.Max(0, bestReturn)
	if projection != nil {
		low, high = 0, 0
		if projection.ReturnLowPct != nil && projection.ReturnHighPct != nil {
			low, high = *projection.ReturnLowPct, *projection.ReturnHighPct
		}
	}
	// Static context can be carried across an unchanged AC session, but the
	// interruption itself is never restamped or carried across checks.
	expiresAt := minTime(state.Timestamp.Add(signal.LiveSignalFreshnessThreshold), plan.DepartureAt.Add(-minimumRemedyTime))
	for _, value := range []*signal.Value{gear, latch, values["NominalFullPackEnergyKwh"], values["ChargeLimitSoc"], latitude, longitude} {
		expiresAt = minTime(expiresAt, value.Timestamp.Add(2*time.Hour))
	}
	expiresAt = minTime(expiresAt, values["BatteryLevel"].Timestamp.Add(15*time.Minute))
	if !now.Before(expiresAt) {
		return ret, nil
	}
	interruptedAt := state.Timestamp.UTC().Truncate(time.Microsecond)
	return domain.Decision{Reason: ReasonEligible, Kind: domain.DecisionEarlyStop, BatteryPct: battery,
		ArrivalLowPct: low, ArrivalHighPct: high, TripProjection: projection, InterruptedAt: &interruptedAt,
		ObservedAt: interruptedAt, ExpiresAt: expiresAt.UTC()}, nil
}

func boundedEarlyStopObservation(value *signal.Value, now time.Time, maxAge time.Duration) bool {
	return value != nil && !value.TimestampSynthetic && !value.Timestamp.IsZero() &&
		!value.Timestamp.After(now) && now.Before(value.Timestamp.Add(maxAge))
}

func earlyStopNumeric(value *signal.Value, now time.Time, maxAge time.Duration, low, high float64) (float64, bool) {
	if !boundedEarlyStopObservation(value, now, maxAge) {
		return 0, false
	}
	number, ok := signal.Float64(value.Raw)
	return number, ok && finiteBetween(number, low, high)
}

func sameEarlyStop(a, b domain.Decision) bool {
	return a.Kind != domain.DecisionEarlyStop ||
		(a.InterruptedAt != nil && b.InterruptedAt != nil && a.InterruptedAt.Equal(*b.InterruptedAt))
}
