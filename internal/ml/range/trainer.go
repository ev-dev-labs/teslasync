// Package mlrange contains deterministic per-vehicle range-prediction training.
//
// The trainer
// computes a per-vehicle range-prediction model: a per-bucket
// (temp_bucket × speed_bucket) Wh/km envelope (mean, stddev, p5,
// p95) over a recent window of `drives` rows, with per-bucket
// fallback to the deterministic [HeuristicWhPerKm] curve when fewer
// than [DefaultMinSamplesPerBucket] drives exist in a given bucket.
//
// The trainer's contract:
//
//   - When a bucket has at least [Trainer.MinSamples] drives in the
//     window, the LearnedBucket.Source is "learned" and Wh/km is the
//     per-bucket mean of `energy_used_wh / (distance_m / 1000)`,
//     with stddev / p5 / p95 also reported.
//
//   - When a bucket has fewer than MinSamples drives, the
//     LearnedBucket.Source is "linear_fallback" and Wh/km is the
//     pure-function-of-bucket [HeuristicWhPerKm] value (the SAME
//     number the deterministic RangeProjectionHandler.buildScenarios
//     returns for that bucket — pinned by the parity test). The
//     narrator EXPLAINS that the linear fallback is in effect for
//     this bucket, so the user knows the per-vehicle model did not
//     yet have enough data.
//
//   - SampleCount and the Source label are surfaced on the
//     LearnedBucket DTO so the AI narrator can quote them honestly
//     ("only 3 drives in the freezing/highway bucket — falling back
//     to the heuristic 263 Wh/km").
//
// The trainer never mutates the `drives` table or persists any
// learned bucket. It is a one-shot statistical projection over the
// rows the [DriveStatsSource] returns. A future ai_ml_range_trainer job may
// persist the learned model per vehicle for cross-pod reuse; the current path
// is request-scoped and recomputes on demand.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic RangeProjectionHandler
//     (and the static heuristic curve it falls back to) is unchanged.
//     The learned model is an OPT-IN narrative add-on; off-mode users
//     never see it.
//   - I4 zero egress:    Train() reads only the local database via
//     the DriveStatsSource interface; it never calls a provider.
//   - I7 per-feature:    the AI route that drives Train() is gated
//     by guard.Wrap("range-prediction-model").
//   - I9 redaction:      vehicle_id is the only PII the trainer
//     consumes; the LearnedBucket DTO surfaces only bucket names +
//     numeric statistics. The AI route applies PolicyChatbot
//     (deny-all redaction) on top.
package mlrange

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"
)

// SourceLearned marks a per-bucket LearnedBucket whose Wh/km was
// derived from at least [Trainer.MinSamples] observed drives.
const SourceLearned = "learned"

// SourceLinearFallback marks a per-bucket LearnedBucket that fell
// back to [HeuristicWhPerKm] because fewer than [Trainer.MinSamples]
// drives existed in the lookback window for that bucket.
const SourceLinearFallback = "linear_fallback"

// DefaultMinSamplesPerBucket is the minimum drive count required
// for the trainer to emit a learned per-bucket Wh/km rather than
// the heuristic fallback. Keeps each bucket statistically defensible
// — at the 5-sample floor a single outlier drive can swing the
// bucket mean by 20%+, which would over-promise the model.
//
// Five was chosen rather than the 30-sample floor used by the
// per-signal anomaly detector: drives are O(1-5/day) per vehicle so
// 30 per bucket would require ~6 months of data per bucket per
// vehicle, which would route every bucket through the fallback in
// practice. The narrator's system prompt mandates honest reporting
// of per-bucket sample counts so the user sees "5 drives" alongside
// the proposed bucket Wh/km.
const DefaultMinSamplesPerBucket = 5

// DefaultDays is the lookback window the trainer uses when the AI
// handler's request body omits the days knob. 14 days captures a
// representative weekly cadence (commute + weekend) without mixing
// seasons — the ProjectedRangePage's accuracy_note quotes "based on
// N drives" rather than a window in days, so this is an
// AI-handler-side default rather than a user-visible knob.
const DefaultDays = 14

