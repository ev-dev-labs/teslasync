package drive

import (
	"testing"
	"time"
)

func TestSessionFSMEventTimeControlsLifecycleTimestamps(t *testing.T) {
	start := time.Date(2026, 8, 22, 9, 0, 0, 0, time.UTC)
	end := start.Add(35 * time.Minute)
	m := NewSessionFSMAt(7, "VIN", 11, start)

	if got := m.Context().StartTime; !got.Equal(start) {
		t.Fatalf("StartTime = %v, want %v", got, start)
	}
	m.TriggerEndingAt(nil, end)
	if got := m.Context().EndTime; !got.Equal(end) {
		t.Fatalf("EndTime = %v, want %v", got, end)
	}
}

func TestPending_AllStartFieldsPresent_TransitionsToActive(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 100)
	m.ProcessSignals(map[string]interface{}{
		"Odometer":     26535.0,
		"BatteryLevel": 86,
		"Latitude":     47.82,
		"Longitude":    -122.31,
	})
	if m.State() != Active {
		t.Fatalf("expected Active, got %s", m.State())
	}
}

func TestPending_MissingOdometer_StaysPending(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 100)
	m.ProcessSignals(map[string]interface{}{
		"BatteryLevel": 86,
		"Latitude":     47.82,
		"Longitude":    -122.31,
	})
	if m.State() != Pending {
		t.Fatalf("expected Pending (no odometer), got %s", m.State())
	}
}

func TestPending_MissingBattery_StaysPending(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 100)
	m.ProcessSignals(map[string]interface{}{
		"Odometer":  26535.0,
		"Latitude":  47.82,
		"Longitude": -122.31,
	})
	if m.State() != Pending {
		t.Fatalf("expected Pending (no battery), got %s", m.State())
	}
}

func TestPending_MissingLocation_StaysPending(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 100)
	m.ProcessSignals(map[string]interface{}{
		"Odometer":     26535.0,
		"BatteryLevel": 86,
	})
	if m.State() != Pending {
		t.Fatalf("expected Pending (no location), got %s", m.State())
	}
}

func TestPending_FieldsAcrossMultipleBatches_TransitionsToActive(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 100)
	m.ProcessSignals(map[string]interface{}{"Odometer": 26535.0})
	if m.State() != Pending {
		t.Fatal("should still be Pending")
	}
	m.ProcessSignals(map[string]interface{}{"BatteryLevel": 86})
	if m.State() != Pending {
		t.Fatal("should still be Pending")
	}
	m.ProcessSignals(map[string]interface{}{"Latitude": 47.82, "Longitude": -122.31})
	if m.State() != Active {
		t.Fatalf("expected Active after all fields, got %s", m.State())
	}
}

func TestActive_AccumulatesSpeed(t *testing.T) {
	m := newActiveFSM()
	m.ProcessSignals(map[string]interface{}{"VehicleSpeed": 35.0})
	m.ProcessSignals(map[string]interface{}{"VehicleSpeed": 65.0})
	m.ProcessSignals(map[string]interface{}{"VehicleSpeed": 50.0})
	ctx := m.Context()
	if ctx.MaxSpeed != 65.0 {
		t.Fatalf("expected MaxSpeed 65, got %f", ctx.MaxSpeed)
	}
	if ctx.SpeedSamples != 3 {
		t.Fatalf("expected 3 samples, got %d", ctx.SpeedSamples)
	}
	if ctx.AvgSpeed() != 50.0 {
		t.Fatalf("expected avg 50, got %f", ctx.AvgSpeed())
	}
}

func TestActive_UpdatesEndOdometerContinuously(t *testing.T) {
	m := newActiveFSM()
	m.ProcessSignals(map[string]interface{}{"Odometer": 26537.0})
	m.ProcessSignals(map[string]interface{}{"Odometer": 26540.0})
	ctx := m.Context()
	if ctx.EndOdometer != 26540.0 {
		t.Fatalf("expected EndOdometer 26540, got %f", ctx.EndOdometer)
	}
}

func TestActive_TriggerEnding_TransitionsToEnding(t *testing.T) {
	m := newActiveFSM()
	m.TriggerEnding(nil)
	if m.State() != Ending {
		t.Fatalf("expected Ending, got %s", m.State())
	}
}

func TestActive_TriggerEnding_WithEndSnapshot_TransitionsToCompleted(t *testing.T) {
	m := newActiveFSM()
	m.TriggerEnding(map[string]interface{}{
		"Odometer":     26542.0,
		"BatteryLevel": 83,
		"Latitude":     47.83,
		"Longitude":    -122.29,
	})
	if m.State() != Completed {
		t.Fatalf("expected Completed (end snapshot ready), got %s", m.State())
	}
}

func TestEnding_EndFieldsPresent_TransitionsToCompleted(t *testing.T) {
	m := newEndingFSM()
	m.ProcessSignals(map[string]interface{}{
		"Odometer":     26542.0,
		"BatteryLevel": 83,
		"Latitude":     47.83,
		"Longitude":    -122.29,
	})
	if m.State() != Completed {
		t.Fatalf("expected Completed, got %s", m.State())
	}
}

func TestEnding_MissingEndOdometer_StaysEnding(t *testing.T) {
	m := newEndingFSM()
	m.ProcessSignals(map[string]interface{}{
		"BatteryLevel": 83,
		"Latitude":     47.83,
		"Longitude":    -122.29,
	})
	if m.State() != Ending {
		t.Fatalf("expected Ending (no odometer), got %s", m.State())
	}
}

