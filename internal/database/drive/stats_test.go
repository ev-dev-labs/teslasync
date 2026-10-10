package drive

import (
	"context"
	"strings"
	"testing"
)

func TestDrivingStatsUnavailablePool(t *testing.T) {
	for _, repo := range []*DriveRepo{nil, {}, NewDriveRepo(nil)} {
		if _, err := repo.GetStats(context.Background(), 1); err == nil {
			t.Fatal("missing database must return an error, not fabricated measurements")
		}
	}
}

func TestDrivingStatsUsesStoredEnergyAndCanonicalUnits(t *testing.T) {
	for _, required := range []string{
		"SUM(distance_m)", "SUM(duration_s)", "energy_used_wh / distance_m",
		"SUM(regen_energy_wh)", "energy_used_wh IS NULL OR regen_energy_wh IS NULL",
		"vehicle_id = $1", "ended_at IS NOT NULL",
	} {
		if !strings.Contains(drivingStatsSQL, required) {
			t.Errorf("statistics query missing %q", required)
		}
	}
	for _, forbidden := range []string{"start_soc_pct", "end_soc_pct", "avg_power_w", "1609", "0.75"} {
		if strings.Contains(drivingStatsSQL, forbidden) {
			t.Errorf("statistics must not infer energy or use imperial factors: %q", forbidden)
		}
	}
}
