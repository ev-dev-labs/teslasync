package smartreadinesssvc

import (
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
	return !start.At.Before(plan.NotifyAt) && !start.At.After(plan.DepartureAt.Add(24*time.Hour))
}

func latePendingStart(plan Plan, values map[string]*signal.Value, now time.Time) (time.Time, bool) {
	start := plan.ScheduledStart
	zone := scheduledStartZone(start)
	if zone == nil || start.At.Before(plan.DepartureAt) || start.At.Sub(now) > 24*time.Hour {
		return time.Time{}, false
	}
	clock := values["ScheduledChargingStartTime"]
	pending := values["ScheduledChargingPending"]
	latch := values["ChargePortLatch"]
	observedAt := now
	for _, value := range []*signal.Value{clock, pending, latch} {
		if !freshObservation(value, now) {
			return time.Time{}, false
		}
		if value.Timestamp.Before(observedAt) {
			observedAt = value.Timestamp
		}
	}
	if enabled, ok := pending.Raw.(bool); !ok || !enabled {
		return time.Time{}, false
	}
	latchRaw, ok := latch.Raw.(string)
	state, err := protomodel.ParseChargePortLatchValue(latchRaw)
	if !ok || err != nil || state != protomodel.ChargePortLatchValue_ChargePortLatchEngaged {
		return time.Time{}, false
	}
	for _, name := range []string{"ACChargingPower", "DCChargingPower"} {
		power := values[name]
		if !freshObservation(power, now) {
			continue
		}
		if watts, ok := signal.Float64(power.Raw); !ok || watts != 0 {
			return time.Time{}, false
		}
	}
	wall, ok := clock.Raw.(time.Time)
	intended := start.At.In(zone)
	// The codec's date is only an anchor. The user supplies the date; Tesla corroborates only the wall clock.
	if !ok || wall.IsZero() || wall.Hour() != intended.Hour() || wall.Minute() != intended.Minute() {
		return time.Time{}, false
	}
	return observedAt, true
}
