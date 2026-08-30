package charge

import (
	"testing"
	"time"
)

func TestSessionFSMEventTimeControlsLifecycleTimestamps(t *testing.T) {
	start := time.Date(2026, 8, 22, 9, 0, 0, 0, time.UTC)
	end := start.Add(45 * time.Minute)
	m := NewSessionFSMAt(7, "VIN", 11, start)

	if got := m.Context().StartTime; !got.Equal(start) {
		t.Fatalf("StartTime = %v, want %v", got, start)
	}
	m.TriggerEndingAt(nil, false, end)
	if got := m.Context().EndTime; !got.Equal(end) {
		t.Fatalf("EndTime = %v, want %v", got, end)
	}
}

func TestPending_AllStartFieldsPresent_TransitionsToActive(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 200)
	m.ProcessSignals(map[string]interface{}{
		"BatteryLevel": 45,
		"Latitude":     47.82,
		"Longitude":    -122.31,
	})
	if m.State() != Active {
		t.Fatalf("expected Active, got %s", m.State())
	}
}

func TestPending_MissingBattery_StaysPending(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 200)
	m.ProcessSignals(map[string]interface{}{
		"Latitude":  47.82,
		"Longitude": -122.31,
	})
	if m.State() != Pending {
		t.Fatalf("expected Pending, got %s", m.State())
	}
}

func TestPending_MissingLocation_StaysPending(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 200)
	m.ProcessSignals(map[string]interface{}{"BatteryLevel": 45})
	if m.State() != Pending {
		t.Fatalf("expected Pending, got %s", m.State())
	}
}

func TestPending_ChargerInfoCaptured(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 200)
	m.ProcessSignals(map[string]interface{}{
		"BatteryLevel":    45,
		"Latitude":        47.82,
		"Longitude":       -122.31,
		"FastChargerType": "Tesla Supercharger",
		"ChargerPhases":   3,
	})
	ctx := m.Context()
	if ctx.FastChargerType != "Tesla Supercharger" {
		t.Fatalf("expected Tesla Supercharger, got %s", ctx.FastChargerType)
	}
	if ctx.Phases != 3 {
		t.Fatalf("expected 3 phases, got %d", ctx.Phases)
	}
}

func TestActive_AccumulatesEnergy(t *testing.T) {
	m := newActiveFSM()
	m.ProcessSignals(map[string]interface{}{"DCChargingEnergyIn": 5200.0})
	m.ProcessSignals(map[string]interface{}{"DCChargingEnergyIn": 10400.0})
	ctx := m.Context()
	if ctx.EnergyAdded != 10400 {
		t.Fatalf("expected 10400 Wh, got %f", ctx.EnergyAdded)
	}
}

func TestActive_AccumulatesVoltageCurrentPower(t *testing.T) {
	m := newActiveFSM()
	m.ProcessSignals(map[string]interface{}{
		"ChargerVoltage":       240,
		"ChargerActualCurrent": 32,
		"ACChargingPower":      7600.0,
	})
	m.ProcessSignals(map[string]interface{}{
		"ChargerVoltage":       241,
		"ChargerActualCurrent": 31,
		"ACChargingPower":      7400.0,
	})
	ctx := m.Context()
	if ctx.VoltageSamples != 2 {
		t.Fatalf("expected 2 voltage samples, got %d", ctx.VoltageSamples)
	}
	if ctx.MaxVoltage != 241 {
		t.Fatalf("expected max voltage 241, got %d", ctx.MaxVoltage)
	}
	if ctx.PowerSamples != 2 {
		t.Fatalf("expected 2 power samples, got %d", ctx.PowerSamples)
	}
}

func TestActive_UpdatesEndBatteryContinuously(t *testing.T) {
	m := newActiveFSM()
	m.ProcessSignals(map[string]interface{}{"BatteryLevel": 50})
	m.ProcessSignals(map[string]interface{}{"BatteryLevel": 55})
	m.ProcessSignals(map[string]interface{}{"BatteryLevel": 60})
	ctx := m.Context()
	if ctx.EndBattery != 60 {
		t.Fatalf("expected end battery 60, got %d", ctx.EndBattery)
	}
}

func TestActive_ChargeEnded_TransitionsToCompleting(t *testing.T) {
	m := newActiveFSM()
	m.TriggerEnding(nil, false)
	if m.State() != Completing {
		t.Fatalf("expected Completing, got %s", m.State())
	}
}

func TestActive_GearDrive_TransitionsToCompleting(t *testing.T) {
	m := newActiveFSM()
	m.TriggerEnding(nil, true)
	if m.State() != Completing {
		t.Fatalf("expected Completing, got %s", m.State())
	}
}

