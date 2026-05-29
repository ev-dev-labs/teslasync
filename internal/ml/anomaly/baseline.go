// Package anomaly contains deterministic per-vehicle anomaly baseline training.
//
// The trainer
// computes a per-vehicle anomaly baseline envelope (lower, upper)
// for each tracked signal in [StaticSignals], using mean/stddev/p5/p95
// over a recent window of signal_log observations.
//
// The trainer's contract:
//
//   - When a signal has at least [Trainer.MinSamples] observations
//     in the window, the LearnedBaseline.Source is "learned" and
//     Lower/Upper are the per-signal p5/p95 (clamped to the static
//     envelope so a freak outlier sample cannot widen the bounds
//     past the physically-reasonable static envelope).
//
//   - When a signal has fewer than MinSamples observations, the
//     LearnedBaseline.Source is "safe_ranges_fallback" and
//     Lower/Upper are the static safeRanges entry. The narrator
//     EXPLAINS that the safe-range fallback is in effect for this
//     signal, so the user knows the per-vehicle envelope did not
//     yet have enough data.
//
//   - Sample counts and the Source label are surfaced in the
//     LearnedBaseline DTO so the AI narrator can quote them honestly
//     ("23 / 30 samples for ModuleTempMax this window — safe-range
//     fallback in effect").
//
// The trainer never mutates the signal_log table or persists any
// learned baseline. It is a one-shot statistical projection over
// the rows the SignalSampleSource returns. A future ai_ml_anomaly_trainer
// job may persist the learned envelope per vehicle for cross-pod reuse; the
// current path is request-scoped and recomputes on demand.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the static [SafeRanges] / [StaticBound]
//     envelope (and the deterministic anomaly_handler.go detector
//     that uses it) are unchanged. The learned envelope is an
//     OPT-IN narrative add-on; off-mode users never see it.
//   - I4 zero egress:    Train() reads only the local database via
//     the SignalSampleSource interface; it never calls a provider.
//   - I7 per-feature:    the AI route that drives Train() is gated
//     by guard.Wrap("learned-per-vehicle-anomaly-baselines").
//   - I9 redaction:      vehicle_id is the only PII the trainer
//     consumes; the LearnedBaseline DTO surfaces only signal-name
//   - numeric statistics. The AI route applies PolicyChatbot
//     (deny-all redaction) on top.
package anomaly

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
)

// SourceLearned marks a per-signal LearnedBaseline whose bounds
// were derived from at least [Trainer.MinSamples] observations.
const SourceLearned = "learned"

// SourceSafeRangesFallback marks a per-signal LearnedBaseline that
// fell back to the static safeRanges envelope because fewer than
// [Trainer.MinSamples] observations existed in the lookback window.
const SourceSafeRangesFallback = "safe_ranges_fallback"

// DefaultMinSamples is the minimum sample count required for the
// trainer to emit a learned envelope rather than the static
// fallback. Mirrors the Z-score detector's COUNT(*) >= 30 threshold
// in internal/api/anomaly_handler.go's detectZScoreAnomalies — the
// learned baseline uses the same statistical-validity floor as the
// detector that surfaces alerts grounded in it.
const DefaultMinSamples = 30

// DefaultDays is the lookback window the trainer uses when the AI
// handler's request body omits the days knob. Mirrors the deterministic
// detector's default 7-day window.
const DefaultDays = 7

// MaxDays caps the lookback window an AI handler may request. The
// learned envelope over a 30-day window is the upper bound for
// statistical relevance under typical Tesla telemetry density; longer
// windows risk mixing seasons.
const MaxDays = 30

// LearnedBaseline is the per-signal envelope the trainer emits.
// The DTO is the single source of truth shared by:
//
//   - the trainer's Train() output;
//   - the AI tools train_anomaly_baseline + query_anomaly_baseline;
//   - the eval harness's canned mock provider replies.
//
// Source is one of [SourceLearned] / [SourceSafeRangesFallback].
//
// Mean / Stddev / P5 / P95 are populated only when Source is
// SourceLearned; they are all zero when the safe-range fallback is
// in effect. SampleCount is the number of observations the trainer
// considered for this signal in the requested window — useful for
// the narrator to honestly report "we had only N samples this
// window" alongside the fallback.
type LearnedBaseline struct {
	Signal      string  `json:"signal"`
	Source      string  `json:"source"`
	Lower       float64 `json:"lower"`
	Upper       float64 `json:"upper"`
	Mean        float64 `json:"mean"`
	Stddev      float64 `json:"stddev"`
	P5          float64 `json:"p5"`
	P95         float64 `json:"p95"`
	SampleCount int     `json:"sample_count"`
}

