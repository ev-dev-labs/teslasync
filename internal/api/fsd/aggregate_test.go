package fsd

import (
	"math"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func fp(v float64) *float64 { return &v }

func at(t *testing.T, iso string) time.Time {
	t.Helper()
	ts, err := time.Parse(time.RFC3339, iso)
	if err != nil {
		t.Fatalf("parse %q: %v", iso, err)
	}
	return ts.UTC()
}

func mustLoc(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load location %q: %v", name, err)
	}
	return loc
}

func fsdSample(t *testing.T, iso string, v *float64) Sample {
	t.Helper()
	version := trustedSignalLogNormalizationVersion
	return Sample{
		Field:                SignalFSDDistance,
		TS:                   at(t, iso),
		Value:                v,
		NormalizationVersion: &version,
	}
}

func drivingSample(t *testing.T, iso string, v *float64) Sample {
	t.Helper()
	version := trustedSignalLogNormalizationVersion
	return Sample{
		Field:                SignalDrivingDistance,
		TS:                   at(t, iso),
		Value:                v,
		NormalizationVersion: &version,
	}
}

// dayOf finds the dense-series entry for a local date. Fails the test when
// the date is absent, which is itself the density assertion.
func dayOf(t *testing.T, resp Response, date string) DailyPoint {
	t.Helper()
	for _, d := range resp.Daily {
		if d.Date == date {
			return d
		}
	}
	t.Fatalf("date %q missing from dense series (%d entries)", date, len(resp.Daily))
	return DailyPoint{}
}

func approx(a, b float64) bool { return math.Abs(a-b) <= 1e-6 }

// wantMeasured asserts the value is a MEASUREMENT equal to want. A nil here
// means "not reported", which is a different fact and must fail loudly.
func wantMeasured(t *testing.T, got *float64, want float64, label string) {
	t.Helper()
	if got == nil {
		t.Fatalf("%s = null (not measured), want measured %v", label, want)
	}
	if !approx(*got, want) {
		t.Errorf("%s = %v, want %v", label, *got, want)
	}
}

// wantUnmeasured asserts the value is null — the telemetry never supported a
// number here, and a zero would be a fabrication.
func wantUnmeasured(t *testing.T, got *float64, label string) {
	t.Helper()
	if got != nil {
		t.Errorf("%s = %v, want null (not measured)", label, *got)
	}
}

// utcParams builds a 3-day UTC window ending 2026-03-03.
func utcParams(t *testing.T, samples []Sample) AggregateParams {
	t.Helper()
	return AggregateParams{
		VehicleID: 7,
		Days:      3,
		Loc:       time.UTC,
		Start:     at(t, "2026-03-01T00:00:00Z"),
		End:       at(t, "2026-03-03T18:00:00Z"),
		Samples:   samples,
	}
}

// ---------------------------------------------------------------------------
// monotonic counters
// ---------------------------------------------------------------------------

func TestAggregate_MonotonicCountersAttributeDeltasToLaterSampleDay(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		// Baselines strictly before the window.
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1000)),
		drivingSample(t, "2026-02-28T22:00:00Z", fp(5000)),
		// Day 1: +400 fsd, +1000 driving.
		fsdSample(t, "2026-03-01T09:00:00Z", fp(1400)),
		drivingSample(t, "2026-03-01T09:00:00Z", fp(6000)),
		// Day 2: +600 fsd, +1000 driving.
		fsdSample(t, "2026-03-02T09:00:00Z", fp(2000)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(7000)),
	}))

	if len(resp.Daily) != 3 {
		t.Fatalf("dense series length = %d, want 3", len(resp.Daily))
	}
	wantMeasured(t, dayOf(t, resp, "2026-03-01").FSDDistanceM, 400, "day1 fsd")
	wantMeasured(t, dayOf(t, resp, "2026-03-02").FSDDistanceM, 600, "day2 fsd")
	// Day 3 reported nothing at all — neither counter emitted — so there is
	// no evidence either way and the value stays null.
	wantUnmeasured(t, dayOf(t, resp, "2026-03-03").FSDDistanceM, "day3 fsd")

	wantMeasured(t, resp.Totals.FSDDistanceM, 1000, "total fsd")
	wantMeasured(t, resp.Totals.DrivingDistanceM, 2000, "total driving")
	wantMeasured(t, resp.Totals.FSDSharePct, 50, "share")

	if resp.Totals.ActiveDays != 2 {
		t.Errorf("active days = %d, want 2", resp.Totals.ActiveDays)
	}
	if resp.Totals.MeasuredDays != 2 {
		t.Errorf("measured days = %d, want 2", resp.Totals.MeasuredDays)
	}
	if resp.Quality.CounterObservationDays != 2 {
		t.Errorf("counter observation days = %d, want 2", resp.Quality.CounterObservationDays)
	}
	if resp.Quality.DaysWithoutCounterObservation != 1 {
		t.Errorf(
			"days without counter observation = %d, want 1",
			resp.Quality.DaysWithoutCounterObservation,
		)
	}
	if !approx(resp.Quality.CounterObservationDayPct, 66.67) {
		t.Errorf("counter observation day percentage = %v, want 66.67", resp.Quality.CounterObservationDayPct)
	}
	if !resp.Quality.FSDBaselineAvailable || !resp.Quality.DrivingBaselineAvailable {
		t.Error("expected both baselines to be reported available")
	}
	if !resp.Quality.FSDReportedInPeriod || !resp.Quality.FSDDistanceDerivable {
		t.Errorf("quality = %+v, want fsd reported + derivable", resp.Quality)
	}
	if resp.Quality.FSDMeasuredDays != 2 {
		t.Errorf("fsd measured days = %d, want 2", resp.Quality.FSDMeasuredDays)
	}
	if resp.Totals.BestDay == nil || resp.Totals.BestDay.Date != "2026-03-02" {
		t.Fatalf("best day = %+v, want 2026-03-02", resp.Totals.BestDay)
	}
	wantMeasured(t, resp.Totals.AvgMeasuredDayFSDDistanceM, 500, "avg measured day")
	wantMeasured(t, resp.Totals.AvgActiveDayFSDDistanceM, 500, "avg active day")

	if resp.Quality.FirstObservationAt == nil || !resp.Quality.FirstObservationAt.Equal(at(t, "2026-03-01T09:00:00Z")) {
		t.Errorf("first observation = %v", resp.Quality.FirstObservationAt)
	}
	if resp.Quality.LastObservationAt == nil || !resp.Quality.LastObservationAt.Equal(at(t, "2026-03-02T09:00:00Z")) {
		t.Errorf("last observation = %v", resp.Quality.LastObservationAt)
	}
	if resp.Quality.FSDFirstObservationAt == nil || !resp.Quality.FSDFirstObservationAt.Equal(at(t, "2026-03-01T09:00:00Z")) {
		t.Errorf("fsd first observation = %v", resp.Quality.FSDFirstObservationAt)
	}
}

