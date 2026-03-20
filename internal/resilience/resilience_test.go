package resilience

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestNewHealthMonitor(t *testing.T) {
	hm := NewHealthMonitor()
	if hm == nil {
		t.Fatal("NewHealthMonitor() returned nil")
	}

	status := hm.GetStatus()
	if len(status) != 0 {
		t.Errorf("new monitor should have 0 components, got %d", len(status))
	}
}

func TestRegisterAndGetStatus(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("database")
	hm.Register("mqtt")

	status := hm.GetStatus()
	if len(status) != 2 {
		t.Fatalf("expected 2 components, got %d", len(status))
	}

	db, ok := status["database"]
	if !ok {
		t.Fatal("database component not found")
	}
	if db.Status != StatusUnknown {
		t.Errorf("initial status = %v, want StatusUnknown", db.Status)
	}
	if db.Name != "database" {
		t.Errorf("Name = %q, want %q", db.Name, "database")
	}
}

func TestRecordSuccessUpdatesStatus(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("database")

	hm.RecordSuccess("database")
	status := hm.GetStatus()
	db := status["database"]

	if db.Status != StatusHealthy {
		t.Errorf("status = %v, want StatusHealthy", db.Status)
	}
	if db.ConsecFails != 0 {
		t.Errorf("ConsecFails = %d, want 0", db.ConsecFails)
	}
	if db.TotalChecks != 1 {
		t.Errorf("TotalChecks = %d, want 1", db.TotalChecks)
	}
	if db.LastError != "" {
		t.Errorf("LastError = %q, want empty", db.LastError)
	}
}

func TestRecordFailureDegradedAndUnhealthy(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("api")

	testErr := errors.New("connection refused")

	// 1 failure: no threshold hit yet, stays at initial/unknown-ish state
	hm.RecordFailure("api", testErr)
	s := hm.GetStatus()["api"]
	if s.ConsecFails != 1 {
		t.Errorf("after 1 fail: ConsecFails = %d, want 1", s.ConsecFails)
	}

	// 2 failures: should become degraded
	hm.RecordFailure("api", testErr)
	s = hm.GetStatus()["api"]
	if s.Status != StatusDegraded {
		t.Errorf("after 2 fails: status = %v, want StatusDegraded", s.Status)
	}

	// 5 failures: should become unhealthy
	for i := 0; i < 3; i++ {
		hm.RecordFailure("api", testErr)
	}
	s = hm.GetStatus()["api"]
	if s.Status != StatusUnhealthy {
		t.Errorf("after 5 fails: status = %v, want StatusUnhealthy", s.Status)
	}
	if s.TotalFailures != 5 {
		t.Errorf("TotalFailures = %d, want 5", s.TotalFailures)
	}
	if s.LastError != "connection refused" {
		t.Errorf("LastError = %q, want %q", s.LastError, "connection refused")
	}
}

func TestRecordSuccessResetsFailures(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")

	hm.RecordFailure("db", errors.New("fail"))
	hm.RecordFailure("db", errors.New("fail"))
	s := hm.GetStatus()["db"]
	if s.ConsecFails != 2 {
		t.Fatalf("ConsecFails = %d, want 2", s.ConsecFails)
	}

	hm.RecordSuccess("db")
	s = hm.GetStatus()["db"]
	if s.ConsecFails != 0 {
		t.Errorf("ConsecFails after success = %d, want 0", s.ConsecFails)
	}
	if s.Status != StatusHealthy {
		t.Errorf("Status after success = %v, want StatusHealthy", s.Status)
	}
}

func TestRecordFailureUnregisteredComponent(t *testing.T) {
	hm := NewHealthMonitor()
	// Should not panic
	hm.RecordFailure("nonexistent", errors.New("fail"))
	hm.RecordSuccess("nonexistent")
}

func TestOverallStatus(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("a")
	hm.Register("b")

	hm.RecordSuccess("a")
	hm.RecordSuccess("b")
	if hm.OverallStatus() != StatusHealthy {
		t.Errorf("OverallStatus = %v, want StatusHealthy", hm.OverallStatus())
	}

	// Make one degraded
	hm.RecordFailure("b", errors.New("err"))
	hm.RecordFailure("b", errors.New("err"))
	if hm.OverallStatus() != StatusDegraded {
		t.Errorf("OverallStatus = %v, want StatusDegraded", hm.OverallStatus())
	}

	// Make one unhealthy
	for i := 0; i < 5; i++ {
		hm.RecordFailure("b", errors.New("err"))
	}
	if hm.OverallStatus() != StatusUnhealthy {
		t.Errorf("OverallStatus = %v, want StatusUnhealthy", hm.OverallStatus())
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
		t.Error("GetStatus should return copies, not references to internal state")
	}
}

