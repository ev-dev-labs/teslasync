package trip

import (
	"strings"
	"testing"
)

// TestTripHeaderSelectSQL_Shape pins the structural invariants of the
// header SQL. Catches accidental drift from the overlap, COALESCE,
// and single-round-trip requirements without needing a live Postgres.
func TestTripHeaderSelectSQL_Shape(t *testing.T) {
	t.Parallel()

	mustContain := []struct {
		needle string
		why    string
	}{
		{"FROM trips t", "header is keyed off the trips table"},
		{"LEFT JOIN trip_drives td ON td.trip_id = t.id", "left-join so trips with zero drives still surface"},
		{"LEFT JOIN drives d", "drives left-joined for SI aggregation"},
		{"WHERE t.id = $1", "single bind parameter is the trip id"},
		{"GROUP BY t.id, t.vehicle_id, t.name, t.started_at, t.ended_at", "group by every non-aggregated column"},
		{"COALESCE(SUM(COALESCE(d.distance_m, 0)),     0)", "double COALESCE per Decision D4"},
		{"COALESCE(SUM(COALESCE(d.energy_used_wh, 0)), 0)", "double COALESCE per Decision D4"},
		{"COALESCE(SUM(COALESCE(d.duration_s, 0)),     0)", "double COALESCE per Decision D4"},
		{"FROM charging_sessions cs", "charge aggregate uses charging_sessions"},
		{"cs.vehicle_id = t.vehicle_id", "charges are scoped per-vehicle"},
		{"cs.started_at < COALESCE(t.ended_at, NOW())", "overlap upper-bound per Decision D3"},
		{"COALESCE(cs.ended_at, cs.started_at) >= t.started_at", "overlap lower-bound per Decision D3"},
		{"COUNT(*)", "charge_count uses count star"},
		{"SUM(cs.cost_decimal)", "total_cost sums the NUMERIC cost column"},
	}
	for _, want := range mustContain {
		if !strings.Contains(tripHeaderSelectSQL, want.needle) {
			t.Errorf("tripHeaderSelectSQL must contain %q (%s)", want.needle, want.why)
		}
	}

	mustNotContain := []struct {
		needle string
		why    string
	}{
		{"INNER JOIN trip_drives", "must be LEFT JOIN to support empty trips"},
		{"INNER JOIN drives", "must be LEFT JOIN to support empty trips"},
		{"DELETE", "header SQL is pure SELECT"},
		{"INSERT", "header SQL is pure SELECT"},
		{"UPDATE ", "header SQL is pure SELECT"},
		{"cs.started_at BETWEEN", "must use overlap not start-only matching"},
	}
	for _, want := range mustNotContain {
		if strings.Contains(tripHeaderSelectSQL, want.needle) {
			t.Errorf("tripHeaderSelectSQL must NOT contain %q (%s)", want.needle, want.why)
		}
	}
}

// TestTripDrivesSelectSQL_Shape pins ordering and JOIN direction for
// the drives-list query.
func TestTripDrivesSelectSQL_Shape(t *testing.T) {
	t.Parallel()

	mustContain := []string{
		"FROM trip_drives td",
		"JOIN drives d ON d.id = td.drive_id",
		"WHERE td.trip_id = $1",
		"ORDER BY td.position ASC",
		"d.id",
		"d.started_at",
		"d.ended_at",
		"d.distance_m",
		"d.energy_used_wh",
		"d.duration_s",
		"d.start_place",
		"d.end_place",
	}
	for _, needle := range mustContain {
		if !strings.Contains(tripDrivesSelectSQL, needle) {
			t.Errorf("tripDrivesSelectSQL must contain %q", needle)
		}
	}

	if strings.Contains(tripDrivesSelectSQL, "ORDER BY d.started_at") {
		t.Errorf("ordering must be by trip_drives.position not d.started_at — drift from Decision D5")
	}
	if strings.Contains(tripDrivesSelectSQL, "LEFT JOIN drives") {
		t.Errorf("drives must be inner-joined: a trip_drives row without a drive is data corruption, not an empty list")
	}
}

// TestNewTripsDetailRepo_NilPoolPanics asserts the fail-fast
// constructor contract.
func TestNewTripsDetailRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()

	defer func() {
		if recover() == nil {
			t.Fatal("expected NewTripsDetailRepo(nil) to panic")
		}
	}()
	_ = NewTripsDetailRepo(nil)
}

// TestErrTripNotFound_IsSentinel guards against accidental
// re-definition of the sentinel that the handler matches on.
func TestErrTripNotFound_IsSentinel(t *testing.T) {
	t.Parallel()

	if ErrTripNotFound == nil {
		t.Fatal("ErrTripNotFound must be a non-nil sentinel error")
	}
	if got := ErrTripNotFound.Error(); got != "trip not found" {
		t.Errorf("ErrTripNotFound message drift: got %q, want %q", got, "trip not found")
	}
}