func TestAggregate_UnorderedInputIsSortedBeforeDifferencing(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-03-02T09:00:00Z", fp(2000)),
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1000)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(1400)),
	}))

	wantMeasured(t, resp.Totals.FSDDistanceM, 1000, "total fsd (input order must not matter)")
	if resp.Quality.FSDResetCount != 0 {
		t.Errorf("reset count = %d, want 0", resp.Quality.FSDResetCount)
	}
}

// ---------------------------------------------------------------------------
// absence vs measured zero — the core honesty contract
// ---------------------------------------------------------------------------

func TestAggregate_DrivingOnlyTelemetryLeavesSelfDrivingUnmeasured(t *testing.T) {
	// The vehicle reports MilesSinceReset all period and never emits
	// SelfDrivingMilesSinceReset (no FSD hardware / never engaged / not
	// subscribed). Reporting 0 m of supervised self-driving here would be a
	// fabrication.
	resp := Aggregate(utcParams(t, []Sample{
		drivingSample(t, "2026-02-28T22:00:00Z", fp(5000)),
		drivingSample(t, "2026-03-01T09:00:00Z", fp(20000)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(41000)),
		drivingSample(t, "2026-03-03T09:00:00Z", fp(53000)),
	}))

	wantUnmeasured(t, resp.Totals.FSDDistanceM, "total fsd")
	wantUnmeasured(t, resp.Totals.FSDSharePct, "total share")
	wantUnmeasured(t, resp.Totals.AvgMeasuredDayFSDDistanceM, "avg measured day fsd")
	wantUnmeasured(t, resp.Totals.AvgActiveDayFSDDistanceM, "avg active day fsd")
	if resp.Totals.BestDay != nil {
		t.Errorf("best day = %+v, want nil", resp.Totals.BestDay)
	}
	if resp.Totals.ActiveDays != 0 || resp.Totals.MeasuredDays != 0 {
		t.Errorf("active/measured days = %d/%d, want 0/0", resp.Totals.ActiveDays, resp.Totals.MeasuredDays)
	}

	// The observed-driving side is fully measured — the two counters are
	// independent and one must not drag the other down.
	wantMeasured(t, resp.Totals.DrivingDistanceM, 48000, "total driving")

	if resp.Quality.FSDReportedInPeriod {
		t.Error("fsd_reported_in_period must be false with no self-driving observations")
	}
	if resp.Quality.FSDDistanceDerivable {
		t.Error("fsd_distance_derivable must be false with no self-driving observations")
	}
	if !resp.Quality.DrivingReportedInPeriod || !resp.Quality.DrivingDenominatorAvailable {
		t.Error("the driving counter must still report as available")
	}
	if resp.Quality.FSDMeasuredDays != 0 {
		t.Errorf("fsd measured days = %d, want 0", resp.Quality.FSDMeasuredDays)
	}

	for _, d := range resp.Daily {
		wantUnmeasured(t, d.FSDDistanceM, "daily fsd on "+d.Date)
		wantUnmeasured(t, d.FSDSharePct, "daily share on "+d.Date)
		if !d.HasCounterObservation {
			t.Errorf("day %s should still report an observation from the driving counter", d.Date)
		}
	}
}

