package smartreadinesssvc

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const latestStartSafetyFactor = 1.25

func EstimateLatestStart(
	plan domain.Plan, values map[string]*signal.Value, now time.Time, atChargingSite func(float64, float64) bool,
) domain.LatestStart {
	result := domain.LatestStart{
		PlanID: plan.ID, PlanVersion: plan.Version, VehicleID: plan.VehicleID, Status: domain.LatestStartUnavailable,
		Reason: domain.LatestStartReasonUnknownState,
	}
	if !plan.Enabled || !validPlan(plan) {
		return result
	}
	batteryValue := values["BatteryLevel"]
	if !freshObservation(batteryValue, now) {
		return result
	}
	batteryPct, ok := signal.Float64(batteryValue.Raw)
	if !ok || !finiteBetween(batteryPct, 0, 100) {
		return result
	}
	observedAt := batteryValue.Timestamp
	projection, _, _ := projectTrip(plan, batteryPct)
	if projection != nil {
		result.TripProjection = projection
		result.ObservedAt = timePointer(observedAt.UTC())
		result.ExpiresAt = timePointer(observedAt.Add(signal.LiveSignalFreshnessThreshold).UTC())
	}
	requiredLow, requiredHigh, _, highPossible := departureRequirements(plan)
	if !highPossible {
		result.Status = domain.LatestStartUnachievable
		result.Reason = ""
		result.ObservedAt = timePointer(observedAt.UTC())
		result.ExpiresAt = timePointer(observedAt.Add(signal.LiveSignalFreshnessThreshold).UTC())
		return result
	}
	if batteryPct >= requiredHigh {
		result.Status, result.Reason = domain.LatestStartSufficient, ""
		result.ObservedAt = timePointer(observedAt.UTC())
		result.ExpiresAt = timePointer(observedAt.Add(signal.LiveSignalFreshnessThreshold).UTC())
		return result
	}

	capacityValue := values["NominalFullPackEnergyKwh"]
	stateValue := values["DetailedChargeState"]
	if !freshObservation(capacityValue, now) || !freshObservation(stateValue, now) {
		return result
	}
	state, ok := stateValue.Raw.(string)
	if !ok || (state != "Charging" && state != "Starting") {
		result.Reason = domain.LatestStartReasonNotCharging
		return result
	}
	capacityWh, ok := signal.Float64(capacityValue.Raw)
	if !ok || !finiteBetween(capacityWh, 1, 500000) {
		return result
	}

	powerW, powerAt, ok := measuredChargingPower(values, now, false)
	if !ok {
		result.Reason = domain.LatestStartReasonNotCharging
		return result
	}
	gearValue := values["Gear"]
	latitude, longitude, locationAt, locationOK := freshLocation(values, now)
	if !freshObservation(gearValue, now) || gearValue.Raw != enums.GearPark || !locationOK ||
		plan.ChargingPlaceID == nil {
		result.Reason = domain.LatestStartReasonUnknownLocation
		return result
	}
	if atChargingSite == nil || !atChargingSite(latitude, longitude) {
		result.Reason = domain.LatestStartReasonOutsideSite
		return result
	}
	requiredLowPct := math.Max(0, requiredLow-batteryPct)
	requiredHighPct := math.Max(0, requiredHigh-batteryPct)
	lowHours := capacityWh * requiredLowPct / 100 / powerW * latestStartSafetyFactor
	highHours := capacityWh * requiredHighPct / 100 / powerW * latestStartSafetyFactor
	if !finiteBetween(lowHours, 0, 24*7) || !finiteBetween(highHours, lowHours, 24*7) {
		return result
	}
	lowDuration := time.Duration(math.Ceil(lowHours * float64(time.Hour)))
	highDuration := time.Duration(math.Ceil(highHours * float64(time.Hour)))
	earliest := plan.DepartureAt.Add(-highDuration).UTC()
	latest := plan.DepartureAt.Add(-lowDuration).UTC()
	if capacityValue.Timestamp.Before(observedAt) {
		observedAt = capacityValue.Timestamp
	}
	if stateValue.Timestamp.Before(observedAt) {
		observedAt = stateValue.Timestamp
	}
	if powerAt.Before(observedAt) {
		observedAt = powerAt
	}
	if gearValue.Timestamp.Before(observedAt) {
		observedAt = gearValue.Timestamp
	}
	if locationAt.Before(observedAt) {
		observedAt = locationAt
	}
	expiresAt := observedAt.Add(signal.LiveSignalFreshnessThreshold)
	if !now.Before(expiresAt) {
		return result
	}
	status := domain.LatestStartEstimate
	if !now.Before(earliest) {
		status = domain.LatestStartOverdue
	}
	return domain.LatestStart{
		PlanID: plan.ID, PlanVersion: plan.Version, VehicleID: plan.VehicleID, Status: status,
		RequiredLowPct: requiredLowPct, RequiredHighPct: requiredHighPct,
		ChargingPowerW: powerW, EarliestSafeStartAt: timePointer(earliest),
		LatestSafeStartAt: timePointer(latest), ObservedAt: timePointer(observedAt.UTC()),
		ExpiresAt: timePointer(expiresAt.UTC()), TripProjection: projection,
	}
}

func measuredChargingPower(values map[string]*signal.Value, now time.Time, preferHigher bool) (float64, time.Time, bool) {
	var best float64
	var observedAt time.Time
	for _, field := range []string{"ACChargingPower", "DCChargingPower"} {
		value := values[field]
		if !freshObservation(value, now) {
			continue
		}
		power, ok := signal.Float64(value.Raw)
		if !ok || !finiteBetween(power, 0, 500000) || power == 0 {
			continue
		}
		if best == 0 || (preferHigher && power > best) || (!preferHigher && power < best) {
			best = power
			observedAt = value.Timestamp
		}
	}
	return best, observedAt, best > 0
}

func timePointer(value time.Time) *time.Time { return &value }
