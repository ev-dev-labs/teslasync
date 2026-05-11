package database

import (
	"math"
	"strings"
	"testing"
	"time"
)

// Phase-43a / Prompt 0003 — pure-Go tests for the vehicle_states repo.
//
// These tests exercise computeStateSummary (the dwell-time algorithm) and
// the SQL-shape constants. The repo's actual SQL execution requires a
// live PostgreSQL instance + mig 000187 applied; the codebase has no
// pgxmock / testcontainers harness, and the prompt's escape hatch
// explicitly accepts pure-Go test coverage in that case.

func vsPtrStr(s string) *string { return &s }

func mkTransition(t time.Time, from string, to, trigger, value string) VehicleStateTransition {
	tr := VehicleStateTransition{Ts: t, ToState: to}
	if from != "" {
		tr.FromState = vsPtrStr(from)
	}
	if trigger != "" {
		tr.TriggerField = vsPtrStr(trigger)
	}
	if value != "" {
		tr.TriggerValue = vsPtrStr(value)
	}
	return tr
}

// approxEqual returns true when a and b agree to within tolerance.
// computeStateSummary works with float64 seconds, so tolerance of 1e-6
// is well below the 0.01 percentage tolerance from Decision #8(c).
func approxEqual(a, b, tol float64) bool {
	return math.Abs(a-b) <= tol
}

func findRow(rows []VehicleStateSummaryRow, state string) (VehicleStateSummaryRow, bool) {
	for _, r := range rows {
		if r.State == state {
			return r, true
		}
	}
	return VehicleStateSummaryRow{}, false
}

// TestComputeStateSummary_Empty confirms zero transitions yields an
// empty (non-nil) slice and total=0 — the response shape must be
// {by_state: [], total_seconds: 0} even for newly-onboarded vehicles.
func TestComputeStateSummary_Empty(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	start := now.Add(-7 * 24 * time.Hour)
	rows, total := computeStateSummary(nil, start, now)
	if len(rows) != 0 {
		t.Fatalf("rows = %v, want empty", rows)
	}
	if rows == nil {
		t.Fatal("rows must be non-nil empty slice (not nil) — JSON marshalls to [] vs null")
	}
	if total != 0 {
		t.Fatalf("total = %f, want 0", total)
	}
}

// TestComputeStateSummary_WorkedExample is the 3-transition example from
// the prompt's design notes. windowEnd=12:00, windowStart=now-7d. The
// dwell math is exact (no float imprecision) because durations are
// whole minutes/days.
func TestComputeStateSummary_WorkedExample(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	start := end.Add(-7 * 24 * time.Hour)

	t1 := time.Date(2026, 5, 6, 10, 0, 0, 0, time.UTC)  // Online -> Driving
	t2 := time.Date(2026, 5, 6, 10, 30, 0, 0, time.UTC) // Driving -> Parked
	t3 := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)  // Parked -> Charging

	rows, total := computeStateSummary([]VehicleStateTransition{
		mkTransition(t1, "Online", "Driving", "Gear", "D"),
		mkTransition(t2, "Driving", "Parked", "Gear", "P"),
		mkTransition(t3, "Parked", "Charging", "ChargingActive", "true"),
	}, start, end)

	// Online: window_start to 10:00.
	wantOnlineSec := t1.Sub(start).Seconds()
	// Driving: 10:00 to 10:30 = 1800s.
	wantDrivingSec := 30 * 60.0
	// Parked: 10:30 to 11:00 = 1800s.
	wantParkedSec := 30 * 60.0
	// Charging: 11:00 to 12:00 = 3600s.
	wantChargingSec := 60 * 60.0
	wantTotal := wantOnlineSec + wantDrivingSec + wantParkedSec + wantChargingSec

	if !approxEqual(total, wantTotal, 1e-6) {
		t.Fatalf("total = %f, want %f", total, wantTotal)
	}

	cases := []struct {
		state string
		sec   float64
		count int
	}{
		{"Online", wantOnlineSec, 0},
		{"Driving", wantDrivingSec, 1},
		{"Parked", wantParkedSec, 1},
		{"Charging", wantChargingSec, 1},
	}
	for _, c := range cases {
		row, ok := findRow(rows, c.state)
		if !ok {
			t.Errorf("missing row for state %q", c.state)
			continue
		}
		if !approxEqual(row.TotalSeconds, c.sec, 1e-6) {
			t.Errorf("state %q total_seconds = %f, want %f", c.state, row.TotalSeconds, c.sec)
		}
		if row.TransitionCount != c.count {
			t.Errorf("state %q transition_count = %d, want %d", c.state, row.TransitionCount, c.count)
		}
		if row.Percentage < 0 {
			t.Errorf("state %q percentage = %f, must be non-negative", c.state, row.Percentage)
		}
	}

	// Decision #8(c) — percentages sum to 100 ± 0.01.
	pctSum := 0.0
	for _, r := range rows {
		pctSum += r.Percentage
	}
	if !approxEqual(pctSum, 100.0, 0.01) {
		t.Fatalf("percentage sum = %f, want 100 ± 0.01", pctSum)
	}
}

