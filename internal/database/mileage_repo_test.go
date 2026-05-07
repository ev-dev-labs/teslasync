package database

import (
	"strings"
	"testing"
)

// Phase-43a / Prompt 0004 — pure-Go tests for the mileage repo.
//
// These tests pin the SQL-shape constants (column names + filters +
// GROUP BY + ORDER BY) so a regression on the SI-canonical drives
// schema is caught at compile-test time rather than at runtime in
// production. Live SQL execution against PostgreSQL requires
// mig 000185 applied; the codebase has no pgxmock / testcontainers
// harness, and the prompt's escape hatch explicitly accepts pure-Go
// test coverage in that case.

// TestMonthlySelectSQL_Shape pins critical SQL fragments. A typo on
// the SI-canonical column names (distance_m, energy_used_wh) would
// otherwise only surface at runtime — there is no compile-time check
// that the constant matches the real schema.
func TestMonthlySelectSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"FROM drives",
		"vehicle_id = $1",
		"started_at >= $2",
		"date_trunc('month', started_at AT TIME ZONE 'UTC')",
		"GROUP BY bucket",
		"ORDER BY bucket ASC",
		"COUNT(*)",
		"distance_m",
		"energy_used_wh",
		"distance_m IS NOT NULL",
		"distance_m > 0",
		"/ 1000.0",
	}
	for _, frag := range mustContain {
		if !strings.Contains(monthlySelectSQL, frag) {
			t.Errorf("monthlySelectSQL missing %q\nfull SQL:\n%s", frag, monthlySelectSQL)
		}
	}
	mustNotContain := []string{
		// Phase-42 / mig 000185 dropped these legacy column names.
		// Re-introducing them would fail at runtime against the new
		// schema. Decision-#7-aligned regression guard.
		"distance_km",
		"energy_used_kwh",
		// daily_mileage was dropped by Phase-42 prompt 0077.
		"daily_mileage",
		// Decision #1 mandates ASC.
		"ORDER BY bucket DESC",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(monthlySelectSQL, frag) {
			t.Errorf("monthlySelectSQL must not contain %q (Phase-42 / mig 000185 drift or Decision-#1 violation)\nfull SQL:\n%s", frag, monthlySelectSQL)
		}
	}
}

// TestStatsSelectSQL_Shape pins the lifetime + windowed FILTER
// aggregates. Decision #2 hard-locks the four windows (lifetime, 7d,
// 30d, 365d) so the SQL must reference $2/$3/$4 in the documented
// order; reorder a parameter and the handler will compute the wrong
// window for the wrong field at runtime with no compile-time signal.
func TestStatsSelectSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"FROM drives",
		"vehicle_id = $1",
		"FILTER (WHERE started_at >= $2)",  // 7d window
		"FILTER (WHERE started_at >= $3)",  // 30d window (used twice — once for sum, once for count)
		"FILTER (WHERE started_at >= $4)",  // 365d window
		"COALESCE(SUM(distance_m), 0)",
		"distance_m IS NOT NULL AND distance_m > 0",
		"MIN(started_at)",
		"MAX(started_at)",
		"/ 1000.0",
	}
	for _, frag := range mustContain {
		if !strings.Contains(statsSelectSQL, frag) {
			t.Errorf("statsSelectSQL missing %q\nfull SQL:\n%s", frag, statsSelectSQL)
		}
	}
	mustNotContain := []string{
		"distance_km",
		"daily_mileage",
		"energy_used_kwh",
	}
	for _, frag := range mustNotContain {
		if strings.Contains(statsSelectSQL, frag) {
			t.Errorf("statsSelectSQL must not contain %q (Phase-42 / mig 000185 drift)\nfull SQL:\n%s", frag, statsSelectSQL)
		}
	}
	// Defends Decision #2: drive_count_30d uses the same window as
	// last_30d_km — a mistake here would let the 30d sum and the 30d
	// count drift apart.
	if strings.Count(statsSelectSQL, "started_at >= $3") < 2 {
		t.Errorf("statsSelectSQL must reference $3 at least twice (last_30d_km sum + drive_count_30d)\nfull SQL:\n%s", statsSelectSQL)
	}
}

// TestMileageVehicleExistsSQL_Shape pins the EXISTS form so a future
// refactor does not silently change the 404-vs-200 disambiguation
// (e.g. a SELECT ... LIMIT 1 returning rows would Scan into a bool
// differently). Mirrors the precedent in vehicle_states_repo_test.go.
func TestMileageVehicleExistsSQL_Shape(t *testing.T) {
	t.Parallel()
	for _, frag := range []string{"EXISTS", "FROM vehicles", "id = $1"} {
		if !strings.Contains(mileageVehicleExistsSQL, frag) {
			t.Errorf("mileageVehicleExistsSQL missing %q\nfull SQL: %s", frag, mileageVehicleExistsSQL)
		}
	}
}

// TestNewMileageRepo_NilPoolPanics defends the construction-time
// fail-fast: a nil pool is a wiring bug, not a runtime condition.
// Mirrors NewVehicleStatesRepo's contract for symmetry.
func TestNewMileageRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on nil pool")
		}
	}()
	_ = NewMileageRepo(nil)
}
