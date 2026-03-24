package resilience

import (
	"testing"
)

func TestOverallStatusSkipsUnknown(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("database")
	hm.Register("tesla_api")
	hm.Register("worker")

	// All unknown with no checks — should be healthy
	if status := hm.OverallStatus(); status != StatusHealthy {
		t.Errorf("OverallStatus() with all unknown = %v, want healthy", status)
	}

	// Mark one healthy
	hm.RecordSuccess("database")
	if status := hm.OverallStatus(); status != StatusHealthy {
		t.Errorf("OverallStatus() with one healthy, rest unknown = %v, want healthy", status)
	}

	// Mark one as degraded (needs >= 3 consecutive failures)
	hm.RecordFailure("tesla_api", nil)
	hm.RecordFailure("tesla_api", nil)
	hm.RecordFailure("tesla_api", nil)
	if status := hm.OverallStatus(); status != StatusDegraded {
		t.Errorf("OverallStatus() with one degraded = %v, want degraded", status)
	}
}

func TestOverallStatusHealthyWhenAllHealthy(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("database")
	hm.Register("mqtt")

	hm.RecordSuccess("database")
	hm.RecordSuccess("mqtt")

	if status := hm.OverallStatus(); status != StatusHealthy {
		t.Errorf("OverallStatus() = %v, want healthy", status)
	}
}

func TestIsDegradedReturnsFalseWhenAllUnknown(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("a")
	hm.Register("b")

	if hm.IsDegraded() {
		t.Error("IsDegraded() should be false when all components are unchecked")
	}
}

func TestRecordSuccessResetsFailures(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.RecordFailure("db", nil)
	hm.RecordFailure("db", nil)
	hm.RecordSuccess("db")

	status := hm.GetStatus()
	if status["db"].ConsecFails != 0 {
		t.Errorf("ConsecFails after success = %d, want 0", status["db"].ConsecFails)
	}
	if status["db"].Status != StatusHealthy {
		t.Errorf("Status after success = %v, want healthy", status["db"].Status)
	}
}

func TestComponentStatusString(t *testing.T) {
	tests := []struct {
		s    ComponentStatus
		want string
	}{
		{StatusHealthy, "healthy"},
		{StatusDegraded, "degraded"},
		{StatusUnhealthy, "unhealthy"},
		{StatusUnknown, "unknown"},
		{ComponentStatus(99), "unknown"},
	}
	for _, tt := range tests {
		if got := tt.s.String(); got != tt.want {
			t.Errorf("%d.String() = %q, want %q", tt.s, got, tt.want)
		}
	}
}

func TestGetHealthHistory(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.RecordSuccess("db")

	history := hm.GetHealthHistory()
	if len(history) != 1 {
		t.Errorf("GetHealthHistory() returned %d snapshots, want 1", len(history))
	}
	if history[0].Components["db"] != StatusHealthy {
		t.Errorf("history[0].Components[db] = %v, want healthy", history[0].Components["db"])
	}
}

func TestGetStatusReturnsCopy(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.RecordSuccess("db")

	status1 := hm.GetStatus()
	status1["db"].ConsecFails = 999

	status2 := hm.GetStatus()
	if status2["db"].ConsecFails == 999 {
		t.Error("GetStatus() should return a copy, not a reference")
	}
}

func TestDefaultRetryConfigValues(t *testing.T) {
	cfg := DefaultRetryConfig()
	if cfg.MaxAttempts != 5 {
		t.Errorf("MaxAttempts = %d, want 5", cfg.MaxAttempts)
	}
	if cfg.Multiplier != 2.0 {
		t.Errorf("Multiplier = %f, want 2.0", cfg.Multiplier)
	}
}
