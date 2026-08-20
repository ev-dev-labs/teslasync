package worker

import (
	"testing"
	"time"
)

func TestRecordVehicleFailureExponentialBackoff(t *testing.T) {
	w := &Worker{
		vehicleHealth: make(map[int64]*vehicleHealth),
	}

	vehicleID := int64(1)

	// First failure: 30s backoff
	w.recordVehicleFailure(vehicleID)
	vh := w.vehicleHealth[vehicleID]
	if vh.consecFails != 1 {
		t.Errorf("consecFails = %d, want 1", vh.consecFails)
	}
	expectedBackoff := 30 * time.Second
	actualBackoff := time.Until(vh.backoffUntil)
	if actualBackoff > expectedBackoff+time.Second || actualBackoff < expectedBackoff-time.Second {
		t.Errorf("first backoff ≈ %v, want ≈ %v", actualBackoff.Round(time.Second), expectedBackoff)
	}

	// Second failure: 60s backoff
	w.recordVehicleFailure(vehicleID)
	if vh.consecFails != 2 {
		t.Errorf("consecFails = %d, want 2", vh.consecFails)
	}
	expectedBackoff = 60 * time.Second
	actualBackoff = time.Until(vh.backoffUntil)
	if actualBackoff > expectedBackoff+time.Second || actualBackoff < expectedBackoff-2*time.Second {
		t.Errorf("second backoff ≈ %v, want ≈ %v", actualBackoff.Round(time.Second), expectedBackoff)
	}

	// Third failure: 120s backoff
	w.recordVehicleFailure(vehicleID)
	if vh.consecFails != 3 {
		t.Errorf("consecFails = %d, want 3", vh.consecFails)
	}
	expectedBackoff = 120 * time.Second
	actualBackoff = time.Until(vh.backoffUntil)
	if actualBackoff > expectedBackoff+time.Second || actualBackoff < expectedBackoff-2*time.Second {
		t.Errorf("third backoff ≈ %v, want ≈ %v", actualBackoff.Round(time.Second), expectedBackoff)
	}
}

func TestRecordVehicleFailureMaxBackoff(t *testing.T) {
	w := &Worker{
		vehicleHealth: make(map[int64]*vehicleHealth),
	}

	vehicleID := int64(2)

	// Accumulate many failures to hit the max cap
	for i := 0; i < 20; i++ {
		w.recordVehicleFailure(vehicleID)
	}

	vh := w.vehicleHealth[vehicleID]
	maxBackoff := 5 * time.Minute
	actualBackoff := time.Until(vh.backoffUntil)
	if actualBackoff > maxBackoff+time.Second {
		t.Errorf("backoff = %v, should be capped at %v", actualBackoff.Round(time.Second), maxBackoff)
	}
}

func TestRecordVehicleSuccessResetsBackoff(t *testing.T) {
	w := &Worker{
		vehicleHealth: make(map[int64]*vehicleHealth),
	}

	vehicleID := int64(3)

	// Accumulate failures
	w.recordVehicleFailure(vehicleID)
	w.recordVehicleFailure(vehicleID)
	w.recordVehicleFailure(vehicleID)

	vh := w.vehicleHealth[vehicleID]
	if vh.consecFails != 3 {
		t.Fatalf("consecFails = %d, want 3", vh.consecFails)
	}

	// Reset
	w.recordVehicleSuccess(vehicleID)

	if vh.consecFails != 0 {
		t.Errorf("consecFails after success = %d, want 0", vh.consecFails)
	}
	if !vh.backoffUntil.IsZero() {
		t.Errorf("backoffUntil should be zero after success, got %v", vh.backoffUntil)
	}
}

func TestRecordVehicleSuccessNoOpForUnknown(t *testing.T) {
	w := &Worker{
		vehicleHealth: make(map[int64]*vehicleHealth),
	}

	// Should not panic when vehicle is not tracked
	w.recordVehicleSuccess(999)
}

func TestRecordVehicleFailureCreatesEntry(t *testing.T) {
	w := &Worker{
		vehicleHealth: make(map[int64]*vehicleHealth),
	}

	vehicleID := int64(10)

	if _, exists := w.vehicleHealth[vehicleID]; exists {
		t.Fatal("vehicle should not exist yet")
	}

	w.recordVehicleFailure(vehicleID)

	vh, exists := w.vehicleHealth[vehicleID]
	if !exists {
		t.Fatal("vehicle health entry should have been created")
	}
	if vh.consecFails != 1 {
		t.Errorf("consecFails = %d, want 1", vh.consecFails)
	}
	if vh.lastError.IsZero() {
		t.Error("lastError time should be set")
	}
}