// MaxDays caps the lookback window an AI handler may request. The
// learned model over a 30-day window is the upper bound for
// statistical relevance under typical Tesla telemetry density;
// longer windows risk mixing seasons.
const MaxDays = 30

// LearnedBucket is the per-bucket envelope the trainer emits.
// The DTO is the single source of truth shared by:
//
//   - the trainer's Train() output;
//   - the AI tools train_range_model + query_range_prediction;
//   - the eval harness's canned mock provider replies.
//
// Source is one of [SourceLearned] / [SourceLinearFallback].
//
// Stddev / P5 / P95 are populated only when Source is
// SourceLearned; they are all zero when the linear fallback is in
// effect. SampleCount is the number of drives the trainer
// considered for this bucket in the requested window — useful for
// the narrator to honestly report "we had only N drives in this
// bucket" alongside the fallback.
type LearnedBucket struct {
	TempBucket  string  `json:"temp_bucket"`
	SpeedBucket string  `json:"speed_bucket"`
	Source      string  `json:"source"`
	WhPerKm     float64 `json:"wh_per_km"`
	Stddev      float64 `json:"stddev"`
	P5          float64 `json:"p5"`
	P95         float64 `json:"p95"`
	SampleCount int     `json:"sample_count"`
}

// DriveSample is one drive's contribution to the trainer.
//
// Wh/km is computed at the source (the pgx adapter or the test
// fake) so the trainer is unit-agnostic — it never has to know that
// the database stores energy in Wh and distance in meters. The
// adapter computes `energy_used_wh / (distance_m / 1000.0)` and
// passes the Wh/km here.
type DriveSample struct {
	WhPerKm     float64
	AvgSpeedKmh float64
	AmbientTemp float64
}

// DriveStatsSource is the narrow read interface the trainer needs
// to pull per-vehicle drive samples out of the `drives` table. In
// production it is satisfied by a thin pgx-backed adapter whose
// query is approximately:
//
//	SELECT distance_m,
//	       duration_s,
//	       energy_used_wh,
//	       avg_speed_mps,
//	       ambient_temp_c_avg
//	FROM drives
//	WHERE vehicle_id = $1
//	  AND started_at > $2
//	  AND distance_m > 0
//	  AND energy_used_wh IS NOT NULL AND energy_used_wh > 0
//	  AND avg_speed_mps IS NOT NULL
//	  AND ambient_temp_c_avg IS NOT NULL
//	  AND start_soc_pct > end_soc_pct
//
// (the same `drives` columns the deterministic RangeProjectionHandler
// at internal/api/range_projection_handler.go already reads; the
// trainer reads the SAME table, no new SQL semantics).
//
// The adapter computes wh/km + km/h + °C in Go and returns []DriveSample
// so the trainer never knows about meters / seconds / m/s. Tests
// substitute a deterministic in-memory fake.
type DriveStatsSource interface {
	// SamplesForVehicle returns the drive sample slice for the
	// vehicle scoped to the lookback window. cutoff is the absolute
	// time floor (computed by the trainer as `time.Now().UTC()
	// - days*24h`) so the adapter does not redo the time math —
	// keeps the test fake deterministic and avoids drift between
	// the trainer's clamp and the adapter's WHERE-clause.
	//
	// Implementations MUST return a non-nil slice (empty slice ⇒
	// "no drives in window"). A nil error with a nil slice is a
	// programming bug and is treated by the trainer as "no drives".
	SamplesForVehicle(ctx context.Context, vehicleID int64, cutoff time.Time) ([]DriveSample, error)
}

// Trainer computes per-vehicle learned range buckets. Construct via
// [NewTrainer]; the zero value is intentionally non-functional so a
// forgotten constructor surfaces as a runtime error (ErrNoSource)
// rather than silently routing every bucket through the fallback.
//
// MinSamples / Days are knob defaults the AI handler can override
// per request. Source is required.
type Trainer struct {
	Source     DriveStatsSource
	MinSamples int
	Days       int
	// nowFn is a clock seam for tests so the test fake can produce
	// a deterministic cutoff without the test having to mock the
	// `drives` table itself. Production uses time.Now.
	nowFn func() time.Time
}

