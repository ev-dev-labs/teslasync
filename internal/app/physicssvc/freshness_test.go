package physicssvc

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestIntegrationInputsRequireKnownRecentEmission(t *testing.T) {
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name string
		at   time.Time
		want bool
	}{
		{"unknown seed", time.Time{}, false},
		{"fresh", now, true},
		{"at freshness boundary", now.Add(-2 * time.Minute), true},
		{"stale", now.Add(-2*time.Minute - time.Nanosecond), false},
		{"future", now.Add(time.Second), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			row := signal.TimelineRow{
				Timestamp: now, Fields: map[string]signal.SignalValue{},
				ObservedAt: map[string]time.Time{},
			}
			for _, key := range []string{"speed", "pack_voltage_v", "pack_current_a", "energy_remaining_wh", "soc_pct", "ac_power_w", "dc_power_w"} {
				row.Fields[key] = 1.0
				row.ObservedAt[key] = tc.at
			}
			s := samplesFromTimeline([]signal.TimelineRow{row})[0]
			for _, value := range []*float64{s.SpeedMps, s.PackVoltageV, s.PackCurrentA, s.EnergyRemainingWh, s.SocPct, s.ACPowerW, s.DCPowerW} {
				if (value != nil) != tc.want {
					t.Fatalf("freshness qualification mismatch: %v", value)
				}
			}
		})
	}
}