func TestBackoffProgression(t *testing.T) {
	// Verify the progression: 30s, 60s, 120s, 240s, 300s (max), 300s...
	w := &Worker{
		vehicleHealth: make(map[int64]*vehicleHealth),
	}
	vehicleID := int64(5)

	// The formula is: 30 << (consecFails-1) seconds
	expectedDurations := []time.Duration{
		30 * time.Second,  // 30 << 0
		60 * time.Second,  // 30 << 1
		120 * time.Second, // 30 << 2
		240 * time.Second, // 30 << 3
		5 * time.Minute,   // capped at 300s
		5 * time.Minute,   // still capped
	}

	for i, expected := range expectedDurations {
		before := time.Now()
		w.recordVehicleFailure(vehicleID)
		vh := w.vehicleHealth[vehicleID]

		actual := vh.backoffUntil.Sub(before)
		tolerance := 100 * time.Millisecond

		if actual < expected-tolerance || actual > expected+tolerance {
			t.Errorf("failure %d: backoff = %v, want ≈ %v", i+1, actual.Round(time.Millisecond), expected)
		}
	}
}

func TestMultipleVehiclesIndependentBackoff(t *testing.T) {
	w := &Worker{
		vehicleHealth: make(map[int64]*vehicleHealth),
	}

	// Vehicle 1 gets 3 failures
	w.recordVehicleFailure(1)
	w.recordVehicleFailure(1)
	w.recordVehicleFailure(1)

	// Vehicle 2 gets 1 failure
	w.recordVehicleFailure(2)

	vh1 := w.vehicleHealth[int64(1)]
	vh2 := w.vehicleHealth[int64(2)]

	if vh1.consecFails != 3 {
		t.Errorf("vehicle 1 consecFails = %d, want 3", vh1.consecFails)
	}
	if vh2.consecFails != 1 {
		t.Errorf("vehicle 2 consecFails = %d, want 1", vh2.consecFails)
	}

	// Vehicle 1 success resets only vehicle 1
	w.recordVehicleSuccess(1)
	if vh1.consecFails != 0 {
		t.Errorf("vehicle 1 after success: consecFails = %d, want 0", vh1.consecFails)
	}
	if vh2.consecFails != 1 {
		t.Errorf("vehicle 2 should be unaffected: consecFails = %d, want 1", vh2.consecFails)
	}
}

func TestHealthSnapshot_NilWorker(t *testing.T) {
	var w *Worker
	tracked, degraded := w.HealthSnapshot(3)
	if tracked != 0 || degraded != 0 {
		t.Errorf("HealthSnapshot on nil *Worker = (%d, %d), want (0, 0)", tracked, degraded)
	}
}

func TestHealthSnapshot_NoTrackedVehicles(t *testing.T) {
	// A fresh install (or a fleet fully covered by Fleet Telemetry
	// streaming, so the worker never polls anyone) has an empty
	// vehicleHealth map — tracked must be 0 so the caller skips the
	// health check entirely rather than reporting success or failure.
	w := &Worker{vehicleHealth: make(map[int64]*vehicleHealth)}
	tracked, degraded := w.HealthSnapshot(3)
	if tracked != 0 || degraded != 0 {
		t.Errorf("HealthSnapshot on empty map = (%d, %d), want (0, 0)", tracked, degraded)
	}
}

func TestHealthSnapshot_OneFlakyVehicleDoesNotDegradeWhole(t *testing.T) {
	w := &Worker{vehicleHealth: make(map[int64]*vehicleHealth)}
	w.recordVehicleFailure(1)
	w.recordVehicleFailure(1)
	w.recordVehicleFailure(1)             // consecFails=3, at the degraded threshold
	w.vehicleHealth[2] = &vehicleHealth{} // vehicle 2 is tracked and healthy (0 fails)

	tracked, degraded := w.HealthSnapshot(3)
	if tracked != 2 {
		t.Errorf("tracked = %d, want 2", tracked)
	}
	if degraded != 1 {
		t.Errorf("degraded = %d, want 1 (only vehicle 1 crossed the threshold)", degraded)
	}
}

func TestHealthSnapshot_AllVehiclesDegraded(t *testing.T) {
	w := &Worker{vehicleHealth: make(map[int64]*vehicleHealth)}
	w.recordVehicleFailure(1)
	w.recordVehicleFailure(1)
	w.recordVehicleFailure(1)
	w.recordVehicleFailure(2)
	w.recordVehicleFailure(2)
	w.recordVehicleFailure(2)

	tracked, degraded := w.HealthSnapshot(3)
	if tracked != 2 || degraded != 2 {
		t.Errorf("HealthSnapshot = (%d, %d), want (2, 2) — every tracked vehicle is degraded", tracked, degraded)
	}
	// Caller contract: degraded == tracked is exactly the "fail the
	// worker component" signal (see internal/app.checkWorkerHealth).
	if degraded != tracked {
		t.Errorf("expected degraded == tracked to signal a fleet-wide worker failure")
	}
}

func TestHealthSnapshot_BelowThresholdNotCountedDegraded(t *testing.T) {
	w := &Worker{vehicleHealth: make(map[int64]*vehicleHealth)}
	w.recordVehicleFailure(1)
	w.recordVehicleFailure(1) // only 2 consecutive fails, below threshold=3

	tracked, degraded := w.HealthSnapshot(3)
	if tracked != 1 {
		t.Errorf("tracked = %d, want 1", tracked)
	}
	if degraded != 0 {
		t.Errorf("degraded = %d, want 0 (below the degraded threshold)", degraded)
	}
}