// SignalSamples bundles the raw float-valued observations for ONE
// signal in the trainer's lookback window. The slice is the exact
// values the SignalSampleSource returned; the trainer copies it
// before sorting so the caller's slice is not mutated.
type SignalSamples struct {
	Signal string
	Values []float64
}

// SignalSampleSource is the narrow read interface the trainer needs
// to pull per-vehicle observations out of signal_log. In production
// it is satisfied by a thin pgx-backed adapter whose query is
// approximately:
//
//	SELECT field, COALESCE(float_value, int_value::float8) AS v
//	FROM signal_log
//	WHERE vehicle_id = $1
//	  AND ts > NOW() - $2::interval
//	  AND field = ANY($3)
//	  AND (float_value IS NOT NULL OR int_value IS NOT NULL)
//
// (the same row source the deterministic detector queries; the
// trainer reads the SAME table, no new SQL semantics).
//
// Tests substitute a deterministic in-memory fake.
type SignalSampleSource interface {
	// SamplesForVehicle returns the observation slice for each
	// signal listed, scoped to the vehicle and the lookback window.
	// Implementations MUST return a non-nil slice for every signal
	// requested (empty slice ⇒ "no samples in window"); a missing
	// signal in the returned map is treated by the trainer as
	// "zero samples" and routes through the safe-ranges fallback.
	SamplesForVehicle(ctx context.Context, vehicleID int64, days int, signals []string) (map[string][]float64, error)
}

// Trainer computes per-vehicle learned anomaly baselines. Construct
// via [NewTrainer]; the zero value is intentionally non-functional
// so a forgotten constructor surfaces as a runtime nil panic rather
// than silently routing every signal through the fallback.
//
// MinSamples / Days are knob defaults the AI handler can override
// per request. Source is required.
type Trainer struct {
	Source     SignalSampleSource
	MinSamples int
	Days       int
}

// NewTrainer constructs a trainer with the supplied sample source
// and the package defaults for MinSamples / Days. Override the
// fields directly after construction if a caller needs different thresholds.
func NewTrainer(src SignalSampleSource) *Trainer {
	return &Trainer{
		Source:     src,
		MinSamples: DefaultMinSamples,
		Days:       DefaultDays,
	}
}

// ErrNoSource is returned by Train when the trainer was constructed
// without a sample source. The error is informative rather than
// recoverable: a wired-correctly trainer never returns it.
var ErrNoSource = errors.New("anomaly: trainer has no SignalSampleSource (wiring bug)")

// Train computes the per-vehicle learned baseline envelope for every
// signal in [StaticSignals]. days overrides Trainer.Days when > 0;
// values outside [1, MaxDays] are clamped (1..MaxDays) so a
// confused caller cannot silently produce a 365-day aggregate.
//
// The returned slice is in deterministic alphabetic order (by
// signal name) — important for golden tests and for the AI tool's
// JSON envelope to be reproducible.
//
// Behavioural contract:
//
//   - vehicleID > 0 is required; values <= 0 yield an empty slice
//     (caller error rather than panic — keeps the AI handler's
//     validator the single chokepoint for "vehicle_id is required").
//   - A nil SignalSampleSource yields ErrNoSource.
//   - A SamplesForVehicle error is propagated as-is so the AI
//     handler can surface it on the SSE stream.
//   - Per-signal, the trainer routes through the fallback if the
//     sample count is below MinSamples OR if the static envelope
//     does not list the signal (defence-in-depth — the static map
//     is the canonical signal allowlist).
func (t *Trainer) Train(ctx context.Context, vehicleID int64, days int) ([]LearnedBaseline, error) {
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
		min = DefaultMinSamples
	}

	signals := StaticSignals()
	samples, err := t.Source.SamplesForVehicle(ctx, vehicleID, d, signals)
	if err != nil {
		return nil, fmt.Errorf("anomaly: SamplesForVehicle vehicle=%d days=%d: %w", vehicleID, d, err)
	}

	out := make([]LearnedBaseline, 0, len(signals))
	for _, sig := range signals {
		obs := samples[sig]
		if len(obs) < min {
			out = append(out, fallback(sig, len(obs)))
			continue
		}
		out = append(out, learned(sig, obs))
	}
	return out, nil
}

