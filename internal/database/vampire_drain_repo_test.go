package database

import (
	"math"
	"strings"
	"testing"
	"time"
)

// Phase-43a / Prompt 0005 — pure-Go tests for the vampire_drain repo.
//
// These tests exercise computeDrainEvents (the per-window drain math),
// computeStats (the aggregation and percentile math), percentileCont
// (the linear-interpolation primitive), and the SQL-shape constant.
//
// The repo's actual SQL execution requires a live PostgreSQL instance
// + mig 000186 + 000187 applied; the codebase has no pgxmock /
// testcontainers harness, and the prompt's escape hatch explicitly
// accepts pure-Go test coverage in that case (see the
// vehicle_states_repo_test.go and mileage_repo_test.go precedents
// from Phase-43a / Prompts 0003 + 0004).

// ---------- helpers ----------

// vdRawWindow constructs a VampireDrainRawWindow with millisecond
// precision so duration-derived rates are exact in the test fixtures.
func vdRawWindow(start, end time.Time, startPct, endPct float64) VampireDrainRawWindow {
	return VampireDrainRawWindow{
		StartedAt:       start,
		EndedAt:         end,
		StartBatteryPct: startPct,
		EndBatteryPct:   endPct,
	}
}

// approxEqualVD returns true when a and b agree to within tolerance.
// Used for float comparisons across the drain math + percentile output.
func approxEqualVD(a, b, tol float64) bool {
	return math.Abs(a-b) <= tol
}

// ---------- (a) Window pairing correctness via fixture ----------
//
// computeDrainEvents is the projection step that takes raw SQL rows
// and computes drain math. The "4-transition fixture" lives in the
// SQL CTE which we cannot exercise without a DB; we exercise the
// post-CTE projection here to lock the math itself.
//
// Per the prompt's worked example:
//
//	W1: 09:00 -> 17:55 = 8h55m, drain 85->83 = 2%, rate ≈ 5.38/day
//	W2: 19:00 -> 06:55 = 11h55m, drain 82->78 = 4%, rate ≈ 8.06/day

func TestComputeDrainEvents_WorkedExample(t *testing.T) {
	t.Parallel()
	w1Start := time.Date(2026, 5, 1, 9, 0, 0, 0, time.UTC)
	w1End := time.Date(2026, 5, 1, 17, 55, 0, 0, time.UTC)
	w2Start := time.Date(2026, 5, 1, 19, 0, 0, 0, time.UTC)
	w2End := time.Date(2026, 5, 2, 6, 55, 0, 0, time.UTC)

	events := computeDrainEvents([]VampireDrainRawWindow{
		vdRawWindow(w1Start, w1End, 85.0, 83.0),
		vdRawWindow(w2Start, w2End, 82.0, 78.0),
	})

	if len(events) != 2 {
		t.Fatalf("len(events) = %d, want 2", len(events))
	}

	w1Hours := w1End.Sub(w1Start).Hours()
	w2Hours := w2End.Sub(w2Start).Hours()

	cases := []struct {
		idx         int
		hours       float64
		drainPct    float64
		drainPerDay float64
	}{
		{0, w1Hours, 2.0, 2.0 * 24.0 / w1Hours},
		{1, w2Hours, 4.0, 4.0 * 24.0 / w2Hours},
	}
	for _, c := range cases {
		ev := events[c.idx]
		if !approxEqualVD(ev.DurationHours, c.hours, 1e-9) {
			t.Errorf("events[%d].duration_hours = %f, want %f", c.idx, ev.DurationHours, c.hours)
		}
		if !approxEqualVD(ev.DrainPct, c.drainPct, 1e-9) {
			t.Errorf("events[%d].drain_pct = %f, want %f", c.idx, ev.DrainPct, c.drainPct)
		}
		if !approxEqualVD(ev.DrainPctPerDay, c.drainPerDay, 1e-9) {
			t.Errorf("events[%d].drain_pct_per_day = %f, want %f", c.idx, ev.DrainPctPerDay, c.drainPerDay)
		}
		if ev.AmbientTempCAvg != nil {
			t.Errorf("events[%d].ambient_temp_c_avg = %v, want nil (forward-compat field)", c.idx, ev.AmbientTempCAvg)
		}
	}
}

// ---------- (d) drain_pct_per_day formula identity ----------
//
// drain_pct_per_day = drain_pct * (24 / duration_hours). Pin this
// across multiple durations — failure to scale by the per-day factor
// is the most common bug for "rate" projections.

