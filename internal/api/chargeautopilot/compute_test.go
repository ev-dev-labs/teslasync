package chargeautopilot

import (
	"testing"
	"time"
)

func testProfile() Profile {
	return Profile{
		VehicleID:          7,
		Enabled:            true,
		TargetSOC:          90,
		ReadyBy:            "07:30",
		RatePlan:           "pge-ev2a",
		DailyCapSOC:        80,
		TripOverride:       false,
		Precondition:       true,
		MaxAmps:            32,
		BatteryCapacityKWh: 75,
	}
}

func TestEffectiveTargetCapsWithoutOverride(t *testing.T) {
	got, capped := EffectiveTarget(90, 80, false)
	if got != 80 || !capped {
		t.Fatalf("got (%d, %v), want (80, true)", got, capped)
	}
}

func TestEffectiveTargetPassesThroughWithOverride(t *testing.T) {
	got, capped := EffectiveTarget(90, 80, true)
	if got != 90 || capped {
		t.Fatalf("got (%d, %v), want (90, false)", got, capped)
	}
}

func TestValidateProfileRejectsBadReadyBy(t *testing.T) {
	p := testProfile()
	p.ReadyBy = "25:99"
	if err := ValidateProfile(p); err == nil {
		t.Fatal("expected error for bad ready_by")
	}
}

func TestValidateProfileRejectsUnknownPlan(t *testing.T) {
	p := testProfile()
	p.RatePlan = "nope"
	if err := ValidateProfile(p); err == nil {
		t.Fatal("expected error for unknown rate plan")
	}
}

func TestNextReadyByRollsToTomorrow(t *testing.T) {
	now := time.Date(2026, 3, 10, 8, 0, 0, 0, time.UTC)
	next, err := NextReadyBy("07:30", now)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 3, 11, 7, 30, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("got %v, want %v", next, want)
	}
}

func TestPreviewFindsOffPeakWindow(t *testing.T) {
	now := time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC) // winter, on-peak evening
	res, err := Preview(PreviewInput{Profile: testProfile(), CurrentSOC: 40, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if res.EffectiveTargetSOC != 80 {
		t.Fatalf("effective target = %d, want 80 (health cap)", res.EffectiveTargetSOC)
	}
	if !res.CappedByHealth {
		t.Fatal("expected health guardrail to engage")
	}
	if res.Window.RateTier == "ON_PEAK" {
		t.Fatalf("expected off-peak window, got %+v", res.Window)
	}
	if res.Savings < 0 {
		t.Fatalf("savings should not be negative, got %v", res.Savings)
	}
	if res.Explanation == "" {
		t.Fatal("expected a human-readable explanation")
	}
}

func TestPreviewErrorsWhenAlreadyAtTarget(t *testing.T) {
	now := time.Date(2026, 1, 15, 18, 0, 0, 0, time.UTC)
	_, err := Preview(PreviewInput{Profile: testProfile(), CurrentSOC: 85, Now: now})
	if err == nil {
		t.Fatal("expected already-at-target error")
	}
}

func TestPreviewHonorsTripOverride(t *testing.T) {
	p := testProfile()
	p.TripOverride = true
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	res, err := Preview(PreviewInput{Profile: p, CurrentSOC: 40, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if res.EffectiveTargetSOC != 90 || res.CappedByHealth {
		t.Fatalf("override should keep 90 uncapped, got %+v", res)
	}
}