func TestAggregate_BaselineOnlyIsNotProofOfPeriodReporting(t *testing.T) {
	// The self-driving counter emitted once before the window and then went
	// silent. We know its value at the window edge, but nothing about the
	// period on screen — so the whole period is unmeasured.
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-20T10:00:00Z", fp(120000)),
		drivingSample(t, "2026-02-28T22:00:00Z", fp(5000)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(9000)),
	}))

	if !resp.Quality.FSDBaselineAvailable {
		t.Error("the baseline itself must still be reported as available")
	}
	if resp.Quality.FSDReportedInPeriod {
		t.Error("a pre-window baseline must NOT count as reporting inside the period")
	}
	if resp.Quality.FSDDistanceDerivable {
		t.Error("a baseline with no in-window observation cannot derive a distance")
	}
	wantUnmeasured(t, resp.Totals.FSDDistanceM, "total fsd")
	wantUnmeasured(t, resp.Totals.FSDSharePct, "total share")
	for _, d := range resp.Daily {
		wantUnmeasured(t, d.FSDDistanceM, "daily fsd on "+d.Date)
	}
	if resp.Quality.FSDSampleCount != 0 {
		t.Errorf("fsd in-window sample count = %d, want 0", resp.Quality.FSDSampleCount)
	}
}

func TestAggregate_GenuineZeroAfterBaselineAndUnchangedSampleIsMeasured(t *testing.T) {
	// Baseline + an in-window re-emission of the SAME value: the counter
	// demonstrably reported and demonstrably did not move. That is a measured
	// zero, and it must NOT collapse into the "not reported" bucket.
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(4200)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(4200)),
		drivingSample(t, "2026-02-28T22:00:00Z", fp(80000)),
		drivingSample(t, "2026-03-01T09:00:00Z", fp(92000)),
	}))

	if !resp.Quality.FSDReportedInPeriod || !resp.Quality.FSDDistanceDerivable {
		t.Fatalf("quality = %+v, want reported + derivable", resp.Quality)
	}
	wantMeasured(t, resp.Totals.FSDDistanceM, 0, "total fsd")
	wantMeasured(t, dayOf(t, resp, "2026-03-01").FSDDistanceM, 0, "day1 fsd")
	wantMeasured(t, dayOf(t, resp, "2026-03-01").FSDSharePct, 0, "day1 share")
	wantMeasured(t, resp.Totals.FSDSharePct, 0, "total share")
	if resp.Totals.ActiveDays != 0 {
		t.Errorf("active days = %d, want 0 — a measured zero is not an active day", resp.Totals.ActiveDays)
	}
	if resp.Totals.MeasuredDays != 1 {
		t.Errorf("measured days = %d, want 1", resp.Totals.MeasuredDays)
	}
}

func TestAggregate_MeasuredZeroWhenDrivingCounterReportedButFsdDidNotMove(t *testing.T) {
	// Day 2 emits the driving counter only. Tesla transmits a field only when
	// it CHANGES, so a day with a relevant counter observation and no
	// self-driving emission is a measured zero for the self-driving counter.
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1000)),
		drivingSample(t, "2026-02-28T22:00:00Z", fp(5000)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(1500)),
		drivingSample(t, "2026-03-01T09:00:00Z", fp(9000)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(15000)),
	}))

	wantMeasured(t, dayOf(t, resp, "2026-03-01").FSDDistanceM, 500, "day1 fsd")
	wantMeasured(t, dayOf(t, resp, "2026-03-02").FSDDistanceM, 0, "day2 fsd")
	wantMeasured(t, dayOf(t, resp, "2026-03-02").FSDSharePct, 0, "day2 share")
	// Neither relevant distance counter reported on day 3.
	wantUnmeasured(t, dayOf(t, resp, "2026-03-03").FSDDistanceM, "day3 fsd")

	if resp.Totals.MeasuredDays != 2 {
		t.Errorf("measured days = %d, want 2", resp.Totals.MeasuredDays)
	}
	if resp.Totals.ActiveDays != 1 {
		t.Errorf("active days = %d, want 1", resp.Totals.ActiveDays)
	}
}

func TestAggregate_DaysBeforeTheFirstDerivableDeltaAreUnmeasured(t *testing.T) {
	// No baseline. Day 1 reports the driving counter, day 2 opens the
	// self-driving counter, day 3 produces the first derivable delta. Nothing
	// before day 3 can be attributed.
	resp := Aggregate(utcParams(t, []Sample{
		drivingSample(t, "2026-03-01T09:00:00Z", fp(1000)),
		fsdSample(t, "2026-03-02T09:00:00Z", fp(700)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(4000)),
		fsdSample(t, "2026-03-03T09:00:00Z", fp(900)),
		drivingSample(t, "2026-03-03T09:00:00Z", fp(6000)),
	}))

	wantUnmeasured(t, dayOf(t, resp, "2026-03-01").FSDDistanceM, "day1 fsd")
	wantUnmeasured(t, dayOf(t, resp, "2026-03-02").FSDDistanceM, "day2 fsd (anchor reading only)")
	wantMeasured(t, dayOf(t, resp, "2026-03-03").FSDDistanceM, 200, "day3 fsd")
	wantMeasured(t, resp.Totals.FSDDistanceM, 200, "total fsd")
	if resp.Totals.MeasuredDays != 1 {
		t.Errorf("measured days = %d, want 1", resp.Totals.MeasuredDays)
	}
	if dayOf(t, resp, "2026-03-02").FSDObservationCount != 1 {
		t.Error("the anchor day must still report its observation count")
	}
}