func TestComputeDrainEvents_DrainPerDayFormula(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name     string
		duration time.Duration
		startPct float64
		endPct   float64
	}{
		{"24h_clean_day", 24 * time.Hour, 100, 95},          // 5%/day exact
		{"12h_half_day", 12 * time.Hour, 100, 95},           // 10%/day (5% over half-day)
		{"6h_quarter_day", 6 * time.Hour, 100, 99},          // 4%/day (1% over quarter-day)
		{"1h_hour", 1 * time.Hour, 100, 95},                 // 120%/day (extreme)
		{"48h_two_days", 48 * time.Hour, 100, 90},           // 5%/day
		{"36h_one_and_half_day", 36 * time.Hour, 90, 87.75}, // 1.5%/day
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			start := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
			end := start.Add(c.duration)
			events := computeDrainEvents([]VampireDrainRawWindow{
				vdRawWindow(start, end, c.startPct, c.endPct),
			})
			if len(events) != 1 {
				t.Fatalf("len(events) = %d, want 1", len(events))
			}
			drain := c.startPct - c.endPct
			wantRate := drain * 24.0 / c.duration.Hours()
			if !approxEqualVD(events[0].DrainPctPerDay, wantRate, 1e-9) {
				t.Errorf("drain_pct_per_day = %f, want %f (drain=%f over %v)",
					events[0].DrainPctPerDay, wantRate, drain, c.duration)
			}
		})
	}
}

// TestComputeDrainEvents_ZeroDurationClampsRate defends the divide-by-
// zero guard. The SQL's LEAD(ts) + next_ts IS NOT NULL filter normally
// guarantees ended_at > started_at; this test is the belt-and-suspenders
// behavior in case future schema changes weaken that invariant.
func TestComputeDrainEvents_ZeroDurationClampsRate(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	events := computeDrainEvents([]VampireDrainRawWindow{
		vdRawWindow(now, now, 90, 80), // zero-width window
	})
	if len(events) != 1 {
		t.Fatalf("len(events) = %d, want 1", len(events))
	}
	if events[0].DrainPctPerDay != 0 {
		t.Errorf("drain_pct_per_day = %f, want 0 (zero-duration clamp)", events[0].DrainPctPerDay)
	}
	if math.IsInf(events[0].DrainPctPerDay, 0) || math.IsNaN(events[0].DrainPctPerDay) {
		t.Errorf("drain_pct_per_day = %v, must not be ±Inf or NaN", events[0].DrainPctPerDay)
	}
}

// TestComputeDrainEvents_Empty is the "no qualifying windows" path —
// the response must be a non-nil empty slice so JSON marshals to []
// rather than null.
func TestComputeDrainEvents_Empty(t *testing.T) {
	t.Parallel()
	events := computeDrainEvents(nil)
	if events == nil {
		t.Fatal("events is nil; must be non-nil empty slice (JSON marshals to [] vs null)")
	}
	if len(events) != 0 {
		t.Fatalf("len(events) = %d, want 0", len(events))
	}
}

// ---------- (e) Stats invariants ----------
//
// computeStats reduces the projected events to the stats payload.
// avg_drain_pct_per_day, median_*, p95_* are all percentiles or
// aggregates over the same data; pin invariants:
//   - avg ≥ median for right-skewed data (typical of vampire drain
//     where most windows are small but occasional outliers spike)
//   - p95 ≥ avg always (definitionally for non-degenerate data)
//   - total_observed_hours = sum of per-event duration_hours
//   - event_count = len(events)
//   - empty events → all-null pointers, count=0, hours=0

