package drive

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDrivingStatsUnavailablePool(t *testing.T) {
	for _, repo := range []*DriveRepo{nil, {}, NewDriveRepo(nil)} {
		if _, err := repo.GetStats(context.Background(), 1); err == nil {
			t.Fatal("missing database must return an error, not fabricated measurements")
		}
	}
}

func TestDrivingStatsRangeQueryUsesAllCompletedDrives(t *testing.T) {
	start := time.Date(2024, 3, 10, 15, 42, 19, 125000000, time.UTC)
	end := start.Add(24 * time.Hour)
	for _, tc := range []struct {
		name       string
		start, end time.Time
		suffix     string
		args       []any
	}{
		{"unbounded", time.Time{}, time.Time{}, "", []any{int64(42)}},
		{"both_exact_bounds", start, end, " AND started_at >= $2 AND started_at < $3", []any{int64(42), start, end}},
		{"lower_only", start, time.Time{}, " AND started_at >= $2", []any{int64(42), start}},
		{"upper_only", time.Time{}, end, " AND started_at < $2", []any{int64(42), end}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			query, args := drivingStatsQuery(42, tc.start, tc.end)
			if query != drivingStatsSQL+tc.suffix || !reflect.DeepEqual(args, tc.args) {
				t.Fatalf("query=%s args=%v want suffix=%s args=%v", query, args, tc.suffix, tc.args)
			}
			for _, forbidden := range []string{"LIMIT", "OFFSET", "ended_at >=", "ended_at <", "started_at <="} {
				if strings.Contains(query, forbidden) {
					t.Errorf("full completed-drive aggregate must not contain %q", forbidden)
				}
			}
			if !strings.Contains(query, "COUNT(*)") || !strings.Contains(query, "ended_at IS NOT NULL") {
				t.Fatal("range query must retain the full completed-drive aggregate")
			}
		})
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
