package fsd

import "time"

// Canonical signal_log field names this endpoint reads. Both are
// SI-canonical (meters) on disk — see internal/tesla/units.
const (
	// trustedSignalLogNormalizationVersion is the minimum row-level
	// provenance accepted by this endpoint. Version 1 means the Tesla
	// field-specific wire-unit rules were applied before canonical SI
	// persistence (migration 000232).
	trustedSignalLogNormalizationVersion int16 = 1

	// SignalFSDDistance is the resettable supervised-self-driving distance
	// counter (proto enum 259, ValueKindFloat + UnitKindDistance).
	SignalFSDDistance = "SelfDrivingMilesSinceReset"
	// SignalDrivingDistance is the resettable total observed-driving
	// distance counter used as the share denominator.
	SignalDrivingDistance = "MilesSinceReset"
)

// Sample is one raw signal_log observation of a distance counter.
//
// Value is a pointer because signal_log stores one typed column per
// ValueKind: a row whose float_value and int_value are both NULL scans as
// nil here and must be treated as an invalid sample rather than as zero.
type Sample struct {
	Field                string
	TS                   time.Time
	Value                *float64
	NormalizationVersion *int16
}

// Period describes the window the response covers.
//
// StartDate/EndDate are local calendar dates (YYYY-MM-DD) in Timezone, which
// is the same grouping key used by every entry in Daily. StartAt/EndAt are
// the absolute UTC instants those local bounds resolve to, so a client can
// reproduce the exact query window.
type Period struct {
	Days      int       `json:"days"`
	Timezone  string    `json:"timezone"`
	StartDate string    `json:"start_date"`
	EndDate   string    `json:"end_date"`
	StartAt   time.Time `json:"start_at"`
	EndAt     time.Time `json:"end_at"`
}

// BestDay is the single local day with the most supervised self-driving
// distance in the period. Nil when no day accumulated any.
type BestDay struct {
	Date             string   `json:"date"`
	FSDDistanceM     float64  `json:"fsd_distance_m"`
	DrivingDistanceM *float64 `json:"driving_distance_m"`
	FSDSharePct      *float64 `json:"fsd_share_pct"`
}

// Totals is the period-level rollup. Every distance is canonical SI meters.
//
// FSDDistanceM and DrivingDistanceM are BOTH pointers because each counter is
// genuinely optional. A vehicle that never emitted SelfDrivingMilesSinceReset
// inside the window has no derivable supervised self-driving distance, and
// reporting 0 there would turn "the car never told us" into "the car never
// drove itself" — two very different facts. A pre-window baseline alone does
// not rescue it: it proves the counter existed once, not that it reported
// during the period on screen.
type Totals struct {
	FSDDistanceM     *float64 `json:"fsd_distance_m"`
	DrivingDistanceM *float64 `json:"driving_distance_m"`
	FSDSharePct      *float64 `json:"fsd_share_pct"`
	ActiveDays       int      `json:"active_days"`
	// MeasuredDays counts days whose fsd_distance_m is a measurement rather
	// than null — the honest denominator for "how much of this period can the
	// self-driving counter actually speak about".
	MeasuredDays int `json:"measured_days"`
	DaysInPeriod int `json:"days_in_period"`
	// AvgMeasuredDayFSDDistanceM excludes null days rather than silently
	// converting missing counter evidence into measured zeros.
	AvgMeasuredDayFSDDistanceM *float64 `json:"avg_measured_day_fsd_distance_m"`
	AvgActiveDayFSDDistanceM   *float64 `json:"avg_active_day_fsd_distance_m"`
	BestDay                    *BestDay `json:"best_day"`
}