// NewTrainer constructs a trainer with the supplied sample source
// and the package defaults for MinSamples / Days. Override the
// fields directly after construction if a caller needs different thresholds.
func NewTrainer(src DriveStatsSource) *Trainer {
	return &Trainer{
		Source:     src,
		MinSamples: DefaultMinSamplesPerBucket,
		Days:       DefaultDays,
		nowFn:      time.Now,
	}
}

// ErrNoSource is returned by Train when the trainer was constructed
// without a sample source. The error is informative rather than
// recoverable: a wired-correctly trainer never returns it.
var ErrNoSource = errors.New("range: trainer has no DriveStatsSource (wiring bug)")

// Train computes the per-vehicle learned range model for every
// (temp_bucket × speed_bucket) pair in [TempBuckets] × [SpeedBuckets].
// days overrides Trainer.Days when > 0; values outside [1, MaxDays]
// are clamped (1..MaxDays) so a confused caller cannot silently
// produce a 365-day aggregate.
//
// The returned slice is in deterministic alphabetic order (by
// temp_bucket, then speed_bucket) — important for golden tests and
// for the AI tool's JSON envelope to be reproducible.
//
// Behavioural contract:
//
//   - vehicleID > 0 is required; values <= 0 yield an empty slice
//     (caller error rather than panic — keeps the AI handler's
//     validator the single chokepoint for "vehicle_id is required").
//   - A nil DriveStatsSource yields ErrNoSource.
//   - A SamplesForVehicle error is propagated as-is so the AI
//     handler can surface it on the SSE stream.
//   - Per-bucket, the trainer routes through the fallback if the
//     drive count is below MinSamples OR if the bucket name is not
//     in the canonical static lists (defence-in-depth).
func (t *Trainer) Train(ctx context.Context, vehicleID int64, days int) ([]LearnedBucket, error) {
	if t.Source == nil {
		return nil, ErrNoSource
	}
	if vehicleID <= 0 {
		return nil, nil
	}
	d := days
	if d <= 0 {
		d = t.Days
		if d <= 0 {
			d = DefaultDays
		}
	}
	if d > MaxDays {
		d = MaxDays
	}
	min := t.MinSamples
	if min <= 0 {
		min = DefaultMinSamplesPerBucket
	}

	now := t.nowFn
	if now == nil {
		now = time.Now
	}
	cutoff := now().UTC().Add(-time.Duration(d) * 24 * time.Hour)

	samples, err := t.Source.SamplesForVehicle(ctx, vehicleID, cutoff)
	if err != nil {
		return nil, fmt.Errorf("range: SamplesForVehicle vehicle=%d days=%d: %w", vehicleID, d, err)
	}

	// Bucket samples by (temp, speed) using the canonical buckets.
	// A drive that falls into an unknown bucket (impossible given
	// the canonical TempBucketFor / SpeedBucketFor exhaustively
	// partition the float number line) is silently dropped — the
	// fallback path covers it via the parity-pinned outer-product
	// iteration below.
	bucketed := make(map[string][]float64, len(TempBuckets)*len(SpeedBuckets))
	for _, s := range samples {
		if s.WhPerKm <= 0 || math.IsNaN(s.WhPerKm) || math.IsInf(s.WhPerKm, 0) {
			// Defensive: a drive with energy_used_wh > 0 and
			// distance_m > 0 should never produce a non-positive
			// Wh/km, but a future schema change that admits
			// negative values must NOT break the trainer.
			continue
		}
		tb := TempBucketFor(s.AmbientTemp)
		sb := SpeedBucketFor(s.AvgSpeedKmh)
		key := tb + "|" + sb
		bucketed[key] = append(bucketed[key], s.WhPerKm)
	}

	out := make([]LearnedBucket, 0, len(TempBuckets)*len(SpeedBuckets))
	for _, tb := range TempBuckets {
		for _, sb := range SpeedBuckets {
			obs := bucketed[tb+"|"+sb]
			if len(obs) < min {
				out = append(out, fallbackBucket(tb, sb, len(obs)))
				continue
			}
			out = append(out, learnedBucket(tb, sb, obs))
		}
	}
	return out, nil
}