// ---------------------------------------------------------------------------
// resets
// ---------------------------------------------------------------------------

func TestAggregate_CounterResetContributesNoDistanceAndIsCounted(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(9000)),
		// +500 on day 1.
		fsdSample(t, "2026-03-01T09:00:00Z", fp(9500)),
		// Trip meter reset by the driver: value collapses to 20.
		fsdSample(t, "2026-03-02T09:00:00Z", fp(20)),
		// +80 after the reset, on day 3.
		fsdSample(t, "2026-03-03T09:00:00Z", fp(100)),
	}))

	wantMeasured(t, resp.Totals.FSDDistanceM, 580, "total fsd (500 pre-reset + 80 post-reset)")
	if resp.Quality.FSDResetCount != 1 {
		t.Errorf("reset count = %d, want 1", resp.Quality.FSDResetCount)
	}
	resetDay := dayOf(t, resp, "2026-03-02")
	wantMeasured(t, resetDay.FSDDistanceM, 0, "reset day distance (post-reset value is not distance)")
	if resetDay.ResetCount != 1 {
		t.Errorf("reset day reset count = %d, want 1", resetDay.ResetCount)
	}
	if !resetDay.HasCounterObservation {
		t.Error("reset day must still report a counter observation")
	}
	for _, d := range resp.Daily {
		if d.FSDDistanceM != nil && *d.FSDDistanceM < 0 {
			t.Fatalf("day %s has negative distance %v", d.Date, *d.FSDDistanceM)
		}
	}
}

func TestAggregate_IndependentResetsClampShareAtOneHundredPercent(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(0)),
		drivingSample(t, "2026-02-28T22:00:00Z", fp(0)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(5000)),
		drivingSample(t, "2026-03-01T09:00:00Z", fp(1000)),
	}))

	if resp.Totals.FSDSharePct == nil || *resp.Totals.FSDSharePct != 100 {
		t.Fatalf("share = %v, want clamped 100", resp.Totals.FSDSharePct)
	}
	if !resp.Quality.ShareClamped {
		t.Error("share_clamped must be true when the raw ratio exceeded 100%")
	}
}

// ---------------------------------------------------------------------------
// missing baseline
// ---------------------------------------------------------------------------

func TestAggregate_FirstInWindowSampleWithoutBaselineIsNotDistance(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		// No pre-window row: the absolute 12 000 m reading says nothing
		// about how much of it happened inside the window.
		fsdSample(t, "2026-03-01T09:00:00Z", fp(12000)),
		fsdSample(t, "2026-03-02T09:00:00Z", fp(12500)),
		drivingSample(t, "2026-03-01T09:00:00Z", fp(80000)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(82000)),
	}))

	if resp.Quality.FSDBaselineAvailable {
		t.Error("baseline must be reported unavailable")
	}
	wantMeasured(t, resp.Totals.FSDDistanceM, 500, "total fsd (only the in-window delta counts)")
	wantUnmeasured(t, dayOf(t, resp, "2026-03-01").FSDDistanceM, "first day distance")
	if got := dayOf(t, resp, "2026-03-01").FSDObservationCount; got != 1 {
		t.Errorf("first day observations = %d, want 1 (observed but unattributable)", got)
	}
	wantMeasured(t, dayOf(t, resp, "2026-03-02").FSDDistanceM, 500, "second day distance")
	wantMeasured(t, resp.Totals.DrivingDistanceM, 2000, "total driving")
	wantUnmeasured(
		t,
		dayOf(t, resp, "2026-03-01").DrivingDistanceM,
		"first day driving distance",
	)
	wantMeasured(t, dayOf(t, resp, "2026-03-02").DrivingDistanceM, 2000, "second day driving distance")
	wantMeasured(t, resp.Totals.FSDSharePct, 25, "share from simultaneous in-window anchors")
	if !resp.Quality.ShareBasisAvailable {
		t.Error("simultaneous first observations establish a common share basis")
	}
}

func TestAggregate_MismatchedBaselineSpansLeaveUsageShareUnknown(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		// FSD has state at the period boundary.
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1000)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(1400)),
		fsdSample(t, "2026-03-02T09:00:00Z", fp(1600)),
		// Driving starts from an in-window anchor instead.
		drivingSample(t, "2026-03-01T09:00:00Z", fp(5000)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(7000)),
	}))

	wantMeasured(t, resp.Totals.FSDDistanceM, 600, "standalone fsd distance")
	wantMeasured(t, resp.Totals.DrivingDistanceM, 2000, "standalone driving distance")
	wantUnmeasured(t, resp.Totals.FSDSharePct, "period share with mismatched counter spans")
	wantUnmeasured(
		t,
		dayOf(t, resp, "2026-03-02").FSDSharePct,
		"daily share with mismatched counter spans",
	)
	if resp.Quality.ShareBasisAvailable {
		t.Error("one pre-window baseline and one in-window anchor are not a common share basis")
	}
	if resp.Totals.BestDay == nil || resp.Totals.BestDay.FSDSharePct != nil {
		t.Fatalf("best-day share must also remain unknown, got %+v", resp.Totals.BestDay)
	}
}

