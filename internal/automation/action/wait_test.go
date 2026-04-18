package action

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"
)

// --- ParseWaitConfig Tests ---

func TestParseWaitConfig(t *testing.T) {
	tests := []struct {
		name        string
		input       json.RawMessage
		wantSeconds int
		wantErr     string
	}{
		{
			name:        "valid with type",
			input:       json.RawMessage(`{"type":"wait","duration_seconds":10}`),
			wantSeconds: 10,
		},
		{
			name:        "valid without type",
			input:       json.RawMessage(`{"duration_seconds":30}`),
			wantSeconds: 30,
		},
		{
			name:        "valid at max",
			input:       json.RawMessage(fmt.Sprintf(`{"type":"wait","duration_seconds":%d}`, MaxWaitSeconds)),
			wantSeconds: MaxWaitSeconds,
		},
		{
			name:        "valid 1 second",
			input:       json.RawMessage(`{"duration_seconds":1}`),
			wantSeconds: 1,
		},
		{
			name:    "empty config",
			input:   json.RawMessage(``),
			wantErr: "action config is empty",
		},
		{
			name:    "invalid JSON",
			input:   json.RawMessage(`{broken`),
			wantErr: "unmarshal wait action config",
		},
		{
			name:    "wrong type",
			input:   json.RawMessage(`{"type":"command","duration_seconds":10}`),
			wantErr: `expected type "wait"`,
		},
		{
			name:    "zero duration",
			input:   json.RawMessage(`{"type":"wait","duration_seconds":0}`),
			wantErr: "duration_seconds must be positive",
		},
		{
			name:    "negative duration",
			input:   json.RawMessage(`{"type":"wait","duration_seconds":-5}`),
			wantErr: "duration_seconds must be positive",
		},
		{
			name:    "exceeds max",
			input:   json.RawMessage(fmt.Sprintf(`{"type":"wait","duration_seconds":%d}`, MaxWaitSeconds+1)),
			wantErr: "exceeds maximum",
		},
		{
			name:    "missing duration_seconds",
			input:   json.RawMessage(`{"type":"wait"}`),
			wantErr: "duration_seconds must be positive",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := ParseWaitConfig(tt.input)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error %q does not contain %q", err.Error(), tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.DurationSeconds != tt.wantSeconds {
				t.Errorf("duration_seconds = %d, want %d", cfg.DurationSeconds, tt.wantSeconds)
			}
		})
	}
}

// --- Execute Tests ---

func TestWaitExecute_Success(t *testing.T) {
	exec := NewWaitExecutor()
	// Override sleep to avoid real delays in tests.
	exec.sleepFunc = func(_ context.Context, _ time.Duration) error {
		return nil
	}

	raw := json.RawMessage(`{"type":"wait","duration_seconds":5}`)
	resultJSON, err := exec.Execute(context.Background(), nil, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var result WaitResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}

	if result.RequestedSeconds != 5 {
		t.Errorf("requested_seconds = %d, want 5", result.RequestedSeconds)
	}
	if result.Cancelled {
		t.Error("expected cancelled=false")
	}
}

func TestWaitExecute_IgnoresVehicleID(t *testing.T) {
	exec := NewWaitExecutor()
	exec.sleepFunc = func(_ context.Context, _ time.Duration) error {
		return nil
	}

	vid := int64(42)
	raw := json.RawMessage(`{"type":"wait","duration_seconds":2}`)
	resultJSON, err := exec.Execute(context.Background(), &vid, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var result WaitResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}

	if result.RequestedSeconds != 2 {
		t.Errorf("requested_seconds = %d, want 2", result.RequestedSeconds)
	}
}

func TestWaitExecute_ContextCancelled(t *testing.T) {
	exec := NewWaitExecutor()
	exec.sleepFunc = func(ctx context.Context, _ time.Duration) error {
		return ctx.Err()
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	raw := json.RawMessage(`{"type":"wait","duration_seconds":60}`)
	resultJSON, err := exec.Execute(ctx, nil, raw)

	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "wait cancelled") {
		t.Errorf("error %q should contain 'wait cancelled'", err.Error())
	}

	// Result should still be returned with cancellation info.
	if resultJSON == nil {
		t.Fatal("expected result JSON even on cancellation")
	}
	var result WaitResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if !result.Cancelled {
		t.Error("expected cancelled=true")
	}
	if result.CancelReason == "" {
		t.Error("expected cancel_reason to be set")
	}
}

func TestWaitExecute_InvalidConfig(t *testing.T) {
	exec := NewWaitExecutor()

	tests := []struct {
		name    string
		raw     json.RawMessage
		wantErr string
	}{
		{
			name:    "empty config",
			raw:     json.RawMessage(``),
			wantErr: "invalid wait action config",
		},
		{
			name:    "zero duration",
			raw:     json.RawMessage(`{"type":"wait","duration_seconds":0}`),
			wantErr: "invalid wait action config",
		},
		{
			name:    "exceeds max",
			raw:     json.RawMessage(fmt.Sprintf(`{"type":"wait","duration_seconds":%d}`, MaxWaitSeconds+1)),
			wantErr: "invalid wait action config",
		},
		{
			name:    "wrong type",
			raw:     json.RawMessage(`{"type":"command","duration_seconds":10}`),
			wantErr: "invalid wait action config",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := exec.Execute(context.Background(), nil, tt.raw)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestWaitExecute_SleepDurationPassedCorrectly(t *testing.T) {
	exec := NewWaitExecutor()

	var receivedDuration time.Duration
	exec.sleepFunc = func(_ context.Context, d time.Duration) error {
		receivedDuration = d
		return nil
	}

	raw := json.RawMessage(`{"type":"wait","duration_seconds":42}`)
	_, err := exec.Execute(context.Background(), nil, raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := 42 * time.Second
	if receivedDuration != expected {
		t.Errorf("sleep duration = %v, want %v", receivedDuration, expected)
	}
}

func TestWaitExecute_RealSleep(t *testing.T) {
	// Verify the real sleep mechanism works with a very short duration.
	exec := NewWaitExecutor()

	raw := json.RawMessage(`{"type":"wait","duration_seconds":1}`)
	start := time.Now()
	resultJSON, err := exec.Execute(context.Background(), nil, raw)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should have waited at least ~1 second.
	if elapsed < 900*time.Millisecond {
		t.Errorf("elapsed %v is shorter than expected 1s wait", elapsed)
	}

	var result WaitResult
	if err := json.Unmarshal(resultJSON, &result); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if result.WaitedMs < 900 {
		t.Errorf("waited_ms = %d, expected >= 900", result.WaitedMs)
	}
}

func TestWaitExecute_RealSleepCancellation(t *testing.T) {
	// Verify context cancellation interrupts a real sleep.
	exec := NewWaitExecutor()

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	raw := json.RawMessage(`{"type":"wait","duration_seconds":60}`)
	start := time.Now()
	_, err := exec.Execute(ctx, nil, raw)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("expected cancellation error")
	}
	if !strings.Contains(err.Error(), "wait cancelled") {
		t.Errorf("error %q should contain 'wait cancelled'", err.Error())
	}
	// Should have been cancelled well before 60 seconds.
	if elapsed > 2*time.Second {
		t.Errorf("elapsed %v is too long — cancellation didn't work", elapsed)
	}
}

// --- Interface Compliance ---

func TestWaitExecutor_ImplementsActionExecutor(t *testing.T) {
	var _ ActionExecutor = (*WaitExecutor)(nil)
}