func TestCompleting_EndFieldsPresent_TransitionsToDone(t *testing.T) {
	m := newCompletingFSM()
	m.ProcessSignals(map[string]interface{}{
		"BatteryLevel":       80,
		"DCChargingEnergyIn": 25000.0,
	})
	if m.State() != Done {
		t.Fatalf("expected Done, got %s", m.State())
	}
}

func TestCompleting_EndBatteryLessThanStart_StaysCompleting(t *testing.T) {
	m := newCompletingFSM()
	m.ProcessSignals(map[string]interface{}{
		"BatteryLevel": 30, // less than start (45)
	})
	if m.State() != Completing {
		t.Fatalf("expected Completing (end < start), got %s", m.State())
	}
}

func TestDone_CalculatesBatteryGain(t *testing.T) {
	m := newDoneFSM()
	ctx := m.Context()
	if ctx.BatteryGain() < 20 {
		t.Fatalf("expected battery gain >= 20, got %d", ctx.BatteryGain())
	}
}

func TestDone_CalculatesDuration(t *testing.T) {
	m := newDoneFSM()
	ctx := m.Context()
	if ctx.Duration() < 1*time.Second {
		t.Fatalf("expected positive duration, got %s", ctx.Duration())
	}
}

func TestRecovered_ChargeStillActive_TransitionsToActive(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 200)
	m.RecoverFrom(45, 47.82, -122.31, time.Now().UTC().Add(-30*time.Minute))
	if m.State() != Recovered {
		t.Fatalf("expected Recovered, got %s", m.State())
	}
	m.ProcessSignals(map[string]interface{}{"DCChargingEnergyIn": 12000.0})
	if m.State() != Active {
		t.Fatalf("expected Active, got %s", m.State())
	}
}

func TestForceComplete(t *testing.T) {
	m := newActiveFSM()
	m.ForceComplete()
	if !m.IsCompleted() {
		t.Fatal("expected completed")
	}
}

func TestValidation_EndBatteryLowerThanStart(t *testing.T) {
	c := &Context{StartBattery: 80, EndBattery: 70, StartTime: time.Now().Add(-time.Hour), EndTime: time.Now()}
	issues := Validate(c)
	assertContains(t, issues, "end battery < start battery")
}

func TestValidation_NoEnergyIn5Min(t *testing.T) {
	c := &Context{StartBattery: 45, EndBattery: 45, EnergyAdded: 0,
		StartTime: time.Now().Add(-10 * time.Minute), EndTime: time.Now()}
	issues := Validate(c)
	assertContains(t, issues, "no energy added")
}

func TestValidation_Energy150kWh(t *testing.T) {
	c := &Context{StartBattery: 10, EndBattery: 100, EnergyAdded: 200_000,
		StartTime: time.Now().Add(-time.Hour), EndTime: time.Now()}
	issues := Validate(c)
	assertContains(t, issues, "energy > 150 kWh")
}

func TestValidation_AllGood(t *testing.T) {
	c := &Context{
		StartBattery: 45, EndBattery: 80, EnergyAdded: 25_000,
		StartTime: time.Now().Add(-45 * time.Minute), EndTime: time.Now(),
	}
	issues := Validate(c)
	if len(issues) != 0 {
		t.Fatalf("expected no issues, got %v", issues)
	}
}

func newActiveFSM() *SessionFSM {
	m := NewSessionFSM(1, "VIN001", 200)
	m.ProcessSignals(map[string]interface{}{
		"BatteryLevel": 45, "Latitude": 47.82, "Longitude": -122.31,
	})
	return m
}

func newCompletingFSM() *SessionFSM {
	m := newActiveFSM()
	m.TriggerEnding(nil, false)
	return m
}

func newDoneFSM() *SessionFSM {
	m := newActiveFSM()
	// Backdate start time so Duration is positive.
	m.mu.Lock()
	m.ctx.StartTime = time.Now().UTC().Add(-45 * time.Minute)
	m.mu.Unlock()
	m.ProcessSignals(map[string]interface{}{"DCChargingEnergyIn": 20000.0, "BatteryLevel": 65})
	m.TriggerEnding(map[string]interface{}{
		"BatteryLevel":       80,
		"DCChargingEnergyIn": 25000.0,
	}, false)
	return m
}

func assertContains(t *testing.T, issues []string, substr string) {
	t.Helper()
	for _, iss := range issues {
		for i := 0; i <= len(iss)-len(substr); i++ {
			if iss[i:i+len(substr)] == substr {
				return
			}
		}
	}
	t.Fatalf("expected issue containing %q in %v", substr, issues)
}