// Quality carries the trust metadata a serious dashboard needs to decide how
// much weight to put on Totals. None of these fields are cosmetic: a period
// with a reset or missing baseline produces arithmetic that is conservative by
// construction, and the operator has to be able to see that. Counter
// observation frequency is descriptive only because this is a sparse
// change feed, not a connectivity monitor.
type Quality struct {
	// Counts of VALID in-window observations actually used for deltas.
	FSDSampleCount     int `json:"fsd_sample_count"`
	DrivingSampleCount int `json:"driving_sample_count"`
	// Rows rejected inside the window: nil / non-finite / negative values.
	FSDInvalidSampleCount     int `json:"fsd_invalid_sample_count"`
	DrivingInvalidSampleCount int `json:"driving_invalid_sample_count"`
	// Rows skipped because their timestamp did not advance (duplicate or
	// out-of-order redelivery).
	FSDDuplicateSampleCount     int `json:"fsd_duplicate_sample_count"`
	DrivingDuplicateSampleCount int `json:"driving_duplicate_sample_count"`
	// Counter resets observed (a strictly decreasing value). The decrease
	// itself is never converted into distance.
	FSDResetCount     int `json:"fsd_reset_count"`
	DrivingResetCount int `json:"driving_reset_count"`
	// Whether an observation existed BEFORE the window, which is what makes
	// the first in-window observation attributable at all.
	FSDBaselineAvailable     bool `json:"fsd_baseline_available"`
	DrivingBaselineAvailable bool `json:"driving_baseline_available"`
	// Whether each counter emitted at least one VALID observation INSIDE the
	// requested window. A baseline alone is deliberately not enough: it
	// proves the counter existed at some point, not that the vehicle reported
	// it during the period the operator selected.
	FSDReportedInPeriod     bool `json:"fsd_reported_in_period"`
	DrivingReportedInPeriod bool `json:"driving_reported_in_period"`
	// Whether a supervised self-driving distance could be derived at all.
	// When false, every fsd_distance_m in this response is null.
	FSDDistanceDerivable bool `json:"fsd_distance_derivable"`
	// Whether observed-driving distance could be derived at all.
	DrivingDenominatorAvailable bool `json:"driving_denominator_available"`
	// Whether both counters share a provable start basis. Usage-share values
	// remain null when false even if each standalone distance is derivable.
	ShareBasisAvailable bool `json:"share_basis_available"`
	// Days whose fsd_distance_m is a measurement rather than null.
	FSDMeasuredDays int `json:"fsd_measured_days"`

	// HistoricalDataGuarded confirms that only rows carrying a proven
	// canonical normalization contract contributed to distance arithmetic.
	// The excluded counts make conservative omissions visible instead of
	// silently rescaling legacy telemetry.
	HistoricalDataGuarded        bool  `json:"historical_data_guarded"`
	RequiredNormalizationVersion int16 `json:"required_normalization_version"`
	FSDUntrustedSampleCount      int   `json:"fsd_untrusted_sample_count"`
	DrivingUntrustedSampleCount  int   `json:"driving_untrusted_sample_count"`

	CounterObservationDays        int     `json:"counter_observation_days"`
	DaysWithoutCounterObservation int     `json:"days_without_counter_observation"`
	CounterObservationDayPct      float64 `json:"counter_observation_day_pct"`

	FirstObservationAt *time.Time `json:"first_observation_at"`
	LastObservationAt  *time.Time `json:"last_observation_at"`
	// Bounds of the SELF-DRIVING counter specifically, so a dashboard can
	// tell "the vehicle was reporting" from "this particular counter was
	// reporting".
	FSDFirstObservationAt *time.Time `json:"fsd_first_observation_at"`
	FSDLastObservationAt  *time.Time `json:"fsd_last_observation_at"`

	// ShareClamped is true when a raw share exceeded 100% — only possible
	// when the two counters were reset independently — and was clamped.
	ShareClamped bool `json:"share_clamped"`
}

// DailyPoint is one local calendar day. The series is dense: every day in
// the period is present, including days on which neither distance counter
// emitted an observation.
//
// FSDDistanceM is a POINTER. It is non-null only when the day carries a
// measurement:
//
//   - the self-driving counter produced at least one delta at or before this
//     day (so the day sits inside the span the counter can speak about), and
//   - at least one of the two distance counters emitted a valid observation
//     on this day (HasCounterObservation).
//
// The second condition is what makes a genuine zero expressible: Tesla only
// transmits a field when its value CHANGES, so a day on which the driving
// counter reported and the self-driving counter did not move is a measured
// zero. A day with neither counter is null — sparse counter data is not
// evidence of absence of self-driving.
type DailyPoint struct {
	Date                    string   `json:"date"`
	FSDDistanceM            *float64 `json:"fsd_distance_m"`
	DrivingDistanceM        *float64 `json:"driving_distance_m"`
	FSDSharePct             *float64 `json:"fsd_share_pct"`
	FSDObservationCount     int      `json:"fsd_observation_count"`
	DrivingObservationCount int      `json:"driving_observation_count"`
	ResetCount              int      `json:"reset_count"`
	HasCounterObservation   bool     `json:"has_counter_observation"`
}

// Response is the GET /api/v1/analytics/fsd payload.
type Response struct {
	VehicleID int64        `json:"vehicle_id"`
	Period    Period       `json:"period"`
	Totals    Totals       `json:"totals"`
	Quality   Quality      `json:"quality"`
	Daily     []DailyPoint `json:"daily"`
}
