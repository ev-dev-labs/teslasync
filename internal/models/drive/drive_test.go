package drive

import (
	"testing"
	"time"
)

func TestDrive_Fields(t *testing.T) {
	start := time.Now()
	endTs := start.Add(30 * time.Minute)
	d := Drive{
		VehicleID: 1,
		StartTs:   start,
		EndTs:     &endTs,
		DistanceM: 41036.4,
		DurationS: 1800,
	}
	if d.DistanceM != 41036.4 {
		t.Errorf("expected distance 41036.4, got %f", d.DistanceM)
	}
	if d.DurationS != 1800 {
		t.Errorf("expected duration 1800, got %d", d.DurationS)
	}
}
