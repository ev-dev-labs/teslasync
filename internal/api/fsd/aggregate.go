package fsd

import (
	"math"
	"sort"
	"time"

	signalcounter "github.com/ev-dev-labs/teslasync/internal/signal/counter"
)

// dayLayout is the local calendar-day grouping key used everywhere in the
// response. Lexical sort order equals chronological order, which lets the
// frontend sort without parsing.
const dayLayout = "2006-01-02"

// AggregateParams is the pure input to Aggregate. Everything the aggregation
// needs is data — no clock, no database, no request — so the whole derivation
// is unit-testable without a server.
type AggregateParams struct {
	VehicleID int64
	// Days is the number of dense local calendar days in the period,
	// inclusive of EndDate. Values below 1 are treated as 1.
	Days int
	// Loc is the validated IANA location used for calendar-day attribution.
	// Nil falls back to UTC.
	Loc *time.Location
	// Start is the first valid instant of the first local civil day in the
	// period; End is the exclusive upper bound of the window (usually "now").
	Start time.Time
	End   time.Time
	// Samples carries both counters, and both the pre-window baselines
	// (TS < Start) and the in-window observations. Order does not matter.
	Samples []Sample
}

// counterState is the reset-safe per-counter accumulation result.
type counterState struct {
	perDayMeters  map[string]float64
	perDayObs     map[string]int
	perDayResets  map[string]int
	perDayDerived map[string]bool

	totalMeters float64
	samples     int
	invalid     int
	duplicates  int
	resets      int

	baselineAvailable bool
	derived           bool
	firstAt           *time.Time
	lastAt            *time.Time
}

func newCounterState() *counterState {
	return &counterState{
		perDayMeters:  make(map[string]float64),
		perDayObs:     make(map[string]int),
		perDayResets:  make(map[string]int),
		perDayDerived: make(map[string]bool),
	}
}

// reported reports whether the counter emitted at least one VALID observation
// inside the requested window.
//
// A pre-window baseline alone does not count: it proves the counter existed at
// some point in the past, not that the vehicle reported it during the period
// the operator is looking at. Treating a lone baseline as "reported" is what
// makes an unequipped or silent counter masquerade as a measured zero.
func (c *counterState) reported() bool { return c.samples > 0 }

// derivable reports whether at least one delta could be computed inside the
// window: an in-window observation plus an anchor to difference it against
// (either a pre-window baseline or an earlier in-window observation).
//
// Without that there is no honest distance to report — only an unattributable
// absolute counter reading.
func (c *counterState) derivable() bool {
	return c.reported() && c.derived
}

// commonShareBasis reports whether the two cumulative counters begin from
// the same provable point. Two pre-window baselines both establish state at
// the requested window boundary even when the underlying change-feed rows
// have different timestamps. Without baselines, the first accepted
// observations must be simultaneous anchors; otherwise dividing the totals
// would compare distances accumulated over different spans.
func commonShareBasis(fsd, driving *counterState) bool {
	if !fsd.derivable() || !driving.derivable() {
		return false
	}
	if fsd.baselineAvailable || driving.baselineAvailable {
		return fsd.baselineAvailable && driving.baselineAvailable
	}
	return fsd.firstAt != nil &&
		driving.firstAt != nil &&
		fsd.firstAt.Equal(*driving.firstAt)
}

// measuredDay reports whether `day` (a local calendar-day key) carries a
// MEASURED distance for this counter, as opposed to "not reported".
//
// Two conditions must hold:
//
//   - the counter produced a trusted, valid observation on that day; and
//   - that observation had an uninterrupted trusted value to difference
//     against.
//
// The second condition is what makes a genuine zero expressible without
// turning a missing emission into manual driving. The synchronized Fleet
// Telemetry subscription includes the current FSD counter whenever the driving
// counter advances; older data may not. Only an actual FSD observation can
// therefore prove an unchanged value.
func (c *counterState) measuredDay(day string, counterObserved bool) bool {
	return c.derivable() && counterObserved && c.perDayDerived[day]
}

func trustedNormalization(sample Sample) bool {
	return sample.NormalizationVersion != nil &&
		*sample.NormalizationVersion >= trustedSignalLogNormalizationVersion
}

// validCounterValue accepts only values a cumulative distance counter can
// legitimately hold: present, finite, and non-negative. Everything else is an
// invalid sample that must not move the accumulator forward — using it as the
// new `prev` would fabricate an enormous delta on the next observation.
func validCounterValue(v *float64) (float64, bool) {
	if v == nil {
		return 0, false
	}
	f := *v
	if !signalcounter.Valid(f) {
		return 0, false
	}
	return f, true
}