func TestAggregate_SingleObservationWithoutBaselineYieldsUnmeasuredDistance(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-03-02T09:00:00Z", fp(12000)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(80000)),
	}))

	if resp.Quality.FSDReportedInPeriod != true {
		t.Error("one in-window observation IS reporting, even though it is not derivable")
	}
	if resp.Quality.FSDDistanceDerivable {
		t.Error("a lone observation without a baseline is not derivable")
	}
	wantUnmeasured(t, resp.Totals.FSDDistanceM, "total fsd")
	if resp.Quality.DrivingDenominatorAvailable {
		t.Error("a lone driving observation without a baseline is not a derivable denominator")
	}
	wantUnmeasured(t, resp.Totals.DrivingDistanceM, "total driving")
	wantUnmeasured(t, resp.Totals.FSDSharePct, "share")
	if resp.Totals.ActiveDays != 0 {
		t.Errorf("active days = %d, want 0", resp.Totals.ActiveDays)
	}
	if resp.Quality.CounterObservationDays != 1 {
		t.Errorf("counter observation days = %d, want 1", resp.Quality.CounterObservationDays)
	}
}

// ---------------------------------------------------------------------------
// absent denominator
// ---------------------------------------------------------------------------

func TestAggregate_AbsentDrivingCounterLeavesShareNull(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1000)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(1400)),
	}))

	wantMeasured(t, resp.Totals.FSDDistanceM, 400, "total fsd")
	if resp.Quality.DrivingDenominatorAvailable || resp.Quality.DrivingReportedInPeriod {
		t.Error("denominator must be reported unavailable")
	}
	wantUnmeasured(t, resp.Totals.DrivingDistanceM, "total driving")
	wantUnmeasured(t, resp.Totals.FSDSharePct, "share (unknown, not zero)")

	d := dayOf(t, resp, "2026-03-01")
	wantUnmeasured(t, d.DrivingDistanceM, "day driving")
	wantUnmeasured(t, d.FSDSharePct, "day share")
	if resp.Totals.BestDay == nil || resp.Totals.BestDay.FSDSharePct != nil {
		t.Errorf("best day share must stay nil, got %+v", resp.Totals.BestDay)
	}
}

func TestAggregate_ZeroDrivingDistanceDoesNotProduceInfiniteShare(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1000)),
		drivingSample(t, "2026-02-28T22:00:00Z", fp(5000)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(1400)),
		// Driving counter re-emitted with an unchanged value.
		drivingSample(t, "2026-03-01T09:00:00Z", fp(5000)),
	}))

	wantMeasured(t, resp.Totals.DrivingDistanceM, 0, "driving distance (derivable and genuinely zero)")
	wantUnmeasured(t, resp.Totals.FSDSharePct, "share for a zero denominator")
}

// ---------------------------------------------------------------------------
// timezone
// ---------------------------------------------------------------------------

func TestAggregate_AttributesDeltaToLocalCalendarDayOfLaterSample(t *testing.T) {
	la := mustLoc(t, "America/Los_Angeles")
	// 2026-03-02T05:00:00Z is 2026-03-01 21:00 local (PST, UTC-8).
	params := AggregateParams{
		VehicleID: 7,
		Days:      3,
		Loc:       la,
		Start:     time.Date(2026, 2, 28, 0, 0, 0, 0, la),
		End:       time.Date(2026, 3, 2, 12, 0, 0, 0, la),
		Samples: []Sample{
			fsdSample(t, "2026-02-27T22:00:00Z", fp(1000)),
			fsdSample(t, "2026-03-02T05:00:00Z", fp(1600)),
		},
	}

	resp := Aggregate(params)

	if resp.Period.Timezone != "America/Los_Angeles" {
		t.Errorf("timezone = %q", resp.Period.Timezone)
	}
	wantMeasured(t, dayOf(t, resp, "2026-03-01").FSDDistanceM, 600, "local 2026-03-01 distance")
	wantUnmeasured(t, dayOf(t, resp, "2026-02-28").FSDDistanceM, "local 2026-02-28 (before the first delta)")
	wantUnmeasured(
		t,
		dayOf(t, resp, "2026-03-02").FSDDistanceM,
		"local 2026-03-02 (no counter observation)",
	)

	// Same instants under UTC land on the following calendar day.
	utc := params
	utc.Loc = time.UTC
	utc.Start = at(t, "2026-02-28T00:00:00Z")
	utc.End = at(t, "2026-03-02T20:00:00Z")
	utcResp := Aggregate(utc)
	wantMeasured(t, dayOf(t, utcResp, "2026-03-02").FSDDistanceM, 600, "utc 2026-03-02 distance")
}