// fallback builds the safe-range fallback envelope for a single
// signal. SampleCount is the actual observed count (possibly zero)
// so the narrator can quote it.
func fallback(signal string, sampleCount int) LearnedBaseline {
	bound, ok := StaticBound(signal)
	if !ok {
		// Defence-in-depth: a signal not in the static envelope
		// should never reach here (Train iterates StaticSignals).
		// If a future edit drops a signal from the static map but
		// leaves it in the trainer loop, return a zero envelope
		// rather than panic.
		return LearnedBaseline{
			Signal:      signal,
			Source:      SourceSafeRangesFallback,
			SampleCount: sampleCount,
		}
	}
	return LearnedBaseline{
		Signal:      signal,
		Source:      SourceSafeRangesFallback,
		Lower:       bound[0],
		Upper:       bound[1],
		SampleCount: sampleCount,
	}
}

// learned computes the per-signal learned envelope from at least
// MinSamples observations. The bounds are p5/p95, clamped to the
// static envelope so a single freak outlier cannot widen the
// learned bounds past the physically-reasonable static ones.
//
// This function does NOT validate len(obs); the caller (Train) has
// already gated on len(obs) >= MinSamples.
func learned(signal string, obs []float64) LearnedBaseline {
	values := make([]float64, len(obs))
	copy(values, obs)
	sort.Float64s(values)

	mean, stddev := meanStddev(values)
	p5 := percentile(values, 0.05)
	p95 := percentile(values, 0.95)

	lower, upper := p5, p95
	if bound, ok := StaticBound(signal); ok {
		// Clamp learned bounds to the static envelope so a freak
		// outlier sample cannot widen the bounds past the
		// physically-reasonable static envelope.
		if lower < bound[0] {
			lower = bound[0]
		}
		if upper > bound[1] {
			upper = bound[1]
		}
	}

	return LearnedBaseline{
		Signal:      signal,
		Source:      SourceLearned,
		Lower:       lower,
		Upper:       upper,
		Mean:        mean,
		Stddev:      stddev,
		P5:          p5,
		P95:         p95,
		SampleCount: len(obs),
	}
}

// meanStddev computes the population mean and stddev of values.
// Returns (0,0) for an empty slice. The stddev is the population
// (1/n) form rather than the sample (1/(n-1)) form because the
// trainer only emits an envelope when n >= 30, where the difference
// is negligible and the population form has nicer numerical
// properties at the boundary.
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
// helper does not re-sort to keep the per-signal Train() loop linear
// rather than O(n log n) twice.
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
	// type-7 / C=1 linear interpolation
	pos := q * float64(n-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	if lo == hi {
		return sortedValues[lo]
	}
	frac := pos - float64(lo)
	return sortedValues[lo]*(1-frac) + sortedValues[hi]*frac
}

// CurrentEffectiveEnvelope returns the per-signal envelope that the
// deterministic anomaly detector is CURRENTLY using for every
// vehicle (no learned data is persisted by this slice; "current
// effective" therefore equals the static safeRanges fallback). The
// AI tool query_anomaly_baseline returns this so the narrator can
// COMPARE the learned envelope against what the detector actually
// uses today.
//
// Output is in deterministic alphabetic order. Source is always
// [SourceSafeRangesFallback] for every entry — the slice does not
// persist learned baselines; a future slice may add a "current
// learned" path that returns SourceLearned entries from a persisted
// store.
func CurrentEffectiveEnvelope() []LearnedBaseline {
	signals := StaticSignals()
	out := make([]LearnedBaseline, 0, len(signals))
	for _, sig := range signals {
		out = append(out, fallback(sig, 0))
	}
	return out
}
