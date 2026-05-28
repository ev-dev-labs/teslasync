package charging

import (
	"testing"
	"time"
)

func TestChargingSession_Fields(t *testing.T) {
	energy := 45.5
	pct := 20.0
	cs := ChargingSession{
		VehicleID:          1,
		StartedAt:          time.Now(),
		TotalEnergyAddedWh: &energy,
		StartSocPct:        &pct,
	}
	if cs.TotalEnergyAddedWh == nil || *cs.TotalEnergyAddedWh != 45.5 {
		t.Errorf("expected energy added 45.5, got %v", cs.TotalEnergyAddedWh)
	}
	if cs.StartSocPct == nil || *cs.StartSocPct != 20 {
		t.Errorf("expected start battery 20, got %v", cs.StartSocPct)
	}
	if !cs.IsActive() {
		t.Errorf("expected session with nil EndedAt to be active")
	}
}
