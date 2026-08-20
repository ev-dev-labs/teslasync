package api

import (
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/resilience"
	"github.com/sony/gobreaker"
)

func TestMQTTSystemStatusPrefersWatchdogState(t *testing.T) {
	got := mqttSystemStatus(nil, map[string]*resilience.Component{
		"mqtt": {
			Status:      resilience.StatusDegraded,
			ConsecFails: 4,
			LastError:   "Fleet Telemetry MQTT subscriber is not connected and subscribed",
		},
	})

	if got.Status != "degraded" {
		t.Errorf("status = %q, want degraded", got.Status)
	}
	if got.ConsecFails != 4 {
		t.Errorf("consecutive failures = %d, want 4", got.ConsecFails)
	}
	if got.LastError != "Fleet Telemetry MQTT subscriber is not connected and subscribed" {
		t.Errorf("last error = %q, want subscriber health error", got.LastError)
	}
}

func TestMQTTSystemStatusWithoutWatchdogOrClientIsDisabled(t *testing.T) {
	got := mqttSystemStatus(nil, nil)
	if got.Status != "disabled" {
		t.Errorf("status = %q, want disabled", got.Status)
	}
}

// TestUpstreamBreaker_ResetAt_TracksOpenTransition asserts that the
// observer pins the open timestamp on the first call where the breaker
// transitions into the "open" state, and computes breaker_reset_at as
// openedAt + timeout.
func TestUpstreamBreaker_ResetAt_TracksOpenTransition(t *testing.T) {
	o := &teslaBreakerObserver{}
	now := time.Date(2026, 5, 3, 12, 0, 0, 0, time.UTC)
	timeout := 60 * time.Second

	// First seen state is "closed" — no reset target.
	if got := o.observe("closed", now, timeout); !got.IsZero() {
		t.Errorf("closed → reset = %v, want zero", got)
	}

	// Transition open at t+5s — reset should be t+5s+timeout.
	openedAt := now.Add(5 * time.Second)
	got := o.observe(gobreaker.StateOpen.String(), openedAt, timeout)
	want := openedAt.Add(timeout)
	if !got.Equal(want) {
		t.Errorf("open → reset = %v, want %v", got, want)
	}

	// A second observe while still open MUST keep the original
	// openedAt — i.e. the reset target does not slide forward on every
	// poll (otherwise the SPA's countdown would never finish).
	later := openedAt.Add(7 * time.Second)
	got2 := o.observe(gobreaker.StateOpen.String(), later, timeout)
	if !got2.Equal(want) {
		t.Errorf("open (2nd observe) → reset = %v, want %v (must not slide)", got2, want)
	}
}

func TestUpstreamBreaker_ResetAt_ZeroWhenClosedOrHalfOpen(t *testing.T) {
	o := &teslaBreakerObserver{}
	now := time.Now()
	timeout := 60 * time.Second

	if got := o.observe(gobreaker.StateClosed.String(), now, timeout); !got.IsZero() {
		t.Errorf("closed → reset = %v, want zero", got)
	}
	if got := o.observe(gobreaker.StateHalfOpen.String(), now, timeout); !got.IsZero() {
		t.Errorf("half-open → reset = %v, want zero", got)
	}
}

func TestUpstreamBreaker_ResetAt_ResetsAfterClose(t *testing.T) {
	// open → closed → open should pick up the SECOND open's timestamp,
	// not the first — otherwise a transient flap would leave a stale
	// breaker_reset_at hanging around.
	o := &teslaBreakerObserver{}
	timeout := 60 * time.Second

	t0 := time.Date(2026, 5, 3, 12, 0, 0, 0, time.UTC)
	o.observe(gobreaker.StateOpen.String(), t0, timeout)

	// Transition back to closed at t0+30s.
	o.observe(gobreaker.StateClosed.String(), t0.Add(30*time.Second), timeout)

	// Re-open at t0+90s — reset should be t0+90s+timeout, not t0+timeout.
	t1 := t0.Add(90 * time.Second)
	got := o.observe(gobreaker.StateOpen.String(), t1, timeout)
	want := t1.Add(timeout)
	if !got.Equal(want) {
		t.Errorf("re-open → reset = %v, want %v (must reset on each fresh open)", got, want)
	}
}

func TestUpstreamBreaker_ResetAt_RespectsCustomTimeout(t *testing.T) {
	// The handler hard-codes 60s but the observer takes the timeout as
	// a parameter so tests (and any future per-upstream tuning) can
	// exercise alternate windows.
	o := &teslaBreakerObserver{}
	now := time.Date(2026, 5, 3, 12, 0, 0, 0, time.UTC)
	got := o.observe(gobreaker.StateOpen.String(), now, 30*time.Second)
	want := now.Add(30 * time.Second)
	if !got.Equal(want) {
		t.Errorf("custom timeout → reset = %v, want %v", got, want)
	}
}
