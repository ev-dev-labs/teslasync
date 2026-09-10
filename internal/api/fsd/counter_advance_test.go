package fsd

import (
	"testing"
	"time"
)

func TestRestoreDelta(t *testing.T) {
	t.Parallel()

	if _, ok := restoreDelta(7_900_000, 7_900_000); !ok {
		t.Fatal("snap-back to the pre-reset reading must be a restore")
	}
	got, ok := restoreDelta(7_900_000, 7_901_000)
	if !ok || got != 1_000 {
		t.Fatalf("restore excess = (%v, %v), want (1000, true)", got, ok)
	}
	if _, ok := restoreDelta(9_000, 100); ok {
		t.Fatal("real post-reset climb must not look like a restore")
	}
	if _, ok := restoreDelta(0, 5_000); ok {
		t.Fatal("a zero baseline is not a restore")
	}
}

func TestPlausibleCounterAdvance(t *testing.T) {
	t.Parallel()

	if !plausibleCounterAdvance(80, 24*time.Hour) {
		t.Fatal("80 m over a day must be attributable")
	}
	if plausibleCounterAdvance(4_913*1609.344, 2*time.Second) {
		t.Fatal("thousands of miles in two seconds must be rejected")
	}
	if !plausibleCounterAdvance(16, time.Millisecond) {
		t.Fatal("a sub-second 0.01 mile tick must still pass the floor")
	}
}

func TestStepTripMeterSpuriousZero(t *testing.T) {
	t.Parallel()

	var cur tripMeterCursor
	reset := stepTripMeter(7_900_000, 0, time.Second, "2026-03-01", &cur)
	if !reset.Reset || cur.preReset == nil {
		t.Fatalf("drop to 0: %+v cursor=%+v", reset, cur)
	}
	restore := stepTripMeter(0, 7_901_000, time.Second, "2026-03-01", &cur)
	if !restore.Restored || restore.Delta != 1_000 || restore.UndoResetDay != "2026-03-01" {
		t.Fatalf("restore: %+v", restore)
	}
	if cur.preReset != nil {
		t.Fatal("cursor must clear after restore")
	}
}
