package resilience

import (
	"errors"
	"testing"
)

func TestNewHealthMonitor(t *testing.T) {
	hm := NewHealthMonitor()
	if hm == nil {
		t.Fatal("expected non-nil HealthMonitor")
	}
	status := hm.GetStatus()
	if len(status) != 0 {
		t.Errorf("expected empty status map, got %d entries", len(status))
	}
}

func TestHealthMonitor_Register(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("database")

	status := hm.GetStatus()
	comp, ok := status["database"]
	if !ok {
		t.Fatal("expected 'database' component to be registered")
	}
	if comp.Name != "database" {
		t.Errorf("expected component name 'database', got '%s'", comp.Name)
	}
	if comp.Status != StatusUnknown {
		t.Errorf("expected initial status Unknown, got '%s'", comp.Status)
	}
}

func TestHealthMonitor_RecordSuccess(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("database")
	hm.RecordSuccess("database")

	status := hm.GetStatus()
	comp := status["database"]
	if comp.Status != StatusHealthy {
		t.Errorf("expected status Healthy after success, got '%s'", comp.Status)
	}
	if comp.ConsecFails != 0 {
		t.Errorf("expected 0 consecutive failures, got %d", comp.ConsecFails)
	}
	if comp.TotalChecks != 1 {
		t.Errorf("expected 1 total check, got %d", comp.TotalChecks)
	}
}

func TestHealthMonitor_RecordFailure_Degraded(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("api")

	hm.RecordFailure("api", errors.New("timeout"))
	hm.RecordFailure("api", errors.New("timeout"))
	hm.RecordFailure("api", errors.New("timeout"))

	status := hm.GetStatus()
	comp := status["api"]
	if comp.Status != StatusDegraded {
		t.Errorf("expected status Degraded after 3 failures, got '%s'", comp.Status)
	}
	if comp.ConsecFails != 3 {
		t.Errorf("expected 3 consecutive failures, got %d", comp.ConsecFails)
	}
}

func TestHealthMonitor_RecordFailure_Unhealthy(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("mqtt")

	for i := 0; i < 10; i++ {
		hm.RecordFailure("mqtt", errors.New("connection refused"))
	}

	status := hm.GetStatus()
	comp := status["mqtt"]
	if comp.Status != StatusUnhealthy {
		t.Errorf("expected status Unhealthy after 10 failures, got '%s'", comp.Status)
	}
	if comp.TotalFailures != 10 {
		t.Errorf("expected 10 total failures, got %d", comp.TotalFailures)
	}
}

func TestHealthMonitor_SuccessResetsFailures(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("redis")

	hm.RecordFailure("redis", errors.New("error"))
	hm.RecordFailure("redis", errors.New("error"))
	hm.RecordSuccess("redis")

	status := hm.GetStatus()
	comp := status["redis"]
	if comp.Status != StatusHealthy {
		t.Errorf("expected status Healthy after recovery, got '%s'", comp.Status)
	}
	if comp.ConsecFails != 0 {
		t.Errorf("expected 0 consecutive failures after success, got %d", comp.ConsecFails)
	}
}

func TestHealthMonitor_OverallStatus(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.Register("api")

	hm.RecordSuccess("db")
	hm.RecordSuccess("api")

	if hm.OverallStatus() != StatusHealthy {
		t.Errorf("expected overall Healthy, got '%s'", hm.OverallStatus())
	}

	// Degrade one component
	hm.RecordFailure("api", errors.New("err"))
	hm.RecordFailure("api", errors.New("err"))
	hm.RecordFailure("api", errors.New("err"))

	if hm.OverallStatus() != StatusDegraded {
		t.Errorf("expected overall Degraded, got '%s'", hm.OverallStatus())
	}
}

func TestComponentStatus_String(t *testing.T) {
	tests := []struct {
		status   ComponentStatus
		expected string
	}{
		{StatusHealthy, "healthy"},
		{StatusDegraded, "degraded"},
		{StatusUnhealthy, "unhealthy"},
		{StatusUnknown, "unknown"},
	}
	for _, tt := range tests {
		if got := tt.status.String(); got != tt.expected {
			t.Errorf("ComponentStatus(%d).String() = %q, want %q", tt.status, got, tt.expected)
		}
	}
}

func TestDefaultRetryConfig(t *testing.T) {
	cfg := DefaultRetryConfig()
	if cfg.MaxAttempts != 5 {
		t.Errorf("expected 5 max attempts, got %d", cfg.MaxAttempts)
	}
	if cfg.Multiplier != 2.0 {
		t.Errorf("expected multiplier 2.0, got %f", cfg.Multiplier)
	}
	if !cfg.Jitter {
		t.Error("expected jitter to be enabled by default")
	}
}
