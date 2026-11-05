package charging

import (
	"math"
	"testing"
)

func TestClassifyCharger(t *testing.T) {
	tests := []struct {
		name     string
		evidence ChargerEvidence
		want     string
	}{
		{"supercharger stopped", ChargerEvidence{FastChargerTypes: []string{"Supercharger"}, DCPowerW: 0}, "Supercharger"},
		{"third party DC", ChargerEvidence{FastChargerTypes: []string{"Combo"}, FastPresent: true}, "DC"},
		{"home AC", ChargerEvidence{ACPowerW: 7200, Phases: 1, VoltageV: 240, Place: "Home"}, "AC"},
		{"public AC", ChargerEvidence{Phases: 3, VoltageV: 230, Place: "Public car park"}, "AC"},
		{"missing flags high power", ChargerEvidence{AveragePowerW: 78720}, "DC"},
		{"missing everything", ChargerEvidence{}, ""},
		{"home cannot override DC", ChargerEvidence{PeakPowerW: 50000, RecordedType: "Home AC", Place: "Home"}, "DC"},
		{"Tesla location supports DC", ChargerEvidence{AveragePowerW: 78720, Place: "Bothell Supercharger"}, "Supercharger"},
		{"street address is not a brand", ChargerEvidence{AveragePowerW: 78720, Place: "20911 Bothell Everett Highway"}, "DC"},
		{"location cannot invent charging evidence", ChargerEvidence{Place: "Home"}, ""},
		{"Tesla brand on AC", ChargerEvidence{Brand: "Tesla", ACPowerW: 7200}, "AC"},
		{"vehicle AC overrides stored DC", ChargerEvidence{ACPowerW: 7200, RecordedType: "DC"}, "AC"},
		{"AC fast charger enum", ChargerEvidence{FastChargerTypes: []string{"ACSingleWireCAN"}}, "AC"},
		{"unknown enums", ChargerEvidence{FastChargerTypes: []string{"Unknown", "SNA"}}, ""},
		{"invalid power", ChargerEvidence{PeakPowerW: math.Inf(1), AveragePowerW: math.NaN()}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ClassifyCharger(tt.evidence); got != tt.want {
				t.Fatalf("ClassifyCharger() = %q, want %q", got, tt.want)
			}
		})
	}
}