func TestAggregate_DenseSeriesCrossesDstSpringForwardWithoutDrift(t *testing.T) {
	la := mustLoc(t, "America/Los_Angeles")
	// 2026-03-08 is the US spring-forward date; a fixed 24h step would
	// produce a duplicated or skipped calendar date.
	resp := Aggregate(AggregateParams{
		VehicleID: 7,
		Days:      4,
		Loc:       la,
		Start:     time.Date(2026, 3, 6, 0, 0, 0, 0, la),
		End:       time.Date(2026, 3, 9, 10, 0, 0, 0, la),
	})

	want := []string{"2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"}
	if len(resp.Daily) != len(want) {
		t.Fatalf("series length = %d, want %d", len(resp.Daily), len(want))
	}
	for i, date := range want {
		if resp.Daily[i].Date != date {
			t.Errorf("day[%d] = %q, want %q", i, resp.Daily[i].Date, date)
		}
	}
}

func TestAggregate_DenseSeriesCrossesMidnightDstWithoutDuplicateDate(t *testing.T) {
	santiago := mustLoc(t, "America/Santiago")
	now := at(t, "2026-08-28T20:00:00Z")
	start := periodStart(now, 365, santiago)

	resp := Aggregate(AggregateParams{
		VehicleID: 7,
		Days:      365,
		Loc:       santiago,
		Start:     start,
		End:       now,
	})

	if len(resp.Daily) != 365 {
		t.Fatalf("series length = %d, want 365", len(resp.Daily))
	}
	if got := resp.Daily[0].Date; got != "2025-08-29" {
		t.Errorf("first day = %q, want 2025-08-29", got)
	}
	if got := resp.Daily[len(resp.Daily)-1].Date; got != "2026-08-28" {
		t.Errorf("last day = %q, want 2026-08-28", got)
	}
	seen := make(map[string]struct{}, len(resp.Daily))
	for _, point := range resp.Daily {
		if _, duplicate := seen[point.Date]; duplicate {
			t.Fatalf("duplicate civil date %q across midnight DST transition", point.Date)
		}
		seen[point.Date] = struct{}{}
	}
}

// ---------------------------------------------------------------------------
// invalid + duplicate samples
// ---------------------------------------------------------------------------

func TestAggregate_InvalidSamplesAreCountedAndNeverCorruptTheAccumulator(t *testing.T) {
	nan := math.NaN()
	inf := math.Inf(1)
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1000)),
		fsdSample(t, "2026-03-01T01:00:00Z", nil),
		fsdSample(t, "2026-03-01T02:00:00Z", &nan),
		fsdSample(t, "2026-03-01T03:00:00Z", &inf),
		fsdSample(t, "2026-03-01T04:00:00Z", fp(-5)),
		// The next valid sample must difference against the 1000 m
		// baseline, not against any rejected row.
		fsdSample(t, "2026-03-01T09:00:00Z", fp(1250)),
	}))

	if resp.Quality.FSDInvalidSampleCount != 4 {
		t.Errorf("invalid sample count = %d, want 4", resp.Quality.FSDInvalidSampleCount)
	}
	if resp.Quality.FSDSampleCount != 1 {
		t.Errorf("valid sample count = %d, want 1", resp.Quality.FSDSampleCount)
	}
	wantMeasured(t, resp.Totals.FSDDistanceM, 250, "total fsd")
	if resp.Quality.FSDResetCount != 0 {
		t.Errorf("reset count = %d, want 0 (a negative row is invalid, not a reset)", resp.Quality.FSDResetCount)
	}
	if got := dayOf(t, resp, "2026-03-01").FSDObservationCount; got != 1 {
		t.Errorf("observation count = %d, want 1", got)
	}
}

func TestAggregate_DuplicateTimestampsAreSkippedNotDoubleCounted(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1000)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(1400)),
		// Redelivery of the same instant with a drifted value.
		fsdSample(t, "2026-03-01T09:00:00Z", fp(9999)),
	}))

	wantMeasured(t, resp.Totals.FSDDistanceM, 400, "total fsd")
	if resp.Quality.FSDDuplicateSampleCount != 1 {
		t.Errorf("duplicate count = %d, want 1", resp.Quality.FSDDuplicateSampleCount)
	}
	if resp.Quality.FSDSampleCount != 1 {
		t.Errorf("valid sample count = %d, want 1", resp.Quality.FSDSampleCount)
	}
}

func TestAggregate_UnknownFieldsAreIgnored(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		{Field: "Odometer", TS: at(t, "2026-03-01T09:00:00Z"), Value: fp(1_000_000)},
	}))

	if resp.Quality.FSDSampleCount != 0 || resp.Quality.DrivingSampleCount != 0 {
		t.Fatalf("unrelated field leaked into counters: %+v", resp.Quality)
	}
	if resp.Quality.CounterObservationDays != 0 {
		t.Errorf("counter observation days = %d, want 0", resp.Quality.CounterObservationDays)
	}
	wantUnmeasured(t, resp.Totals.FSDDistanceM, "total fsd")
}