func applyCompactedObservationStats(
	state *counterState,
	sample Sample,
	loc *time.Location,
) {
	validCount := max(sample.ValidObservationCount, 0)
	invalidCount := max(sample.InvalidObservationCount, 0)
	state.samples += validCount
	state.invalid += invalidCount
	if validCount > 0 {
		state.perDayObs[sample.TS.In(loc).Format(dayLayout)] += validCount
	}
	if sample.FirstValidObservationAt != nil &&
		(state.firstAt == nil || sample.FirstValidObservationAt.Before(*state.firstAt)) {
		first := *sample.FirstValidObservationAt
		state.firstAt = &first
	}
	if sample.LastValidObservationAt != nil &&
		(state.lastAt == nil || sample.LastValidObservationAt.After(*state.lastAt)) {
		last := *sample.LastValidObservationAt
		state.lastAt = &last
	}
}

// accumulate folds one counter's change feed into per-day meters.
//
// Rules (all deliberate, all covered by aggregate_test.go):
//
//   - Samples are processed in timestamp order; the newest trusted, valid
//     pre-window sample becomes the baseline only if no later rejected row
//     breaks continuity.
//   - An untrusted or invalid row clears the previous value. The next trusted
//     value is a fresh anchor, preventing deltas from bridging unknown units,
//     corrupt values, or a reset hidden by a rejected observation.
//   - A delta is only produced when a previous accepted value exists, so the
//     first in-window observation without a baseline contributes nothing and
//     does not open the attributable span.
//   - A non-negative delta is attributed in full to the local calendar day of
//     the LATER sample.
//   - A negative delta is a counter reset: it is recorded, and contributes
//     exactly zero distance. The post-reset absolute value is NOT treated as
//     distance travelled, because the distance accumulated between the reset
//     and the next emission is unknowable. A reset still opens/extends the
//     attributable span — the counter is demonstrably reporting.
//   - A sample whose timestamp does not advance is a duplicate/out-of-order
//     redelivery and is skipped without touching the accumulator.
func accumulate(samples []Sample, start time.Time, loc *time.Location) *counterState {
	state := newCounterState()

	ordered := samples
	if !sort.SliceIsSorted(ordered, func(i, j int) bool {
		return ordered[i].TS.Before(ordered[j].TS)
	}) {
		ordered = append([]Sample(nil), samples...)
		sort.SliceStable(ordered, func(i, j int) bool {
			return ordered[i].TS.Before(ordered[j].TS)
		})
	}

	var prev *float64
	var prevTS time.Time

	for _, s := range ordered {
		inWindow := !s.TS.Before(start)
		if inWindow && s.Compacted {
			applyCompactedObservationStats(state, s, loc)
		}
		if !trustedNormalization(s) {
			// A row whose unit provenance is unknown is a continuity barrier:
			// differencing trusted values across it could bridge a hidden reset
			// or mix wire units.
			prev = nil
			if !inWindow {
				state.baselineAvailable = false
			}
			continue
		}

		value, ok := validCounterValue(s.Value)
		if !ok {
			if inWindow && !s.Compacted {
				state.invalid++
			}
			// Invalid observations are also barriers. The next valid row is a
			// fresh anchor, never a delta against stale pre-error state.
			prev = nil
			if !inWindow {
				state.baselineAvailable = false
			}
			continue
		}

		if !inWindow {
			// Newest pre-window sample wins (slice is ascending).
			v := value
			prev = &v
			prevTS = s.TS
			state.baselineAvailable = true
			continue
		}

		if prev != nil && !s.TS.After(prevTS) {
			state.duplicates++
			continue
		}

		day := s.TS.In(loc).Format(dayLayout)
		if !s.Compacted {
			state.samples++
			state.perDayObs[day]++
			observedAt := s.TS
			if state.firstAt == nil {
				state.firstAt = &observedAt
			}
			state.lastAt = &observedAt
		}

		if prev != nil {
			state.derived = true
			state.perDayDerived[day] = true
			change := signalcounter.Compare(*prev, value)
			switch change.Kind {
			case signalcounter.ChangeReset:
				state.resets++
				state.perDayResets[day]++
			case signalcounter.ChangeAdvanced:
				state.perDayMeters[day] += change.Delta
				state.totalMeters += change.Delta
			}
		}

		v := value
		prev = &v
		prevTS = s.TS
	}

	return state
}