func TestComponentStatusString(t *testing.T) {
	tests := []struct {
		status ComponentStatus
		want   string
	}{
		{StatusHealthy, "healthy"},
		{StatusDegraded, "degraded"},
		{StatusUnhealthy, "unhealthy"},
		{StatusUnknown, "unknown"},
		{ComponentStatus(99), "unknown"},
	}

	for _, tt := range tests {
		got := tt.status.String()
		if got != tt.want {
			t.Errorf("ComponentStatus(%d).String() = %q, want %q", tt.status, got, tt.want)
		}
	}
}

func TestDefaultRetryConfig(t *testing.T) {
	cfg := DefaultRetryConfig()

	if cfg.MaxAttempts != 5 {
		t.Errorf("MaxAttempts = %d, want 5", cfg.MaxAttempts)
	}
	if cfg.InitialWait != 1*time.Second {
		t.Errorf("InitialWait = %v, want 1s", cfg.InitialWait)
	}
	if cfg.MaxWait != 30*time.Second {
		t.Errorf("MaxWait = %v, want 30s", cfg.MaxWait)
	}
	if cfg.Multiplier != 2.0 {
		t.Errorf("Multiplier = %f, want 2.0", cfg.Multiplier)
	}
	if !cfg.Jitter {
		t.Error("Jitter should be true")
	}
}

func TestRetrySucceedsFirstTry(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxAttempts: 3,
		InitialWait: 1 * time.Millisecond,
		MaxWait:     10 * time.Millisecond,
		Multiplier:  2.0,
		Jitter:      false,
	}

	calls := 0
	err := Retry(ctx, "test-op", cfg, func(ctx context.Context) error {
		calls++
		return nil
	})

	if err != nil {
		t.Errorf("Retry() error = %v, want nil", err)
	}
	if calls != 1 {
		t.Errorf("fn called %d times, want 1", calls)
	}
}

func TestRetrySucceedsOnThirdAttempt(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxAttempts: 5,
		InitialWait: 1 * time.Millisecond,
		MaxWait:     10 * time.Millisecond,
		Multiplier:  2.0,
		Jitter:      false,
	}

	calls := 0
	err := Retry(ctx, "test-op", cfg, func(ctx context.Context) error {
		calls++
		if calls < 3 {
			return errors.New("transient error")
		}
		return nil
	})

	if err != nil {
		t.Errorf("Retry() error = %v, want nil", err)
	}
	if calls != 3 {
		t.Errorf("fn called %d times, want 3", calls)
	}
}

func TestRetryExhaustsAllAttempts(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxAttempts: 3,
		InitialWait: 1 * time.Millisecond,
		MaxWait:     10 * time.Millisecond,
		Multiplier:  2.0,
		Jitter:      false,
	}

	calls := 0
	persistentErr := errors.New("persistent failure")
	err := Retry(ctx, "test-op", cfg, func(ctx context.Context) error {
		calls++
		return persistentErr
	})

	if err == nil {
		t.Fatal("Retry() error = nil, want error")
	}
	if calls != 3 {
		t.Errorf("fn called %d times, want 3", calls)
	}
	if !errors.Is(err, persistentErr) {
		t.Errorf("error should wrap persistent failure: %v", err)
	}
}

func TestRetryRespectsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := RetryConfig{
		MaxAttempts: 10,
		InitialWait: 100 * time.Millisecond,
		MaxWait:     1 * time.Second,
		Multiplier:  2.0,
		Jitter:      false,
	}

	calls := 0
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	err := Retry(ctx, "cancel-op", cfg, func(ctx context.Context) error {
		calls++
		return errors.New("fail")
	})

	if err == nil {
		t.Fatal("Retry() should return error on context cancellation")
	}
}