func TestEnding_EndOdoLessThanStart_StaysEnding(t *testing.T) {
	m := newEndingFSM()
	m.ProcessSignals(map[string]interface{}{
		"Odometer":     26530.0, // less than start (26535)
		"BatteryLevel": 83,
		"Latitude":     47.83,
		"Longitude":    -122.29,
	})
	if m.State() != Ending {
		t.Fatalf("expected Ending (end odo < start), got %s", m.State())
	}
}

func TestCompleted_CalculatesDistance(t *testing.T) {
	m := newCompletedFSM()
	ctx := m.Context()
	d := ctx.Distance()
	if d < 6.0 || d > 8.0 {
		t.Fatalf("expected distance 6-8 mi, got %f", d)
	}
}

func TestCompleted_CalculatesDuration(t *testing.T) {
	m := newCompletedFSM()
	ctx := m.Context()
	dur := ctx.Duration()
	if dur < 1*time.Second {
		t.Fatalf("expected positive duration, got %s", dur)
	}
}

func TestRecovered_SignalsFlowing_TransitionsToActive(t *testing.T) {
	m := NewSessionFSM(1, "VIN001", 100)
	m.RecoverFrom(26535.0, 86, 47.82, -122.31, time.Now().UTC().Add(-10*time.Minute))
	if m.State() != Recovered {
		t.Fatalf("expected Recovered, got %s", m.State())
	}
	m.ProcessSignals(map[string]interface{}{"VehicleSpeed": 35.0})
	if m.State() != Active {
		t.Fatalf("expected Active after signal, got %s", m.State())
	}
}

func TestForceComplete(t *testing.T) {
	m := newActiveFSM()
	m.ForceComplete()
	if m.State() != Completed {
		t.Fatalf("expected Completed, got %s", m.State())
	}
}

// ─── Validation ──────────────────────────────────────────

func TestValidation_NegativeDistance_Flagged(t *testing.T) {
	ctx := &Context{StartOdometer: 100, EndOdometer: 99, StartBattery: 80, EndBattery: 78,
		StartTime: time.Now().Add(-time.Hour), EndTime: time.Now()}
	issues := Validate(ctx)
	assertContains(t, issues, "distance <= 0")
}

func TestValidation_Distance500Miles_Flagged(t *testing.T) {
	ctx := &Context{StartOdometer: 100, EndOdometer: 700, StartBattery: 80, EndBattery: 10,
		StartTime: time.Now().Add(-time.Hour), EndTime: time.Now()}
	issues := Validate(ctx)
	assertContains(t, issues, "distance > 500 miles")
}

func TestValidation_NegativeNetEnergy_Flagged(t *testing.T) {
	ctx := &Context{StartOdometer: 100, EndOdometer: 110, TotalEnergy: 10, RegenEnergy: 500,
		StartBattery: 80, EndBattery: 78, StartTime: time.Now().Add(-time.Hour), EndTime: time.Now()}
	issues := Validate(ctx)
	assertContains(t, issues, "net energy negative")
}

func TestValidation_EndBatteryHigherThanStart_Flagged(t *testing.T) {
	ctx := &Context{StartOdometer: 100, EndOdometer: 110, StartBattery: 50, EndBattery: 80,
		StartTime: time.Now().Add(-time.Hour), EndTime: time.Now()}
	issues := Validate(ctx)
	assertContains(t, issues, "end battery > start battery")
}

func TestValidation_AllGood_NoIssues(t *testing.T) {
	ctx := &Context{
		StartOdometer: 26535, EndOdometer: 26542,
		StartBattery: 86, EndBattery: 83,
		TotalEnergy: 2000, RegenEnergy: 200,
		StartTime: time.Now().Add(-20 * time.Minute), EndTime: time.Now(),
	}
	issues := Validate(ctx)
	if len(issues) != 0 {
		t.Fatalf("expected no issues, got %v", issues)
	}
}

func TestValidation_Efficiency9WhPerMile_Flagged(t *testing.T) {
	// Real production bug — Drive #24 showed 9 Wh/mi
	ctx := &Context{
		StartOdometer: 26535, EndOdometer: 26536,
		StartBattery: 86, EndBattery: 86,
		TotalEnergy: 11, RegenEnergy: 0,
		StartTime: time.Now().Add(-6 * time.Minute), EndTime: time.Now(),
	}
	issues := Validate(ctx)
	assertContains(t, issues, "efficiency outside 100-600 Wh/mi range")
}

// ─── Helpers ─────────────────────────────────────────────

func newActiveFSM() *SessionFSM {
	m := NewSessionFSM(1, "VIN001", 100)
	m.ProcessSignals(map[string]interface{}{
		"Odometer": 26535.0, "BatteryLevel": 86,
		"Latitude": 47.82, "Longitude": -122.31,
	})
	return m
}

func newEndingFSM() *SessionFSM {
	m := newActiveFSM()
	m.TriggerEnding(nil)
	return m
}

func newCompletedFSM() *SessionFSM {
	m := newActiveFSM()
	// Set a realistic start time in the past
	m.mu.Lock()
	m.ctx.StartTime = time.Now().UTC().Add(-20 * time.Minute)
	m.mu.Unlock()
	m.ProcessSignals(map[string]interface{}{"Odometer": 26541.0, "VehicleSpeed": 45.0})
	m.TriggerEnding(map[string]interface{}{
		"Odometer": 26542.0, "BatteryLevel": 83,
		"Latitude": 47.83, "Longitude": -122.29,
	})
	return m
}

func assertContains(t *testing.T, issues []string, substr string) {
	t.Helper()
	for _, iss := range issues {
		if len(iss) >= len(substr) && contains(iss, substr) {
			return
		}
	}
	t.Fatalf("expected issue containing %q in %v", substr, issues)
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