// Aggregate derives the complete FSD Insights response from raw change-feed
// samples. It is pure: same input, same output, no I/O.
func Aggregate(params AggregateParams) Response {
	loc := params.Loc
	if loc == nil {
		loc = time.UTC
	}
	days := params.Days
	if days < 1 {
		days = 1
	}

	fieldCapacity := len(params.Samples)/2 + 1
	fsdSamples := make([]Sample, 0, fieldCapacity)
	drivingSamples := make([]Sample, 0, fieldCapacity)
	var fsdUntrusted, drivingUntrusted int
	for _, s := range params.Samples {
		if !s.TS.Before(params.End) {
			continue
		}
		switch s.Field {
		case SignalFSDDistance:
			if s.Compacted {
				if !s.TS.Before(params.Start) {
					fsdUntrusted += max(s.UntrustedObservationCount, 0)
				}
			} else if !trustedNormalization(s) {
				if !s.TS.Before(params.Start) {
					fsdUntrusted++
				}
			}
			fsdSamples = append(fsdSamples, s)
		case SignalDrivingDistance:
			if s.Compacted {
				if !s.TS.Before(params.Start) {
					drivingUntrusted += max(s.UntrustedObservationCount, 0)
				}
			} else if !trustedNormalization(s) {
				if !s.TS.Before(params.Start) {
					drivingUntrusted++
				}
			}
			drivingSamples = append(drivingSamples, s)
		}
	}

	fsd := accumulate(fsdSamples, params.Start, loc)
	driving := accumulate(drivingSamples, params.Start, loc)
	denominator := driving.derivable()
	fsdDerivable := fsd.derivable()
	shareBasisAvailable := commonShareBasis(fsd, driving) &&
		fsd.invalid == 0 &&
		driving.invalid == 0 &&
		fsd.resets == 0 &&
		driving.resets == 0 &&
		fsdUntrusted == 0 &&
		drivingUntrusted == 0

	dayKeys := denseDayKeys(params.Start, days, loc)
	daily := make([]DailyPoint, 0, len(dayKeys))

	var activeDays, counterObservationDays, measuredDays int
	var best *BestDay
	dayShareClamped := false

	for _, day := range dayKeys {
		fsdObs := fsd.perDayObs[day]
		drivingObs := driving.perDayObs[day]
		hasCounterObservation := fsdObs > 0 || drivingObs > 0

		// A measured zero and "the self-driving counter said nothing" are
		// different facts, so the value is a pointer and stays nil for the
		// latter. See counterState.measuredDay.
		var fsdMeters *float64
		if fsd.measuredDay(day, fsdObs > 0) {
			m := roundMeters(fsd.perDayMeters[day])
			fsdMeters = &m
		}

		var drivingMeters *float64
		if denominator && driving.measuredDay(day, drivingObs > 0) {
			m := roundMeters(driving.perDayMeters[day])
			drivingMeters = &m
		}

		var share *float64
		var clampedDay bool
		if shareBasisAvailable {
			share, clampedDay = sharePct(fsdMeters, drivingMeters)
		}
		if clampedDay {
			dayShareClamped = true
		}

		point := DailyPoint{
			Date:                    day,
			FSDDistanceM:            fsdMeters,
			DrivingDistanceM:        drivingMeters,
			FSDSharePct:             share,
			FSDObservationCount:     fsdObs,
			DrivingObservationCount: drivingObs,
			ResetCount:              fsd.perDayResets[day] + driving.perDayResets[day],
			HasCounterObservation:   hasCounterObservation,
		}
		daily = append(daily, point)

		if hasCounterObservation {
			counterObservationDays++
		}
		if fsdMeters != nil {
			measuredDays++
		}
		if fsdMeters != nil && *fsdMeters > 0 {
			activeDays++
			if best == nil || *fsdMeters > best.FSDDistanceM {
				best = &BestDay{
					Date:             day,
					FSDDistanceM:     *fsdMeters,
					DrivingDistanceM: drivingMeters,
					FSDSharePct:      share,
				}
			}
		}
	}

	// The period total is only a number when the counter actually reported
	// inside the window AND a delta could be derived. Everything downstream
	// (share, averages, the KPI band) inherits that nil.
	var totalFSD *float64
	if fsdDerivable {
		m := roundMeters(fsd.totalMeters)
		totalFSD = &m
	}
	var totalDriving *float64
	if denominator {
		m := roundMeters(driving.totalMeters)
		totalDriving = &m
	}
	var totalShare *float64
	var clampedTotal bool
	if shareBasisAvailable {
		totalShare, clampedTotal = sharePct(totalFSD, totalDriving)
	}

	totals := Totals{
		FSDDistanceM:     totalFSD,
		DrivingDistanceM: totalDriving,
		FSDSharePct:      totalShare,
		ActiveDays:       activeDays,
		MeasuredDays:     measuredDays,
		DaysInPeriod:     days,
		BestDay:          best,
	}
	if totalFSD != nil && measuredDays > 0 {
		avg := roundMeters(*totalFSD / float64(measuredDays))
		totals.AvgMeasuredDayFSDDistanceM = &avg
		if activeDays > 0 {
			avgActive := roundMeters(*totalFSD / float64(activeDays))
			totals.AvgActiveDayFSDDistanceM = &avgActive
		}
	}

	quality := Quality{
		FSDSampleCount:                fsd.samples,
		DrivingSampleCount:            driving.samples,
		FSDInvalidSampleCount:         fsd.invalid,
		DrivingInvalidSampleCount:     driving.invalid,
		FSDDuplicateSampleCount:       fsd.duplicates,
		DrivingDuplicateSampleCount:   driving.duplicates,
		FSDResetCount:                 fsd.resets,
		DrivingResetCount:             driving.resets,
		FSDBaselineAvailable:          fsd.baselineAvailable,
		DrivingBaselineAvailable:      driving.baselineAvailable,
		FSDReportedInPeriod:           fsd.reported(),
		DrivingReportedInPeriod:       driving.reported(),
		FSDDistanceDerivable:          fsdDerivable,
		DrivingDenominatorAvailable:   denominator,
		ShareBasisAvailable:           shareBasisAvailable,
		FSDMeasuredDays:               measuredDays,
		HistoricalDataGuarded:         true,
		RequiredNormalizationVersion:  trustedSignalLogNormalizationVersion,
		FSDUntrustedSampleCount:       fsdUntrusted,
		DrivingUntrustedSampleCount:   drivingUntrusted,
		CounterObservationDays:        counterObservationDays,
		DaysWithoutCounterObservation: days - counterObservationDays,
		CounterObservationDayPct:      roundPct(float64(counterObservationDays) / float64(days) * 100),
		FirstObservationAt:            earliest(fsd.firstAt, driving.firstAt),
		LastObservationAt:             latest(fsd.lastAt, driving.lastAt),
		FSDFirstObservationAt:         fsd.firstAt,
		FSDLastObservationAt:          fsd.lastAt,
		ShareClamped:                  clampedTotal || dayShareClamped,
	}

	endDateAt := params.End
	if params.End.After(params.Start) {
		endDateAt = params.End.Add(-time.Nanosecond)
	}

	return Response{
		VehicleID: params.VehicleID,
		Period: Period{
			Days:      days,
			Timezone:  loc.String(),
			StartDate: params.Start.In(loc).Format(dayLayout),
			EndDate:   endDateAt.In(loc).Format(dayLayout),
			StartAt:   params.Start.UTC(),
			EndAt:     params.End.UTC(),
		},
		Totals:  totals,
		Quality: quality,
		Daily:   daily,
	}
}