func TestRetryWithResultSuccess(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxAttempts: 3,
		InitialWait: 1 * time.Millisecond,
		MaxWait:     10 * time.Millisecond,
		Multiplier:  2.0,
		Jitter:      false,
	}

	result, err := RetryWithResult(ctx, "test-op", cfg, func(ctx context.Context) (string, error) {
		return "hello", nil
	})

	if err != nil {
		t.Errorf("RetryWithResult() error = %v, want nil", err)
	}
	if result != "hello" {
		t.Errorf("result = %q, want %q", result, "hello")
	}
}

func TestRetryWithResultFailure(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxAttempts: 2,
		InitialWait: 1 * time.Millisecond,
		MaxWait:     10 * time.Millisecond,
		Multiplier:  2.0,
		Jitter:      false,
	}

	result, err := RetryWithResult(ctx, "test-op", cfg, func(ctx context.Context) (int, error) {
		return 0, errors.New("fail")
	})

	if err == nil {
		t.Fatal("RetryWithResult() should return error")
	}
	if result != 0 {
		t.Errorf("result = %d, want zero value", result)
	}
}

func TestRetryWithResultRetriesAndSucceeds(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxAttempts: 5,
		InitialWait: 1 * time.Millisecond,
		MaxWait:     10 * time.Millisecond,
		Multiplier:  2.0,
		Jitter:      false,
	}

	calls := 0
	result, err := RetryWithResult(ctx, "test-op", cfg, func(ctx context.Context) (int, error) {
		calls++
		if calls < 3 {
			return 0, errors.New("not yet")
		}
		return 42, nil
	})

	if err != nil {
		t.Errorf("error = %v, want nil", err)
	}
	if result != 42 {
		t.Errorf("result = %d, want 42", result)
	}
}

func TestSafeGoRecoversPanic(t *testing.T) {
	done := make(chan struct{})
	SafeGo("test-panic", func() {
		defer func() { close(done) }()
		panic("test panic")
	})

	select {
	case <-done:
		// panic was recovered, goroutine completed
	case <-time.After(2 * time.Second):
		t.Fatal("SafeGo did not recover from panic in time")
	}
}

func TestSafeGoNormalExecution(t *testing.T) {
	var result int
	done := make(chan struct{})
	SafeGo("test-normal", func() {
		result = 42
		close(done)
	})

	select {
	case <-done:
		if result != 42 {
			t.Errorf("result = %d, want 42", result)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("SafeGo did not complete in time")
	}
}

func TestSafeGoLoopRestartsOnPanic(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var mu sync.Mutex
	calls := 0

	SafeGoLoop(ctx, "test-loop", func(ctx context.Context) {
		mu.Lock()
		calls++
		c := calls
		mu.Unlock()

		if c <= 2 {
			panic("intentional panic")
		}
		// After 2 panics, block until context is done
		<-ctx.Done()
	})

	// Wait for at least 3 calls (2 panics + 1 successful start)
	deadline := time.After(10 * time.Second)
	for {
		mu.Lock()
		c := calls
		mu.Unlock()
		if c >= 3 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("SafeGoLoop only called %d times, want >= 3", c)
		case <-time.After(100 * time.Millisecond):
		}
	}
	cancel()
}

func TestSafeGoLoopStopsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	started := make(chan struct{}, 1)
	SafeGoLoop(ctx, "test-stop", func(ctx context.Context) {
		select {
		case started <- struct{}{}:
		default:
		}
		<-ctx.Done()
	})

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("loop did not start")
	}

	cancel()
	// Just verify no deadlock or panic
	time.Sleep(100 * time.Millisecond)
}

func TestConnectWithRetry(t *testing.T) {
	ctx := context.Background()
	calls := 0
	err := ConnectWithRetry(ctx, "test-connect", 3, func(ctx context.Context) error {
		calls++
		if calls < 2 {
			return errors.New("not ready")
		}
		return nil
	})

	if err != nil {
		t.Errorf("ConnectWithRetry() error = %v, want nil", err)
	}
	if calls != 2 {
		t.Errorf("fn called %d times, want 2", calls)
	}
}

func TestHealthMonitorConcurrentAccess(t *testing.T) {
	hm := NewHealthMonitor()
	hm.Register("db")
	hm.Register("api")

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if i%2 == 0 {
				hm.RecordSuccess("db")
			} else {
				hm.RecordFailure("api", errors.New("err"))
			}
			hm.GetStatus()
			hm.OverallStatus()
		}(i)
	}
	wg.Wait()
}