// TestComputeStateSummary_NilFromState_SkipsPrefix locks the design
// trade-off (documented on computeStateSummary): we skip the prefix
// dwell when first.from_state is NULL rather than introducing an
// "Unknown" bucket that would dominate percentages for new vehicles.
func TestComputeStateSummary_NilFromState_SkipsPrefix(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	start := end.Add(-1 * time.Hour)
	t1 := time.Date(2026, 5, 6, 11, 30, 0, 0, time.UTC)

	tr := mkTransition(t1, "" /* nil from_state */, "Driving", "Gear", "D")
	tr.FromState = nil // explicit
	rows, total := computeStateSummary([]VehicleStateTransition{tr}, start, end)

	if total != 1800 { // 30 minutes of "Driving" suffix only
		t.Fatalf("total = %f, want 1800 (no prefix attribution)", total)
	}
	if len(rows) != 1 || rows[0].State != "Driving" {
		t.Fatalf("rows = %+v, want exactly [Driving]", rows)
	}
	if rows[0].TransitionCount != 1 {
		t.Fatalf("Driving transition_count = %d, want 1", rows[0].TransitionCount)
	}
	if !approxEqual(rows[0].Percentage, 100.0, 0.01) {
		t.Fatalf("Driving percentage = %f, want 100", rows[0].Percentage)
	}
	if _, ok := findRow(rows, "Unknown"); ok {
		t.Fatal("must not synthesize an 'Unknown' bucket — design trade-off documented on computeStateSummary")
	}
}

// TestComputeStateSummary_SingleTransition exercises the prefix +
// suffix paths together (the worked example covers middle transitions
// too; this one drops the middle to surface boundary bugs).
func TestComputeStateSummary_SingleTransition(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	start := end.Add(-1 * time.Hour)
	t1 := time.Date(2026, 5, 6, 11, 30, 0, 0, time.UTC)

	rows, total := computeStateSummary([]VehicleStateTransition{
		mkTransition(t1, "Asleep", "Online", "Gear", ""),
	}, start, end)

	// Asleep: 11:00 -> 11:30 = 1800s
	// Online: 11:30 -> 12:00 = 1800s
	if !approxEqual(total, 3600, 1e-6) {
		t.Fatalf("total = %f, want 3600", total)
	}
	asleep, _ := findRow(rows, "Asleep")
	if !approxEqual(asleep.TotalSeconds, 1800, 1e-6) {
		t.Errorf("Asleep total_seconds = %f, want 1800", asleep.TotalSeconds)
	}
	if asleep.TransitionCount != 0 {
		t.Errorf("Asleep transition_count = %d, want 0 (prefix never enters)", asleep.TransitionCount)
	}
	online, _ := findRow(rows, "Online")
	if !approxEqual(online.TotalSeconds, 1800, 1e-6) {
		t.Errorf("Online total_seconds = %f, want 1800", online.TotalSeconds)
	}
	if online.TransitionCount != 1 {
		t.Errorf("Online transition_count = %d, want 1", online.TransitionCount)
	}
}

// TestComputeStateSummary_TransitionAtWindowStart confirms a transition
// exactly at windowStart produces zero prefix dwell — defends against
// negative-prefix bugs from clock skew.
func TestComputeStateSummary_TransitionAtWindowStart(t *testing.T) {
	t.Parallel()
	start := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)
	end := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)

	rows, total := computeStateSummary([]VehicleStateTransition{
		mkTransition(start, "Asleep", "Driving", "Gear", "D"),
	}, start, end)

	asleep, ok := findRow(rows, "Asleep")
	if ok && asleep.TotalSeconds != 0 {
		t.Errorf("Asleep prefix dwell = %f, want 0 at boundary", asleep.TotalSeconds)
	}
	driving, _ := findRow(rows, "Driving")
	if !approxEqual(driving.TotalSeconds, 3600, 1e-6) {
		t.Errorf("Driving total_seconds = %f, want 3600", driving.TotalSeconds)
	}
	if !approxEqual(total, 3600, 1e-6) {
		t.Errorf("total = %f, want 3600", total)
	}
}

// TestComputeStateSummary_FutureTimestamp_ClampedToZero proves the
// defensive clamp: a transition ts after windowEnd cannot subtract
// from total_seconds (would otherwise produce negative percentages).
func TestComputeStateSummary_FutureTimestamp_ClampedToZero(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	start := end.Add(-1 * time.Hour)
	future := end.Add(15 * time.Minute)

	rows, total := computeStateSummary([]VehicleStateTransition{
		mkTransition(future, "Online", "Driving", "Gear", "D"),
	}, start, end)

	for _, r := range rows {
		if r.TotalSeconds < 0 {
			t.Errorf("state %q total_seconds = %f, must be non-negative", r.State, r.TotalSeconds)
		}
		if r.Percentage < 0 {
			t.Errorf("state %q percentage = %f, must be non-negative", r.State, r.Percentage)
		}
	}
	if total < 0 {
		t.Fatalf("total = %f, must be non-negative", total)
	}
}

