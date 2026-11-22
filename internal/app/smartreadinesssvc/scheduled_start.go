package smartreadinesssvc

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func scheduledStartZone(start *domain.ScheduledStart) *time.Location {
	if start == nil || start.TimeZone == "" || start.TimeZone == "Local" || len(start.TimeZone) > 64 {
		return nil
	}
	zone, err := time.LoadLocation(start.TimeZone)
	if err != nil {
		return nil
	}
	return zone
}

func validScheduledStart(start *domain.ScheduledStart, plan Plan) bool {
	if scheduledStartZone(start) == nil {
		return false
	}
	if start.PowerCeilingW != nil && !finiteBetween(*start.PowerCeilingW, 1, 500000) {
		return false
	}
	return !start.At.Before(plan.NotifyAt) && !start.At.After(plan.DepartureAt.Add(24*time.Hour))
}

func pendingStartProjection(plan Plan, values map[string]*signal.Value, now time.Time, battery float64) (float64, time.Time, bool) {
	start := plan.ScheduledStart
	zone := scheduledStartZone(start)
	if zone == nil || !start.At.After(now) || start.At.Sub(now) > 24*time.Hour {
		return 0, time.Time{}, false
	}
	remaining := plan.DepartureAt.Sub(start.At)
	observedAt := now
	var capacityWh float64
	if remaining > 0 {
		capacity := values["NominalFullPackEnergyKwh"]
		if start.PowerCeilingW == nil || !finiteBetween(*start.PowerCeilingW, 1, 500000) || !freshObservation(capacity, now) {
			return 0, time.Time{}, false
		}
		var ok bool
		capacityWh, ok = signal.Float64(capacity.Raw)
		if !ok || !finiteBetween(capacityWh, 1, 500000) {
			return 0, time.Time{}, false
		}
		observedAt = capacity.Timestamp
	}
	clock := values["ScheduledChargingStartTime"]
	pending := values["ScheduledChargingPending"]
	latch := values["ChargePortLatch"]
	for _, value := range []*signal.Value{clock, pending, latch} {
		if !freshObservation(value, now) {
			return 0, time.Time{}, false
		}
		if value.Timestamp.Before(observedAt) {
			observedAt = value.Timestamp
		}
	}
	if enabled, ok := pending.Raw.(bool); !ok || !enabled {
		return 0, time.Time{}, false
	}
	latchRaw, ok := latch.Raw.(string)
	state, err := protomodel.ParseChargePortLatchValue(latchRaw)
	if !ok || err != nil || state != protomodel.ChargePortLatchValue_ChargePortLatchEngaged {
		return 0, time.Time{}, false
	}
	for _, name := range []string{"ACChargingPower", "DCChargingPower"} {
		power := values[name]
		if !freshObservation(power, now) {
			continue
		}
		if watts, ok := signal.Float64(power.Raw); !ok || watts != 0 {
			return 0, time.Time{}, false
		}
	}
	wall, ok := clock.Raw.(time.Time)
	intended := start.At.In(zone)
	// The codec's date is only an anchor. The user supplies the date; Tesla corroborates only the wall clock.
	if !ok || wall.IsZero() || wall.Hour() != intended.Hour() || wall.Minute() != intended.Minute() {
		return 0, time.Time{}, false
	}
	if remaining > 0 {
		// Use a best-case estimate: even uninterrupted charging at the entered limit must fall short.
		battery = math.Min(100, battery+*start.PowerCeilingW*remaining.Hours()/capacityWh*100)
	}
	return battery, observedAt, true
}
