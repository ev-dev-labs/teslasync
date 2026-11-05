package chargingsvc

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

func TestApplySessionFactsPricing(t *testing.T) {
	energy, invoice, stored := 20000.0, 8.5, 6.0
	currency := "USD"
	tests := []struct {
		name       string
		source     string
		cost       *float64
		energy     *float64
		rate       float64
		invoice    *float64
		want       *float64
		wantSource string
	}{
		{"configured rate", "", nil, &energy, 0.0003, nil, &stored, "default_estimate"},
		{"unknown rate", "", nil, &energy, 0, nil, nil, ""},
		{"unknown energy", "", nil, nil, 0.0003, nil, nil, ""},
		{"invoice replaces estimate", "default_estimate", &stored, &energy, 0.0003, &invoice, &invoice, "tesla_actual"},
		{"invoice replaces tariff", "geofence_tariff", &stored, &energy, 0.0003, &invoice, &invoice, "tesla_actual"},
		{"manual cost protected", "manual", &stored, &energy, 0.0003, &invoice, &stored, "manual"},
		{"historical provenance protected", "", &stored, &energy, 0.0003, &invoice, &stored, ""},
		{"tariff protected from default", "geofence_tariff", &stored, &energy, 0.001, nil, &stored, "geofence_tariff"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			session := &chargingmodel.ChargingSession{TotalEnergyAddedWh: tt.energy, CostDecimal: tt.cost}
			if tt.source != "" {
				session.CostSource = &tt.source
			}
			ApplySessionFacts(session, charging.SessionFacts{
				DefaultRatePerWh: tt.rate, InvoiceCost: tt.invoice, InvoiceCurrency: &currency,
			})
			if (session.CostDecimal == nil) != (tt.want == nil) ||
				(session.CostDecimal != nil && *session.CostDecimal != *tt.want) {
				t.Fatalf("cost = %v, want %v", session.CostDecimal, tt.want)
			}
			source := ""
			if session.CostSource != nil {
				source = *session.CostSource
			}
			if source != tt.wantSource {
				t.Fatalf("source = %q, want %q", source, tt.wantSource)
			}
		})
	}
}

func TestObserveChargerRetainsSessionEvidenceAfterPowerStops(t *testing.T) {
	var evidence charging.ChargerEvidence
	ObserveCharger(&evidence, map[string]any{"FastChargerType": "Supercharger", "DCChargingPower": 150000.0})
	ObserveCharger(&evidence, map[string]any{"FastChargerType": "Unknown", "DCChargingPower": 0.0})
	if got := charging.ClassifyCharger(evidence); got != "Supercharger" {
		t.Fatalf("stopped charger classified as %q", got)
	}

}

func TestObserveChargerIgnoresDisconnectedFastChargerFieldsDuringAC(t *testing.T) {
	var evidence charging.ChargerEvidence
	ObserveCharger(&evidence, map[string]any{
		"FastChargerPresent": false, "ACChargingPower": 7000.0,
		"FastChargerType": "Supercharger", "DCChargingPower": 150000.0,
	})
	if got := charging.ClassifyCharger(evidence); got != "AC" {
		t.Fatalf("current AC session inherited disconnected charger: %q", got)
	}
}

func TestApplySessionFactsUsesMeasuredAverageAndInvoiceIdentity(t *testing.T) {
	start := time.Date(2026, 10, 25, 21, 59, 0, 0, time.UTC)
	end, energy, ac := start.Add(20*time.Minute), 25780.0, "AC"
	session := &chargingmodel.ChargingSession{
		StartedAt: start, EndedAt: &end, TotalEnergyAddedWh: &energy, ChargerType: &ac,
	}
	ApplySessionFacts(session, charging.SessionFacts{})
	if session.ChargerType == nil || *session.ChargerType != "DC" {
		t.Fatal("measured energy over twenty minutes cannot remain AC")
	}
	ApplySessionFacts(session, charging.SessionFacts{InvoiceSite: "Bothell Supercharger"})
	if session.ChargerType == nil || *session.ChargerType != "Supercharger" || session.CostDecimal != nil {
		t.Fatal("matched invoice identity should classify without inventing a missing price")
	}
}