// TestComputeStateSummary_RepeatedState confirms transition_count
// accumulates when a state is entered multiple times in the window.
func TestComputeStateSummary_RepeatedState(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	start := end.Add(-3 * time.Hour)

	t1 := time.Date(2026, 5, 6, 9, 30, 0, 0, time.UTC)  // Asleep -> Online
	t2 := time.Date(2026, 5, 6, 10, 0, 0, 0, time.UTC)  // Online -> Driving
	t3 := time.Date(2026, 5, 6, 10, 30, 0, 0, time.UTC) // Driving -> Online (re-enters)
	t4 := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)  // Online -> Asleep
	t5 := time.Date(2026, 5, 6, 11, 30, 0, 0, time.UTC) // Asleep -> Online (re-enters)

	rows, _ := computeStateSummary([]VehicleStateTransition{
		mkTransition(t1, "Asleep", "Online", "Gear", ""),
		mkTransition(t2, "Online", "Driving", "Gear", "D"),
		mkTransition(t3, "Driving", "Online", "Gear", "P"),
		mkTransition(t4, "Online", "Asleep", "ConnFSM", ""),
		mkTransition(t5, "Asleep", "Online", "ConnFSM", ""),
	}, start, end)

	online, _ := findRow(rows, "Online")
	if online.TransitionCount != 3 {
		t.Errorf("Online transition_count = %d, want 3 (entered at t1, t3, t5)", online.TransitionCount)
	}
	asleep, _ := findRow(rows, "Asleep")
	if asleep.TransitionCount != 1 {
		t.Errorf("Asleep transition_count = %d, want 1 (entered once at t4; the prefix Asleep before t1 carries no count)", asleep.TransitionCount)
	}
	driving, _ := findRow(rows, "Driving")
	if driving.TransitionCount != 1 {
		t.Errorf("Driving transition_count = %d, want 1", driving.TransitionCount)
	}
}

// TestComputeStateSummary_RowsSortedByDwellDesc locks the stable render
// order documented on computeStateSummary.
func TestComputeStateSummary_RowsSortedByDwellDesc(t *testing.T) {
	t.Parallel()
	end := time.Date(2026, 5, 6, 12, 0, 0, 0, time.UTC)
	start := end.Add(-7 * 24 * time.Hour)
	t1 := time.Date(2026, 5, 6, 10, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 5, 6, 10, 30, 0, 0, time.UTC)

	rows, _ := computeStateSummary([]VehicleStateTransition{
		mkTransition(t1, "Online", "Driving", "Gear", "D"),
		mkTransition(t2, "Driving", "Parked", "Gear", "P"),
	}, start, end)

	for i := 1; i < len(rows); i++ {
		if rows[i-1].TotalSeconds < rows[i].TotalSeconds {
			t.Errorf("rows not sorted by total_seconds DESC: %+v before %+v", rows[i-1], rows[i])
		}
	}
}

// TestTimelineSelectSQL_Shape pins critical SQL fragments so a
// columnname/typo regression on the mig-000187 schema is caught at
// compile-test time rather than at runtime in production. The legacy
// FSMTransitionRepo.Insert at internal/database/fsm_transition_repo.go:37
// shows exactly how easy schema drift is here — it still references the
// dropped fsm_type column and would fail at first execution.
func TestTimelineSelectSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		"FROM fsm_transitions",
		"vehicle_id = $1",
		"fsm_name = 'vehicle'",
		"ts >= $2",
		"ts <= $3",
		"ORDER BY ts ASC",
		"trigger        AS trigger_field",
		"details ->> trigger AS trigger_value",
	}
	for _, frag := range mustContain {
		if !strings.Contains(timelineSelectSQL, frag) {
			t.Errorf("timelineSelectSQL missing %q\nfull SQL:\n%s", frag, timelineSelectSQL)
		}
	}
	mustNotContain := []string{
		"fsm_type", // dropped by mig 000187 — would fail at runtime
		"DESC",     // Decision #1 mandates ASC
	}
	for _, frag := range mustNotContain {
		if strings.Contains(timelineSelectSQL, frag) {
			t.Errorf("timelineSelectSQL must not contain %q (would either fail at runtime or violate Decision #1)\nfull SQL:\n%s", frag, timelineSelectSQL)
		}
	}
}

// TestVehicleExistsSQL_Shape pins the EXISTS form so a future
// refactor does not silently change the 404-vs-200 disambiguation
// (e.g. a SELECT ... LIMIT 1 returning rows would Scan into a bool
// differently).
func TestVehicleExistsSQL_Shape(t *testing.T) {
	t.Parallel()
	for _, frag := range []string{"EXISTS", "FROM vehicles", "id = $1"} {
		if !strings.Contains(vehicleExistsSQL, frag) {
			t.Errorf("vehicleExistsSQL missing %q\nfull SQL: %s", frag, vehicleExistsSQL)
		}
	}
}

// TestNewVehicleStatesRepo_NilPoolPanics defends the construction-time
// fail-fast: a nil pool is a wiring bug, not a runtime condition.
func TestNewVehicleStatesRepo_NilPoolPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on nil pool")
		}
	}()
	_ = NewVehicleStatesRepo(nil)
}
