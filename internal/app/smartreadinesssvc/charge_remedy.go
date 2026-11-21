package smartreadinesssvc

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func (s *Service) checkFeasibleRemedy(
	ctx context.Context, candidate port.Candidate, values map[string]*signal.Value, decision *domain.Decision, now time.Time,
) error {
	plan := candidate.Plan
	_, target, _, possible := departureRequirements(plan)
	capacityWh, capacityAt, hasCapacity := freshNumeric(values["NominalFullPackEnergyKwh"], now, 1, 500000)
	limitPct, limitAt, hasLimit := freshNumeric(values["ChargeLimitSoc"], now, 1, 100)
	if !possible || !hasCapacity || !hasLimit || limitPct < target || decision.BatteryPct >= target ||
		plan.ChargingPlaceID == nil {
		return nil
	}
	const reviewTime = 15 * time.Minute
	available := plan.DepartureAt.Sub(now.Add(reviewTime))
	if available <= 0 {
		return nil
	}
	requiredW := (target - decision.BatteryPct) / 100 * capacityWh / available.Hours() * latestStartSafetyFactor
	prospectiveW := math.Inf(1)
	var currentAt time.Time
	if decision.Kind == domain.DecisionSlowCharging {
		prospectiveW, currentAt = prospectiveSinglePhasePower(*decision, values, now)
		requiredW = max(requiredW, decision.ChargingPowerW+500)
	}
	if plan.ScheduledStart != nil && plan.ScheduledStart.PowerCeilingW != nil {
		prospectiveW = min(prospectiveW, *plan.ScheduledStart.PowerCeilingW)
	}
	if prospectiveW < requiredW {
		return nil
	}
	sessions, err := s.repository.ListChargeRemedySessions(ctx, candidate, now)
	if err != nil {
		return err
	}
	if len(sessions) != 2 || sessions[1].EndedAt.After(sessions[0].StartedAt) ||
		sessions[0].EndedAt.UTC().Format(time.DateOnly) == sessions[1].EndedAt.UTC().Format(time.DateOnly) ||
		sessions[0].Charger != sessions[1].Charger || sessions[0].Cable != sessions[1].Cable ||
		(decision.Kind == domain.DecisionSlowCharging && sessions[0].Charger != "AC") {
		return nil
	}
	for _, row := range sessions {
		rateW := elapsedSessionPowerW(row, now)
		if rateW <= 0 || row.StartSocPct > decision.BatteryPct || row.EndSocPct < target ||
			row.EndedAt.Sub(row.StartedAt).Hours()*latestStartSafetyFactor > available.Hours() ||
			strings.EqualFold(row.Charger, "unknown") || strings.EqualFold(row.Cable, "unknown") ||
			row.StartLatitude == nil || row.StartLongitude == nil ||
			!finiteBetween(*row.StartLatitude, -90, 90) || !finiteBetween(*row.StartLongitude, -180, 180) {
			return nil
		}
		// Meter power alone overstates pack gain when the charger also serves auxiliary loads.
		gainW := (row.EndSocPct - row.StartSocPct) / 100 * capacityWh / row.EndedAt.Sub(row.StartedAt).Hours()
		// Keep the full observed loss when applying a lower input ceiling.
		if min(rateW, gainW)-max(0, rateW-prospectiveW) < requiredW {
			return nil
		}
		contains, err := s.sites.Contains(ctx, *plan.ChargingPlaceID, *row.StartLatitude, *row.StartLongitude)
		if err != nil {
			return fmt.Errorf("verify historical charging remedy location: %w", err)
		}
		if !contains {
			return nil
		}
	}
	decision.FeasibleRemedy = true
	for _, at := range []time.Time{capacityAt, limitAt, currentAt} {
		if !at.IsZero() && at.Before(decision.ObservedAt) {
			decision.ObservedAt = at.UTC()
		}
	}
	decision.ExpiresAt = minTime(decision.ExpiresAt, decision.ObservedAt.Add(signal.LiveSignalFreshnessThreshold))
	return nil
}

func prospectiveSinglePhasePower(decision domain.Decision, values map[string]*signal.Value, now time.Time) (float64, time.Time) {
	if decision.CurrentLimit == nil {
		return 0, time.Time{}
	}
	power, powerAt, powerOK := freshNumeric(values["ACChargingPower"], now, 1, 500000)
	voltage, voltsAt, voltsOK := freshNumeric(values["ChargerVoltage"], now, 80, 300)
	_, phasesAt, phaseOK := freshNumeric(values["ChargerPhases"], now, 1, 1)
	request, requestAt, requestOK := freshNumeric(values["ChargeCurrentRequest"], now, 1, 1000)
	if !powerOK || !voltsOK || !phaseOK || !requestOK || request != decision.CurrentLimit.RequestedA ||
		power != decision.ChargingPowerW ||
		math.Abs(power/voltage-request) > request*0.15 ||
		absDuration(powerAt.Sub(voltsAt)) > 30*time.Second ||
		absDuration(powerAt.Sub(phasesAt)) > 30*time.Second ||
		absDuration(powerAt.Sub(requestAt)) > 30*time.Second {
		return 0, time.Time{}
	}
	return voltage * decision.CurrentLimit.MaximumA, minTime(voltsAt, phasesAt)
}

func freshNumeric(value *signal.Value, now time.Time, low, high float64) (float64, time.Time, bool) {
	if freshObservation(value, now) {
		if number, ok := signal.Float64(value.Raw); ok && finiteBetween(number, low, high) {
			return number, value.Timestamp, true
		}
	}
	return 0, time.Time{}, false
}
