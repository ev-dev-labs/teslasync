package sciencesvc

import (
	"math"
	"testing"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

func TestThroughputNeverSubstitutesZeroForUnknownSessions(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(24 * time.Hour)
	ended := from.Add(time.Hour)
	energy := 15000.0
	valid := chargingmodel.ChargingSession{StartedAt: from, EndedAt: &ended, TotalEnergyAddedWh: &energy}
	for _, tc := range []struct {
		name   string
		mutate func(*chargingmodel.ChargingSession)
	}{
		{"missing energy", func(c *chargingmodel.ChargingSession) { c.TotalEnergyAddedWh = nil }},
		{"ongoing", func(c *chargingmodel.ChargingSession) { c.EndedAt = nil }},
		{"overlaps start", func(c *chargingmodel.ChargingSession) { c.StartedAt = from.Add(-time.Hour) }},
		{"overlaps end", func(c *chargingmodel.ChargingSession) { later := to.Add(time.Hour); c.EndedAt = &later }},
		{"invalid energy", func(c *chargingmodel.ChargingSession) { nan := math.NaN(); c.TotalEnergyAddedWh = &nan }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad := valid
			tc.mutate(&bad)
			report := buildElectrochem(1, "", from, to, nil, []*chargingmodel.ChargingSession{&valid, &bad}, false)
			if report.Aging.ThroughputWh != nil || report.Aging.EquivFullCycles != nil {
				t.Fatal("partial session evidence became a complete exposure")
			}
		})
	}
	for _, truncated := range []bool{false, true} {
		report := buildElectrochem(1, "", from, to, nil, []*chargingmodel.ChargingSession{&valid}, truncated)
		if truncated {
			if report.Aging.ThroughputWh != nil {
				t.Fatal("capped report must not claim full throughput")
			}
		} else if report.Aging.ThroughputWh == nil || *report.Aging.ThroughputWh != energy ||
			report.Aging.EquivFullCycles == nil || *report.Aging.EquivFullCycles != 0.2 {
			t.Fatalf("qualified session energy lost: %+v", report.Aging)
		}
	}
	report := buildElectrochem(1, "", from, to, nil, nil, false)
	if report.Aging.ThroughputWh != nil {
		t.Fatal("no session evidence must not manufacture zero throughput")
	}
}