// denseDayKeys returns `days` consecutive local calendar-day keys starting at
// the local day containing `start`. UTC-backed civil arithmetic deliberately
// avoids local midnight, which can be nonexistent during a 00:00 DST change.
func denseDayKeys(start time.Time, days int, loc *time.Location) []string {
	cursor := civilDateAt(start, loc)
	keys := make([]string, 0, days)
	for i := 0; i < days; i++ {
		keys = append(keys, cursor.key())
		cursor = cursor.addDays(1)
	}
	return keys
}

// sharePct computes supervised-self-driving share of observed driving.
//
// Returns nil when either side is unavailable or the denominator is
// non-positive: a share of an unknown (or zero) total is not zero, it is
// unknown, and a share computed from an UNMEASURED numerator would invent an
// adoption figure the telemetry never supported. The second return value
// reports whether the raw ratio exceeded 100% and had to be clamped, which
// happens only when the two counters were reset independently inside the
// window.
func sharePct(fsdMeters, drivingMeters *float64) (*float64, bool) {
	if fsdMeters == nil || drivingMeters == nil || *drivingMeters <= 0 {
		return nil, false
	}
	raw := *fsdMeters / *drivingMeters * 100
	if math.IsNaN(raw) || math.IsInf(raw, 0) {
		return nil, false
	}
	clamped := false
	if raw > 100 {
		raw = 100
		clamped = true
	}
	if raw < 0 {
		raw = 0
	}
	value := roundPct(raw)
	return &value, clamped
}

// roundMeters trims IEEE-754 accumulation noise to millimetre precision so
// two mathematically identical periods serialize identically.
func roundMeters(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*1000) / 1000
}

func roundPct(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return math.Round(v*100) / 100
}

func earliest(a, b *time.Time) *time.Time {
	switch {
	case a == nil:
		return b
	case b == nil:
		return a
	case b.Before(*a):
		return b
	default:
		return a
	}
}

func latest(a, b *time.Time) *time.Time {
	switch {
	case a == nil:
		return b
	case b == nil:
		return a
	case b.After(*a):
		return b
	default:
		return a
	}
}
