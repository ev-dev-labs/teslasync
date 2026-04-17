package notification

import (
	"testing"
	"time"
)

func TestCooldownReset_ArmsForNextFire(t *testing.T) {
	cfg := CooldownConfig{
		CooldownDuration: 15 * time.Minute,
		MaxFiresPerHour:  10,
	}
	cd := NewCooldownFSM(1, 100, cfg)

	// First fire should succeed
	if !cd.ShouldFire() {
		t.Fatal("expected first ShouldFire to return true")
	}
	if cd.State() != Fired {
		t.Fatalf("expected state Fired, got %s", cd.State())
	}

	// Without reset, second fire should be suppressed (within cooldown)
	if cd.ShouldFire() {
		t.Fatal("expected ShouldFire to be suppressed within cooldown")
	}
	if cd.State() != Suppressed {
		t.Fatalf("expected state Suppressed, got %s", cd.State())
	}

	// Reset — simulates condition resolving
	cd.Reset()
	if cd.State() != Armed {
		t.Fatalf("expected state Armed after reset, got %s", cd.State())
	}

	// After reset, fire should succeed immediately
	if !cd.ShouldFire() {
		t.Fatal("expected ShouldFire to return true after reset")
	}
}

func TestCooldownReset_PreservesHourlyLimit(t *testing.T) {
	cfg := CooldownConfig{
		CooldownDuration: 0, // no cooldown delay
		MaxFiresPerHour:  2,
	}
	cd := NewCooldownFSM(1, 100, cfg)

	// Fire twice to exhaust hourly limit
	if !cd.ShouldFire() {
		t.Fatal("expected first fire")
	}
	if !cd.ShouldFire() {
		t.Fatal("expected second fire")
	}

	// Third fire should be suppressed by hourly limit
	if cd.ShouldFire() {
		t.Fatal("expected third fire to be suppressed by hourly limit")
	}

	// Reset clears cooldown but NOT hourly counter
	cd.Reset()
	if cd.State() != Armed {
		t.Fatalf("expected Armed after reset, got %s", cd.State())
	}

	// Should still be suppressed by hourly limit
	if cd.ShouldFire() {
		t.Fatal("expected fire to be suppressed by hourly limit even after reset")
	}
}

func TestCooldownReset_NoOpWhenArmed(t *testing.T) {
	cfg := DefaultCooldownConfig()
	cd := NewCooldownFSM(1, 100, cfg)

	// FSM starts Armed — reset should be a no-op
	if cd.State() != Armed {
		t.Fatalf("expected initial state Armed, got %s", cd.State())
	}

	cd.Reset()

	if cd.State() != Armed {
		t.Fatalf("expected state Armed after no-op reset, got %s", cd.State())
	}

	// Should still fire normally
	if !cd.ShouldFire() {
		t.Fatal("expected ShouldFire after no-op reset")
	}
}