func TestComputeStats_RightSkewedAvgGeMedian(t *testing.T) {
	t.Parallel()
	// Construct a right-skewed sample: ten "normal" events at 5/day,
	// one outlier at 30/day. Median = 5; mean ≈ 7.27. avg > median.
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	raw := []VampireDrainRawWindow{}
	// Ten events of exactly 24h with 5% drain → 5/day each.
	for i := 0; i < 10; i++ {
		start := now.Add(time.Duration(i) * 48 * time.Hour)
		end := start.Add(24 * time.Hour)
		raw = append(raw, vdRawWindow(start, end, 100, 95))
	}
	// One outlier: 24h with 30% drain → 30/day.
	outlierStart := now.Add(time.Duration(11) * 48 * time.Hour)
	raw = append(raw, vdRawWindow(outlierStart, outlierStart.Add(24*time.Hour), 100, 70))

	stats := computeStats(computeDrainEvents(raw))

	if stats.EventCount != 11 {
		t.Fatalf("event_count = %d, want 11", stats.EventCount)
	}
	if stats.AvgDrainPctPerDay == nil || stats.MedianDrainPctPerDay == nil || stats.P95DrainPctPerDay == nil {
		t.Fatalf("avg/median/p95 must be non-nil for non-empty events; got avg=%v median=%v p95=%v",
			stats.AvgDrainPctPerDay, stats.MedianDrainPctPerDay, stats.P95DrainPctPerDay)
	}
	avg := *stats.AvgDrainPctPerDay
	median := *stats.MedianDrainPctPerDay
	p95 := *stats.P95DrainPctPerDay

	if avg < median {
		t.Errorf("avg(%f) < median(%f) — right-skewed sample should have avg ≥ median", avg, median)
	}
	if p95 < avg {
		t.Errorf("p95(%f) < avg(%f) — p95 must be ≥ avg for non-degenerate data", p95, avg)
	}
	// Median over 11 sorted samples (10× 5, 1× 30) is the 6th (rank 5,
	// 0-indexed) = 5.0. percentile_cont at p=0.5 with n=11 has rank
	// 5.0 exactly, so median = sorted[5] = 5.0.
	if !approxEqualVD(median, 5.0, 1e-9) {
		t.Errorf("median = %f, want 5.0 (the 11-sample center)", median)
	}
	// Avg = (10*5 + 30) / 11 = 80/11 ≈ 7.2727
	if !approxEqualVD(avg, 80.0/11.0, 1e-9) {
		t.Errorf("avg = %f, want %f", avg, 80.0/11.0)
	}
	// Total observed hours = 11 events × 24h = 264h.
	if !approxEqualVD(stats.TotalObservedHours, 264.0, 1e-9) {
		t.Errorf("total_observed_hours = %f, want 264", stats.TotalObservedHours)
	}
}

func TestComputeStats_EmptyEventsAllNullPointers(t *testing.T) {
	t.Parallel()
	stats := computeStats([]VampireDrainEvent{})
	if stats.EventCount != 0 {
		t.Errorf("event_count = %d, want 0", stats.EventCount)
	}
	if stats.TotalObservedHours != 0 {
		t.Errorf("total_observed_hours = %f, want 0", stats.TotalObservedHours)
	}
	if stats.AvgDrainPctPerDay != nil {
		t.Errorf("avg_drain_pct_per_day = %v, want nil", stats.AvgDrainPctPerDay)
	}
	if stats.MedianDrainPctPerDay != nil {
		t.Errorf("median_drain_pct_per_day = %v, want nil", stats.MedianDrainPctPerDay)
	}
	if stats.P95DrainPctPerDay != nil {
		t.Errorf("p95_drain_pct_per_day = %v, want nil", stats.P95DrainPctPerDay)
	}
}

func TestComputeStats_SingleEvent(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	stats := computeStats(computeDrainEvents([]VampireDrainRawWindow{
		vdRawWindow(now, now.Add(24*time.Hour), 90, 88), // 2% over 24h = 2/day
	}))
	if stats.EventCount != 1 {
		t.Fatalf("event_count = %d, want 1", stats.EventCount)
	}
	for _, val := range []*float64{stats.AvgDrainPctPerDay, stats.MedianDrainPctPerDay, stats.P95DrainPctPerDay} {
		if val == nil || !approxEqualVD(*val, 2.0, 1e-9) {
			t.Errorf("single-sample percentile = %v, want 2.0", val)
		}
	}
}

func TestComputeStats_TotalObservedHoursIsSum(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	raw := []VampireDrainRawWindow{
		vdRawWindow(now, now.Add(2*time.Hour), 90, 89.5),
		vdRawWindow(now.Add(24*time.Hour), now.Add(24*time.Hour+5*time.Hour), 89, 88),
		vdRawWindow(now.Add(48*time.Hour), now.Add(48*time.Hour+8*time.Hour), 88, 86),
	}
	stats := computeStats(computeDrainEvents(raw))
	want := 2.0 + 5.0 + 8.0
	if !approxEqualVD(stats.TotalObservedHours, want, 1e-9) {
		t.Errorf("total_observed_hours = %f, want %f", stats.TotalObservedHours, want)
	}
}

// ---------- percentileCont primitive ----------