func TestAggregate_UntrustedNormalizationRowsAreExcludedWithoutBreakingTrustedDeltas(t *testing.T) {
	legacyFSD := fsdSample(t, "2026-03-01T09:00:00Z", fp(1000))
	legacyFSD.NormalizationVersion = nil
	legacyDriving := drivingSample(t, "2026-03-01T09:00:00Z", fp(3000))
	legacyDriving.NormalizationVersion = nil

	resp := Aggregate(utcParams(t, []Sample{
		// Trusted pre-window state must remain the delta anchor even if an
		// older rolling-deployment writer emits a later unversioned row.
		fsdSample(t, "2026-02-28T22:00:00Z", fp(1609.344)),
		drivingSample(t, "2026-02-28T22:00:00Z", fp(8046.72)),
		legacyFSD,
		legacyDriving,
		fsdSample(t, "2026-03-02T09:00:00Z", fp(3218.688)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(11265.408)),
	}))

	wantMeasured(t, resp.Totals.FSDDistanceM, 1609.344, "trusted fsd delta")
	wantMeasured(t, resp.Totals.DrivingDistanceM, 3218.688, "trusted driving delta")
	wantMeasured(t, resp.Totals.FSDSharePct, 50, "trusted share")
	if !resp.Quality.HistoricalDataGuarded {
		t.Error("historical data guard must always be active")
	}
	if resp.Quality.RequiredNormalizationVersion != trustedSignalLogNormalizationVersion {
		t.Errorf(
			"required normalization version = %d, want %d",
			resp.Quality.RequiredNormalizationVersion,
			trustedSignalLogNormalizationVersion,
		)
	}
	if resp.Quality.FSDUntrustedSampleCount != 1 || resp.Quality.DrivingUntrustedSampleCount != 1 {
		t.Errorf("untrusted counts = %d/%d, want 1/1",
			resp.Quality.FSDUntrustedSampleCount,
			resp.Quality.DrivingUntrustedSampleCount,
		)
	}
	if resp.Quality.FSDSampleCount != 1 || resp.Quality.DrivingSampleCount != 1 {
		t.Errorf("trusted in-window counts = %d/%d, want 1/1",
			resp.Quality.FSDSampleCount,
			resp.Quality.DrivingSampleCount,
		)
	}
}

// ---------------------------------------------------------------------------
// dense empty period
// ---------------------------------------------------------------------------

func TestAggregate_EmptyPeriodStillReturnsDenseUnmeasuredSeries(t *testing.T) {
	resp := Aggregate(AggregateParams{
		VehicleID: 42,
		Days:      7,
		Loc:       time.UTC,
		Start:     at(t, "2026-03-01T00:00:00Z"),
		End:       at(t, "2026-03-07T23:00:00Z"),
	})

	if len(resp.Daily) != 7 {
		t.Fatalf("series length = %d, want 7", len(resp.Daily))
	}
	for _, d := range resp.Daily {
		wantUnmeasured(t, d.FSDDistanceM, "daily fsd on "+d.Date)
		wantUnmeasured(t, d.DrivingDistanceM, "daily driving on "+d.Date)
		wantUnmeasured(t, d.FSDSharePct, "daily share on "+d.Date)
		if d.HasCounterObservation {
			t.Errorf("day %s must report no counter observation", d.Date)
		}
	}
	wantUnmeasured(t, resp.Totals.FSDDistanceM, "total fsd")
	if resp.Totals.BestDay != nil {
		t.Errorf("best day = %+v, want nil", resp.Totals.BestDay)
	}
	wantUnmeasured(t, resp.Totals.AvgMeasuredDayFSDDistanceM, "avg measured day")
	wantUnmeasured(t, resp.Totals.AvgActiveDayFSDDistanceM, "avg active day")
	if resp.Quality.CounterObservationDayPct != 0 {
		t.Errorf("counter observation day percentage = %v, want 0", resp.Quality.CounterObservationDayPct)
	}
	if resp.Quality.DaysWithoutCounterObservation != 7 {
		t.Errorf(
			"days without counter observation = %d, want 7",
			resp.Quality.DaysWithoutCounterObservation,
		)
	}
	if resp.Quality.FirstObservationAt != nil || resp.Quality.LastObservationAt != nil {
		t.Error("observation bounds must stay nil for an empty period")
	}
	if resp.Quality.FSDFirstObservationAt != nil || resp.Quality.FSDLastObservationAt != nil {
		t.Error("fsd observation bounds must stay nil for an empty period")
	}
	if resp.Period.StartDate != "2026-03-01" || resp.Period.EndDate != "2026-03-07" {
		t.Errorf("period = %s..%s", resp.Period.StartDate, resp.Period.EndDate)
	}
}

func TestAggregate_ZeroDaysIsNormalisedToOne(t *testing.T) {
	resp := Aggregate(AggregateParams{
		VehicleID: 1,
		Days:      0,
		Start:     at(t, "2026-03-01T00:00:00Z"),
		End:       at(t, "2026-03-01T10:00:00Z"),
	})

	if len(resp.Daily) != 1 || resp.Totals.DaysInPeriod != 1 {
		t.Fatalf("days = %d / series = %d, want 1/1", resp.Totals.DaysInPeriod, len(resp.Daily))
	}
	if resp.Period.Timezone != "UTC" {
		t.Errorf("nil location must fall back to UTC, got %q", resp.Period.Timezone)
	}
}

