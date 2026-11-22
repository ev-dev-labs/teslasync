package smartreadiness

import (
	"math"
	"testing"
	"time"
)

func TestPlanSharedChargerFeasibleOrders(t *testing.T) {
	now := time.Date(2026, 11, 20, 20, 0, 0, 0, time.FixedZone("site", -8*60*60))
	at := func(minutes int) time.Time { return now.Add(time.Duration(minutes) * time.Minute) }
	request := func(id int64, available, departure int, energyWh, powerW float64, plugged bool) SharedChargerRequest {
		return SharedChargerRequest{
			VehicleID: id, AvailableAt: at(available), DepartureAt: at(departure),
			EnergyNeededWh: energyWh, ConservativePowerW: powerW, AlreadyPlugged: plugged,
		}
	}
	slot := func(id int64, start, end int) SharedChargerSlot {
		return SharedChargerSlot{VehicleID: id, StartsAt: at(start).UTC(), EndsAt: at(end).UTC()}
	}

	tests := []struct {
		name          string
		a, b          SharedChargerRequest
		first, second SharedChargerSlot
	}{
		{
			name:   "earlier deadline wins and fractional minutes round up",
			a:      request(9, -15, 210, 6000.5, 6000, false),
			b:      request(1, 75, 240, 1800, 3600, false),
			first:  slot(9, 0, 61),
			second: slot(1, 75, 105),
		},
		{
			name:   "equal deadlines use the lower vehicle ID",
			a:      request(9, 0, 150, 3600, 3600, false),
			b:      request(1, 0, 150, 1800, 3600, false),
			first:  slot(1, 0, 30),
			second: slot(9, 40, 100),
		},
		{
			name:   "plugged vehicle stays first when both orders fit",
			a:      request(9, -15, 150, 3600, 3600, true),
			b:      request(1, 0, 130, 3600, 3600, false),
			first:  slot(9, 0, 60),
			second: slot(1, 70, 130),
		},
		{
			// EDF ends the earlier-departing car at minute 90, then cannot
			// finish the 70-minute charge by minute 130 (it ends at 170).
			name:   "later deadline goes first when EDF wastes early availability",
			a:      request(9, 0, 130, 4200, 3600, false),
			b:      request(1, 60, 115, 1800, 3600, false),
			first:  slot(9, 0, 70),
			second: slot(1, 80, 110),
		},
		{
			name:   "necessary initial changeover gets its own setup time",
			a:      request(9, -15, 150, 3600, 3600, true),
			b:      request(1, 0, 45, 1800, 3600, false),
			first:  slot(1, 10, 40),
			second: slot(9, 50, 110),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			want := SharedChargerSchedule{First: tt.first, Second: tt.second, SwapAt: tt.first.EndsAt}
			for _, inputs := range [][2]SharedChargerRequest{{tt.a, tt.b}, {tt.b, tt.a}} {
				if got := PlanSharedCharger(now, inputs[0], inputs[1]); got == nil || *got != want {
					t.Errorf("first input vehicle %d: schedule = %+v, want %+v", inputs[0].VehicleID, got, want)
				}
			}
		})
	}
}

func TestPlanSharedChargerSuppressesNonContestsAndInfeasibleOrders(t *testing.T) {
	now := time.Date(2026, 11, 21, 4, 0, 0, 0, time.UTC)
	a := SharedChargerRequest{
		VehicleID: 1, AvailableAt: now, EnergyNeededWh: 3600, ConservativePowerW: 3600,
	}
	b := a
	b.VehicleID = 2
	tests := []struct {
		name                           string
		aDeparture, bStart, bDeparture time.Duration
		aPlugged                       bool
	}{
		{
			name:       "adequate windows touch without contest",
			aDeparture: time.Hour,
			bStart:     time.Hour,
			bDeparture: 3 * time.Hour,
		},
		{
			name:       "overlapping windows miss the 10-minute buffer by a nanosecond",
			aDeparture: 130*time.Minute - time.Nanosecond,
			bDeparture: 130*time.Minute - time.Nanosecond,
		},
		{
			name:       "one vehicle cannot finish even alone",
			aDeparture: 59 * time.Minute,
			bDeparture: 4 * time.Hour,
		},
		{
			name:       "initial changeover cannot fit before earlier departure",
			aDeparture: 3 * time.Hour,
			aPlugged:   true,
			bDeparture: 69 * time.Minute,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a, b := a, b
			a.DepartureAt, a.AlreadyPlugged = now.Add(tt.aDeparture), tt.aPlugged
			b.AvailableAt, b.DepartureAt = now.Add(tt.bStart), now.Add(tt.bDeparture)
			if got := PlanSharedCharger(now, a, b); got != nil {
				t.Errorf("schedule = %+v, want silence", got)
			}
		})
	}
}

func TestPlanSharedChargerRejectsInvalidEvidence(t *testing.T) {
	now := time.Date(2026, 11, 21, 4, 0, 0, 0, time.UTC)
	a := SharedChargerRequest{
		VehicleID: 1, AvailableAt: now, DepartureAt: now.Add(3 * time.Hour),
		EnergyNeededWh: 3600, ConservativePowerW: 3600, AlreadyPlugged: true,
	}
	b := a
	b.VehicleID, b.AlreadyPlugged = 2, false

	if got := PlanSharedCharger(time.Time{}, a, b); got != nil {
		t.Errorf("missing evaluation time: schedule = %+v, want silence", got)
	}

	tests := []struct {
		name   string
		change func(*SharedChargerRequest)
	}{
		{"absent vehicle", func(r *SharedChargerRequest) { *r = SharedChargerRequest{} }},
		{"duplicate vehicle ID", func(r *SharedChargerRequest) { r.VehicleID = a.VehicleID }},
		{"negative vehicle ID", func(r *SharedChargerRequest) { r.VehicleID = -1 }},
		{"both vehicles reported plugged", func(r *SharedChargerRequest) { r.AlreadyPlugged = true }},
		{"missing availability", func(r *SharedChargerRequest) { r.AvailableAt = time.Time{} }},
		{"missing departure", func(r *SharedChargerRequest) { r.DepartureAt = time.Time{} }},
		{"departed already", func(r *SharedChargerRequest) { r.DepartureAt = now.Add(-time.Minute) }},
		{"no energy deficit", func(r *SharedChargerRequest) { r.EnergyNeededWh = 0 }},
		{"invalid energy", func(r *SharedChargerRequest) { r.EnergyNeededWh = math.NaN() }},
		{"zero power", func(r *SharedChargerRequest) { r.ConservativePowerW = 0 }},
		{"negative power", func(r *SharedChargerRequest) { r.ConservativePowerW = -3600 }},
		{"infinite power", func(r *SharedChargerRequest) { r.ConservativePowerW = math.Inf(1) }},
		{"duration overflow", func(r *SharedChargerRequest) { r.EnergyNeededWh = math.MaxFloat64 }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			b := b
			tt.change(&b)
			if got := PlanSharedCharger(now, a, b); got != nil {
				t.Errorf("schedule = %+v, want silence", got)
			}
		})
	}
}