// fallbackBucket builds the linear-fallback envelope for a single
// (temp, speed) bucket. SampleCount is the actual observed count
// (possibly zero) so the narrator can quote it.
func fallbackBucket(tempBucket, speedBucket string, sampleCount int) LearnedBucket {
	wh, ok := HeuristicWhPerKm(tempBucket, speedBucket)
	if !ok {
		// Defence-in-depth: a bucket pair not in the static list
		// should never reach here (Train iterates the canonical
		// outer product). If a future edit drops a bucket from
		// the static list but leaves it in the trainer loop,
		// return a zero envelope rather than panic.
		return LearnedBucket{
			TempBucket:  tempBucket,
			SpeedBucket: speedBucket,
			Source:      SourceLinearFallback,
			SampleCount: sampleCount,
		}
	}
	return LearnedBucket{
		TempBucket:  tempBucket,
		SpeedBucket: speedBucket,
		Source:      SourceLinearFallback,
		WhPerKm:     wh,
		SampleCount: sampleCount,
	}
}

// learnedBucket computes the per-bucket learned envelope from at
// least MinSamples drives. wh_per_km is the population mean,
// stddev is the population stddev, p5/p95 are the type-7 linear-
// interpolation percentiles.
//
// This function does NOT validate len(obs); the caller (Train) has
// already gated on len(obs) >= MinSamples.
func learnedBucket(tempBucket, speedBucket string, obs []float64) LearnedBucket {
	values := make([]float64, len(obs))
	copy(values, obs)
	sort.Float64s(values)

	mean, stddev := meanStddev(values)
	p5 := percentile(values, 0.05)
	p95 := percentile(values, 0.95)

	return LearnedBucket{
		TempBucket:  tempBucket,
		SpeedBucket: speedBucket,
		Source:      SourceLearned,
		WhPerKm:     mean,
		Stddev:      stddev,
		P5:          p5,
		P95:         p95,
		SampleCount: len(obs),
	}
}

// meanStddev computes the population mean and stddev of values.
// Returns (0,0) for an empty slice. Population (1/n) form rather
// than sample (1/(n-1)) for stable boundary behaviour at the
// MinSamples=5 floor.
func meanStddev(values []float64) (float64, float64) {
	n := len(values)
	if n == 0 {
		return 0, 0
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	mean := sum / float64(n)
	var sq float64
	for _, v := range values {
		d := v - mean
		sq += d * d
	}
	return mean, math.Sqrt(sq / float64(n))
}

// percentile returns the q-th percentile of an ALREADY-SORTED slice
// using linear interpolation (the "C=1" type-7 definition Numpy
// defaults to). q in [0,1]. Empty slice returns 0.
//
// The caller MUST sort the slice ascending before calling this; the
// helper does not re-sort to keep the per-bucket Train() loop linear.
func percentile(sortedValues []float64, q float64) float64 {
	n := len(sortedValues)
	if n == 0 {
		return 0
	}
	if n == 1 {
		return sortedValues[0]
	}
	if q <= 0 {
		return sortedValues[0]
	}
	if q >= 1 {
		return sortedValues[n-1]
	}
	pos := q * float64(n-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	if lo == hi {
		return sortedValues[lo]
	}
	frac := pos - float64(lo)
	return sortedValues[lo]*(1-frac) + sortedValues[hi]*frac
}

// CurrentEffectiveBuckets returns the per-bucket envelope that the
// deterministic RangeProjectionHandler.buildScenarios CURRENTLY
// uses for every vehicle (no learned data is persisted by this
// slice; "current effective" therefore equals the pinned
// [HeuristicWhPerKm] curve for every bucket). The AI tool
// query_range_prediction returns this so the narrator can COMPARE
// the learned envelope against what the deterministic detector
// actually uses today.
//
// Output is in deterministic alphabetic order. Source is always
// [SourceLinearFallback] for every entry — the slice does not
// persist learned models; a future slice may add a "current
// learned" path that returns SourceLearned entries from a persisted
// store.
func CurrentEffectiveBuckets() []LearnedBucket {
	out := make([]LearnedBucket, 0, len(TempBuckets)*len(SpeedBuckets))
	for _, tb := range TempBuckets {
		for _, sb := range SpeedBuckets {
			out = append(out, fallbackBucket(tb, sb, 0))
		}
	}
	return out
}