func TestPercentileCont_KnownValues(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		sorted []float64
		p      float64
		want   float64
	}{
		{"empty_returns_zero", nil, 0.5, 0},
		{"single_returns_value", []float64{42}, 0.5, 42},
		{"single_p_zero", []float64{42}, 0, 42},
		{"single_p_one", []float64{42}, 1, 42},
		{"two_p_half_interpolates", []float64{0, 100}, 0.5, 50},
		{"two_p_quarter", []float64{0, 100}, 0.25, 25},
		{"two_p_75pct", []float64{0, 100}, 0.75, 75},
		{"five_p_50_is_middle", []float64{1, 2, 3, 4, 5}, 0.5, 3},
		{"five_p_25", []float64{1, 2, 3, 4, 5}, 0.25, 2},            // rank = 0.25*4 = 1.0
		{"five_p_95_near_max", []float64{1, 2, 3, 4, 5}, 0.95, 4.8}, // rank = 3.8 → 4 + 0.8*1
		{"p_negative_clamps_to_min", []float64{10, 20, 30}, -0.5, 10},
		{"p_above_one_clamps_to_max", []float64{10, 20, 30}, 1.5, 30},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got := percentileCont(c.sorted, c.p)
			if !approxEqualVD(got, c.want, 1e-9) {
				t.Errorf("percentileCont(%v, %f) = %f, want %f", c.sorted, c.p, got, c.want)
			}
		})
	}
}

// ---------- (b) SQL-shape: charging-window exclusion ----------
//
// The actual NOT EXISTS sub-query that excludes windows with active
// charging is in vampireDrainSelectSQL. Pin the critical fragments so
// a typo on field name, value_kind, or int_value threshold is caught
// at compile-test time rather than at runtime in production.

func TestVampireDrainSelectSQL_Shape(t *testing.T) {
	t.Parallel()
	mustContain := []string{
		// CTE skeleton
		"WITH ordered_transitions AS",
		"parked_windows AS",
		"non_charging_windows AS",
		"battery_samples AS",
		// fsm_transitions filter
		"FROM fsm_transitions",
		"vehicle_id = $1",
		"fsm_name = 'vehicle'",
		"ts >= $2",
		"to_state = 'parked'",
		"next_ts IS NOT NULL",
		// Charging exclusion (Decision #5)
		"sl.field      = 'ChargeState'",
		"sl.value_kind = 7",
		"sl.int_value > 1",
		"NOT EXISTS",
		// BatteryLevel join
		"sl.field      = 'BatteryLevel'",
		"sl.value_kind = 5",
		"sl.float_value IS NOT NULL",
		// Endpoints + drop-negative-drain HAVING + LIMIT
		"GROUP BY started_at, ended_at",
		"HAVING",
		">= 0",
		"ORDER BY started_at DESC",
		"LIMIT $3",
	}
	for _, frag := range mustContain {
		if !strings.Contains(vampireDrainSelectSQL, frag) {
			t.Errorf("vampireDrainSelectSQL missing %q\nfull SQL:\n%s", frag, vampireDrainSelectSQL)
		}
	}
}

// TestVampireDrainSelectSQL_NeverIncludesPositiveBatteryGain locks the
// sign of the HAVING-clause filter — apparent NEGATIVE drain (battery
// went UP while parked) would be a non-charging-window data integrity
// issue, NOT a vampire drain event. Drop the row.
func TestVampireDrainSelectSQL_NeverIncludesPositiveBatteryGain(t *testing.T) {
	t.Parallel()
	// Verify the HAVING clause uses (start - end) >= 0 NOT (end - start)
	// >= 0 — positive drain = lost battery means start_pct > end_pct,
	// so start - end is non-negative.
	if !strings.Contains(vampireDrainSelectSQL, "MAX(CASE WHEN rn_first = 1 THEN battery_level END)\n       - MAX(CASE WHEN rn_last  = 1 THEN battery_level END) >= 0") {
		t.Errorf("vampireDrainSelectSQL HAVING clause has wrong sign: must be (start - end) >= 0\n%s", vampireDrainSelectSQL)
	}
}

// TestVampireExistsSQL_Shape confirms the existence probe matches the
// vehicle_states / mileage repos for consistency.
func TestVampireDrainExistsSQL_Shape(t *testing.T) {
	t.Parallel()
	want := `SELECT EXISTS (SELECT 1 FROM vehicles WHERE id = $1)`
	if vampireDrainVehicleExistsSQL != want {
		t.Errorf("vampireDrainVehicleExistsSQL = %q, want %q", vampireDrainVehicleExistsSQL, want)
	}
}
