package smartreadinesssvc

import (
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func currentLimitEvidence(
	values map[string]*signal.Value, now time.Time,
) (*domain.ChargingCurrentLimit, time.Time) {
	ac := values["ACChargingPower"]
	if !freshObservation(ac, now) {
		return nil, time.Time{}
	}
	acPower, ok := signal.Float64(ac.Raw)
	if !ok || !finiteBetween(acPower, 0, 500000) || acPower == 0 {
		return nil, time.Time{}
	}
	if dc := values["DCChargingPower"]; freshObservation(dc, now) {
		dcPower, valid := signal.Float64(dc.Raw)
		if !valid || !finiteBetween(dcPower, 0, 500000) || dcPower > 0 {
			return nil, time.Time{}
		}
	}
	requested, maximum := values["ChargeCurrentRequest"], values["ChargeCurrentRequestMax"]
	if !freshObservation(requested, now) || !freshObservation(maximum, now) ||
		absDuration(requested.Timestamp.Sub(maximum.Timestamp)) > 30*time.Second {
		return nil, time.Time{}
	}
	requestedA, requestedOK := signal.Float64(requested.Raw)
	maximumA, maximumOK := signal.Float64(maximum.Raw)
	if !requestedOK || !maximumOK || !finiteBetween(requestedA, 0, 1000) ||
		!finiteBetween(maximumA, 0, 1000) || requestedA <= 0 || requestedA >= maximumA {
		return nil, time.Time{}
	}
	observedAt := requested.Timestamp
	if maximum.Timestamp.Before(observedAt) {
		observedAt = maximum.Timestamp
	}
	if ac.Timestamp.Before(observedAt) {
		observedAt = ac.Timestamp
	}
	return &domain.ChargingCurrentLimit{RequestedA: requestedA, MaximumA: maximumA}, observedAt
}