// ---------------------------------------------------------------------------
// per-day denominator locality
// ---------------------------------------------------------------------------

func TestAggregate_DayWithoutDrivingObservationsHasNullDenominator(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(0)),
		drivingSample(t, "2026-02-28T22:00:00Z", fp(0)),
		// Day 1 emits the FSD counter only.
		fsdSample(t, "2026-03-01T09:00:00Z", fp(300)),
		// Day 2 emits both.
		fsdSample(t, "2026-03-02T09:00:00Z", fp(500)),
		drivingSample(t, "2026-03-02T09:00:00Z", fp(2000)),
	}))

	day1 := dayOf(t, resp, "2026-03-01")
	wantMeasured(t, day1.FSDDistanceM, 300, "day1 fsd")
	wantUnmeasured(t, day1.DrivingDistanceM, "day1 driving (counter did not report)")
	wantUnmeasured(t, day1.FSDSharePct, "day1 share")

	day2 := dayOf(t, resp, "2026-03-02")
	wantMeasured(t, day2.DrivingDistanceM, 2000, "day2 driving")
	wantMeasured(t, day2.FSDSharePct, 10, "day2 share")

	if !resp.Quality.DrivingDenominatorAvailable {
		t.Error("denominator should be available for the period")
	}
}

func TestAggregate_BestDayPicksTheLargestFsdDay(t *testing.T) {
	resp := Aggregate(utcParams(t, []Sample{
		fsdSample(t, "2026-02-28T22:00:00Z", fp(0)),
		fsdSample(t, "2026-03-01T09:00:00Z", fp(900)),
		fsdSample(t, "2026-03-02T09:00:00Z", fp(1000)),
		fsdSample(t, "2026-03-03T09:00:00Z", fp(3000)),
	}))

	if resp.Totals.BestDay == nil {
		t.Fatal("best day must be populated")
	}
	if resp.Totals.BestDay.Date != "2026-03-03" || !approx(resp.Totals.BestDay.FSDDistanceM, 2000) {
		t.Errorf("best day = %+v, want 2026-03-03 / 2000", resp.Totals.BestDay)
	}
	if resp.Totals.ActiveDays != 3 {
		t.Errorf("active days = %d, want 3", resp.Totals.ActiveDays)
	}
}

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

func TestValidCounterValue(t *testing.T) {
	nan := math.NaN()
	negInf := math.Inf(-1)
	cases := []struct {
		name string
		in   *float64
		ok   bool
	}{
		{"nil", nil, false},
		{"nan", &nan, false},
		{"neg-inf", &negInf, false},
		{"negative", fp(-0.5), false},
		{"zero", fp(0), true},
		{"positive", fp(12.5), true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := validCounterValue(tc.in); ok != tc.ok {
				t.Errorf("ok = %v, want %v", ok, tc.ok)
			}
		})
	}
}

func TestSharePct(t *testing.T) {
	if got, clamped := sharePct(fp(10), nil); got != nil || clamped {
		t.Errorf("nil denominator: got %v clamped=%v", got, clamped)
	}
	if got, _ := sharePct(nil, fp(200)); got != nil {
		t.Errorf("unmeasured numerator must not produce a share, got %v", *got)
	}
	if got, _ := sharePct(fp(10), fp(0)); got != nil {
		t.Errorf("zero denominator: got %v, want nil", got)
	}
	got, clamped := sharePct(fp(25), fp(200))
	if got == nil || !approx(*got, 12.5) || clamped {
		t.Errorf("share = %v clamped=%v, want 12.5/false", got, clamped)
	}
}

func TestCounterState_ReportedAndDerivable(t *testing.T) {
	baselineOnly := accumulate([]Sample{
		fsdSample(t, "2026-02-20T10:00:00Z", fp(500)),
	}, at(t, "2026-03-01T00:00:00Z"), time.UTC)
	if baselineOnly.reported() {
		t.Error("a pre-window baseline alone must not count as reported")
	}
	if baselineOnly.derivable() {
		t.Error("a pre-window baseline alone is not derivable")
	}

	baselinePlusOne := accumulate([]Sample{
		fsdSample(t, "2026-02-20T10:00:00Z", fp(500)),
		fsdSample(t, "2026-03-02T10:00:00Z", fp(700)),
	}, at(t, "2026-03-01T00:00:00Z"), time.UTC)
	if !baselinePlusOne.reported() || !baselinePlusOne.derivable() {
		t.Error("baseline + one in-window observation must be reported and derivable")
	}

	loneInWindow := accumulate([]Sample{
		fsdSample(t, "2026-03-02T10:00:00Z", fp(700)),
	}, at(t, "2026-03-01T00:00:00Z"), time.UTC)
	if !loneInWindow.reported() {
		t.Error("one in-window observation is reporting")
	}
	if loneInWindow.derivable() {
		t.Error("one in-window observation without a baseline is not derivable")
	}
}
