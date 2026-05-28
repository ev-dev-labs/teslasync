// Package mlchargingcurves is the Phase-50 / 0064 (ML3) deterministic
// statistical clustering trainer for per-vehicle charging-curve
// fingerprints.
//
// clustering.go ships the deterministic statistical trainer that
// computes a per-vehicle charging-curve cluster envelope. Sessions
// are first hard-bucketed by the canonical L1/L2/DC peak-power tier
// the SPA's helpers.ts already applies (mirrored byte-for-byte by
// the parity test internal/api/ai_ml_charging_curve_parity_test.go),
// then the trainer reports per-cluster statistics:
//
//   - peak power: mean / stddev / p5 / p95 (W);
//   - average power: mean / stddev (W);
//   - total energy added: mean / stddev (Wh);
//   - duration: mean (minutes);
//   - delta SoC: mean (percent);
//   - ramp shape: mean of (avg/peak) per session — a value close to 1
//     means the curve held near its peak (typical L1/L2); close to
//     0.5 means the DC taper kicked in early;
//   - cluster source: "learned" when at least [Trainer.MinSessions]
//     sessions exist in the bucket, "rule_label_fallback" when fewer
//     do (the bucket then falls back to the deterministic L1/L2/DC
//     rule label without per-cluster statistics — the SessionCount
//     is honestly reported as the actual observed count).
//
// The trainer never mutates the `charging_sessions` table or
// persists any learned cluster. It is a one-shot statistical
// projection over the rows the [SessionSource] returns. A future
// slice may add a daily ai_ml_charge_curve_trainer job
// (forward-compat-listed in the registry's RouteSet.JobNames) that
// persists the learned cluster envelope per vehicle for cross-pod
// reuse; today's slice is request-scoped and recomputes on demand.
//
// Why this lives next to internal/ml/range/ and internal/ml/anomaly/:
//
//	The Phase-50 / 0064 slice's allowed-files list explicitly admits
//	`internal/ml/**` for ML-tier slices. Keeping the deterministic
//	statistical trainer in the same place as the other ML-tier
//	trainers (ML1 anomaly, ML2 range) keeps the dependency direction
//	consistent: api → ml/chargingcurves, ai/tools → ml/chargingcurves.
//	internal/ml/chargingcurves imports nothing project-local except
//	models for the ChargingSession DTO.
//
// ADR-015 alignment:
//
//   - I3 baseline intact: the deterministic ChargingCurvePage charts
//     and the SPA helpers.ts session-label heuristic remain
//     unchanged. The learned cluster envelope is an OPT-IN narrative
//     add-on; off-mode users never see it.
//   - I4 zero egress:    Train() reads only the local database via
//     the SessionSource interface; it never calls a provider.
//   - I7 per-feature:    the AI route that drives Train() is gated
//     by guard.Wrap("ml-charging-curve-clustering").
//   - I9 redaction:      vehicle_id is the only PII the trainer
//     consumes; the LearnedCluster DTO surfaces only cluster IDs +
//     numeric statistics. The AI route applies PolicyChatbot
//     (deny-all redaction) on top.
package mlchargingcurves

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"time"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
)

// SourceLearned marks a per-cluster LearnedCluster whose statistics
// were derived from at least [Trainer.MinSessions] observed
// charging sessions.
const SourceLearned = "learned"

// SourceRuleLabelFallback marks a per-cluster LearnedCluster that
// fell back to the deterministic rule-label classification because
// fewer than [Trainer.MinSessions] sessions existed in the lookback
// window for that bucket. The cluster row still reports the rule
// label and the actual SessionCount, so the narrator can honestly
// report "L2 has only 2 sessions — falling back to the rule label".
const SourceRuleLabelFallback = "rule_label_fallback"

// DefaultMinSessionsPerCluster is the minimum session count required
// for the trainer to emit a learned per-cluster envelope rather than
// the rule-label fallback. Three sessions is the smallest count that
// lets the trainer reason about a "habit" — a single session can
// fit any cluster by chance, two can be coincidence.
//
// Three was chosen rather than the 5-sample floor used by the range
// trainer (internal/ml/range): charging sessions are O(0.1-1/day)
// per vehicle so the 5 floor used by the per-bucket range trainer
// would route every cluster through the fallback in practice for
// the typical first-month-of-data user. The narrator's system
// prompt mandates honest reporting of per-cluster session counts so
// the user sees "3 sessions" alongside the proposed envelope.
const DefaultMinSessionsPerCluster = 3

// DefaultLookbackDays is the lookback window the trainer uses when
// the AI handler's request body omits the lookback_days knob. 90
// days mirrors the SPA charging-curve view default and is wide
// enough to surface multiple distinct charging contexts without
// conflating seasons.
const DefaultLookbackDays = 90

// MaxLookbackDays caps the lookback window an AI handler may
// request. A year of charging data is the upper bound for
// statistical relevance; longer windows risk mixing battery-aging
// epochs.
const MaxLookbackDays = 365

// MaxFetchLimit caps how many sessions we pull from the source
// before grouping. Generous (1000) for a 365-day window; the
// underlying SessionSource paginates so we never load the whole
// table.
const MaxFetchLimit = 1000

// MaxExampleSessionIDs caps the per-cluster example_session_ids
// slice so the envelope stays bounded even for very prolific
// charging users.
const MaxExampleSessionIDs = 5

// Power-tier thresholds — pinned to the same physical regime
// boundaries the SPA's helpers.ts already applies when classifying
// a session into L1/L2/DC. Mirrors the C3 sibling slice 0028's
// constants in internal/ai/tools/charge_curve_clustering.go and
// is pinned by the parity test
// internal/api/ai_ml_charging_curve_parity_test.go so a future
// drift between the ML trainer and the rule labels is surfaced.
//
//   - L1 charging:  ≤ 1.92 kW (120V × 16A US) — overnight wall outlet.
//   - L2 charging:  > 1.92 kW and ≤ 19.2 kW (240V × 80A US).
//   - DC fast:      > 19.2 kW (Tesla destination → Supercharger v3).
//
// Sessions with no peak_power_w or peak_power_w == 0 fall into the
// "unknown" bucket so the narrator can call them out plainly rather
// than guess.
const (
	PowerL1MaxW = 1920.0
	PowerL2MaxW = 19200.0
)

// ClusterIDs is the canonical alphabetic-sorted list the trainer
// iterates over so the per-cluster envelope is deterministic across
// runs (important for golden tests + the AI tool's JSON envelope).
//
// Order: dc_fast, l1_overnight, l2_workplace, unknown — alphabetic.
var ClusterIDs = []string{
	"dc_fast",
	"l1_overnight",
	"l2_workplace",
	"unknown",
}

// ClassifyChargingPowerTier maps a session's peak power (in watts)
// to the canonical cluster bucket. Mirrors classifyChargingPowerTier
// in internal/ai/tools/charge_curve_clustering.go (C3 sibling slice
// 0028) and helpers.ts on the SPA. Pinned by the parity test.
//
//   - "unknown"      — no peak power recorded, or non-positive.
//   - "l1_overnight" — ≤ 1.92 kW (typical 120V outlet).
//   - "l2_workplace" — > 1.92 kW and ≤ 19.2 kW (240V wall connector).
//   - "dc_fast"      — > 19.2 kW (Supercharger / DC fast).
//
// Returning the canonical string label (not an opaque index) keeps
// the LLM's narration grounded in human-readable cluster IDs.
func ClassifyChargingPowerTier(peakW *float64) string {
	if peakW == nil || *peakW <= 0 {
		return "unknown"
	}
	switch {
	case *peakW <= PowerL1MaxW:
		return "l1_overnight"
	case *peakW <= PowerL2MaxW:
		return "l2_workplace"
	default:
		return "dc_fast"
	}
}

// LearnedCluster is the per-cluster envelope the trainer emits.
// The DTO is the single source of truth shared by:
//
//   - the trainer's Train() output;
//   - the AI tools train_charge_curve_clusters +
//     query_charge_curve_clusters;
//   - the eval harness's canned mock provider replies.
//
// Source is one of [SourceLearned] / [SourceRuleLabelFallback].
//
// Stddev / P5 / P95 / RampShapeMean are populated only when
// Source is SourceLearned; they are all zero when the rule-label
// fallback is in effect. SessionCount is the number of sessions the
// trainer considered for this cluster — useful for the narrator to
// honestly report "we had only N sessions in this cluster"
// alongside the fallback.
type LearnedCluster struct {
	ClusterID           string  `json:"cluster_id"`
	Source              string  `json:"source"`
	SessionCount        int     `json:"session_count"`
	PeakPowerWMean      float64 `json:"peak_power_w_mean"`
	PeakPowerWStddev    float64 `json:"peak_power_w_stddev"`
	PeakPowerWP5        float64 `json:"peak_power_w_p5"`
	PeakPowerWP95       float64 `json:"peak_power_w_p95"`
	AvgPowerWMean       float64 `json:"avg_power_w_mean"`
	AvgPowerWStddev     float64 `json:"avg_power_w_stddev"`
	TotalEnergyWhMean   float64 `json:"total_energy_wh_mean"`
	TotalEnergyWhStddev float64 `json:"total_energy_wh_stddev"`
	DurationMinMean     float64 `json:"duration_min_mean"`
	DeltaSocPctMean     float64 `json:"delta_soc_pct_mean"`
	RampShapeMean       float64 `json:"ramp_shape_mean"`
	DominantChargerType string  `json:"dominant_charger_type"`
	ExampleSessionIDs   []int64 `json:"example_session_ids"`
}

// SessionSource is the narrow read interface the trainer needs to
// pull per-vehicle charging session rows. In production it is
// satisfied by a thin pgx-backed adapter wrapping
// *database.ChargingRepo (the SAME `charging_sessions` rows the
// deterministic ChargingCurvePage already renders; the trainer
// reads the SAME table, no new SQL semantics).
//
// Tests substitute a deterministic in-memory fake.
type SessionSource interface {
	// SessionsForVehicle returns the *chargingmodel.ChargingSession slice
	// for the vehicle scoped to the lookback window [start, end].
	// limit caps the slice length.
	//
	// Implementations MUST return a non-nil slice (empty slice ⇒
	// "no sessions in window"). A nil error with a nil slice is a
	// programming bug and is treated by the trainer as "no
	// sessions".
	SessionsForVehicle(ctx context.Context, vehicleID int64, limit int, start, end time.Time) ([]*chargingmodel.ChargingSession, error)
}

// Trainer computes per-vehicle learned charging-curve clusters.
// Construct via [NewTrainer]; the zero value is intentionally
// non-functional so a forgotten constructor surfaces as a runtime
// error (ErrNoSource) rather than silently routing every cluster
// through the fallback.
//
// MinSessions / LookbackDays are knob defaults the AI handler can
// override per request. Source is required.
type Trainer struct {
	Source       SessionSource
	MinSessions  int
	LookbackDays int
	// nowFn is a clock seam for tests so the test fake can produce
	// a deterministic window without the test having to mock the
	// `charging_sessions` table itself. Production uses time.Now.
	nowFn func() time.Time
}

// NewTrainer constructs a trainer with the supplied session source
// and the package defaults for MinSessions / LookbackDays. Override
// the fields directly after construction if a slice ever needs
// different thresholds.
func NewTrainer(src SessionSource) *Trainer {
	return &Trainer{
		Source:       src,
		MinSessions:  DefaultMinSessionsPerCluster,
		LookbackDays: DefaultLookbackDays,
		nowFn:        time.Now,
	}
}

// ErrNoSource is returned by Train when the trainer was constructed
// without a session source. The error is informative rather than
// recoverable: a wired-correctly trainer never returns it.
var ErrNoSource = errors.New("chargingcurves: trainer has no SessionSource (wiring bug)")

// Train computes the per-vehicle learned cluster envelope for every
// cluster ID in [ClusterIDs] that has at least one session in the
// lookback window. lookbackDays overrides Trainer.LookbackDays when
// > 0; values outside [1, MaxLookbackDays] are clamped (1 ..
// MaxLookbackDays) so a confused caller cannot silently produce a
// 10-year aggregate.
//
// The returned slice is in deterministic [ClusterIDs] order.
//
// Behavioural contract:
//
//   - vehicleID > 0 is required; values <= 0 yield an empty slice
//     (caller error rather than panic — keeps the AI handler's
//     validator the single chokepoint for "vehicle_id is required").
//   - A nil SessionSource yields ErrNoSource.
//   - A SessionsForVehicle error is propagated as-is so the AI
//     handler can surface it on the SSE stream.
//   - Per-cluster, the trainer routes through the fallback if the
//     session count is below MinSessions OR if the cluster name is
//     not in [ClusterIDs] (defence-in-depth).
func (t *Trainer) Train(ctx context.Context, vehicleID int64, lookbackDays int) ([]LearnedCluster, error) {
	if t.Source == nil {
		return nil, ErrNoSource
	}
	if vehicleID <= 0 {
		return nil, nil
	}
	d := lookbackDays
	if d <= 0 {
		d = t.LookbackDays
		if d <= 0 {
			d = DefaultLookbackDays
		}
	}
	if d > MaxLookbackDays {
		d = MaxLookbackDays
	}
	min := t.MinSessions
	if min <= 0 {
		min = DefaultMinSessionsPerCluster
	}

	now := t.nowFn
	if now == nil {
		now = time.Now
	}
	end := now().UTC()
	start := end.AddDate(0, 0, -d)

	sessions, err := t.Source.SessionsForVehicle(ctx, vehicleID, MaxFetchLimit, start, end)
	if err != nil {
		return nil, fmt.Errorf("chargingcurves: SessionsForVehicle vehicle=%d days=%d: %w", vehicleID, d, err)
	}

	// Bucket sessions by cluster ID.
	bucketed := make(map[string][]*chargingmodel.ChargingSession, len(ClusterIDs))
	for _, s := range sessions {
		if s == nil {
			continue
		}
		cluster := ClassifyChargingPowerTier(s.PeakPowerW)
		bucketed[cluster] = append(bucketed[cluster], s)
	}

	out := make([]LearnedCluster, 0, len(ClusterIDs))
	for _, id := range ClusterIDs {
		obs := bucketed[id]
		if len(obs) == 0 {
			// Skip empty clusters — the trainer reports only
			// clusters the vehicle actually exhibits. A future
			// slice that wants to report "you have never used L1"
			// could iterate the full ClusterIDs list with zero
			// sessions; today's slice keeps the envelope tight.
			continue
		}
		if len(obs) < min {
			out = append(out, fallbackCluster(id, obs))
			continue
		}
		out = append(out, learnedCluster(id, obs))
	}
	return out, nil
}

// fallbackCluster builds the rule-label-fallback envelope for a
// single cluster. SessionCount is the actual observed count
// (always > 0 since Train skips empty buckets) so the narrator can
// quote it.
func fallbackCluster(clusterID string, sessions []*chargingmodel.ChargingSession) LearnedCluster {
	dominant := dominantChargerType(sessions)
	exampleIDs := exampleSessionIDs(sessions)
	return LearnedCluster{
		ClusterID:           clusterID,
		Source:              SourceRuleLabelFallback,
		SessionCount:        len(sessions),
		DominantChargerType: dominant,
		ExampleSessionIDs:   exampleIDs,
	}
}

// learnedCluster computes the per-cluster learned envelope from at
// least MinSessions sessions. Means are population means; stddevs
// are population stddevs (1/n form, stable boundary behaviour at
// the MinSessions floor).
//
// This function does NOT validate len(sessions); the caller (Train)
// has already gated on len(sessions) >= MinSessions.
func learnedCluster(clusterID string, sessions []*chargingmodel.ChargingSession) LearnedCluster {
	peakPowers := pluckFloat(sessions, func(s *chargingmodel.ChargingSession) *float64 { return s.PeakPowerW })
	avgPowers := pluckFloat(sessions, func(s *chargingmodel.ChargingSession) *float64 { return s.AvgPowerW })
	energies := pluckFloat(sessions, func(s *chargingmodel.ChargingSession) *float64 { return s.TotalEnergyAddedWh })
	durations := pluckFloat(sessions, func(s *chargingmodel.ChargingSession) *float64 {
		return s.DurationMinutes()
	})
	deltaSocs := pluckFloat(sessions, func(s *chargingmodel.ChargingSession) *float64 { return s.DeltaSocPct })
	ramps := rampShapes(sessions)

	peakMean, peakStddev := meanStddev(peakPowers)
	avgMean, avgStddev := meanStddev(avgPowers)
	energyMean, energyStddev := meanStddev(energies)
	durationMean, _ := meanStddev(durations)
	deltaSocMean, _ := meanStddev(deltaSocs)
	rampMean, _ := meanStddev(ramps)

	sortedPeaks := append([]float64(nil), peakPowers...)
	sort.Float64s(sortedPeaks)
	p5 := percentile(sortedPeaks, 0.05)
	p95 := percentile(sortedPeaks, 0.95)

	return LearnedCluster{
		ClusterID:           clusterID,
		Source:              SourceLearned,
		SessionCount:        len(sessions),
		PeakPowerWMean:      peakMean,
		PeakPowerWStddev:    peakStddev,
		PeakPowerWP5:        p5,
		PeakPowerWP95:       p95,
		AvgPowerWMean:       avgMean,
		AvgPowerWStddev:     avgStddev,
		TotalEnergyWhMean:   energyMean,
		TotalEnergyWhStddev: energyStddev,
		DurationMinMean:     durationMean,
		DeltaSocPctMean:     deltaSocMean,
		RampShapeMean:       rampMean,
		DominantChargerType: dominantChargerType(sessions),
		ExampleSessionIDs:   exampleSessionIDs(sessions),
	}
}

// pluckFloat extracts a non-nil, finite subset of values from
// sessions via the supplied accessor. Defensive against NaN /
// +/-Inf / nil values that would corrupt the mean.
func pluckFloat(sessions []*chargingmodel.ChargingSession, accessor func(*chargingmodel.ChargingSession) *float64) []float64 {
	out := make([]float64, 0, len(sessions))
	for _, s := range sessions {
		v := accessor(s)
		if v == nil {
			continue
		}
		if math.IsNaN(*v) || math.IsInf(*v, 0) {
			continue
		}
		out = append(out, *v)
	}
	return out
}

// rampShapes computes per-session ramp_shape = avg/peak. Skipped
// when either avg or peak is nil / non-positive (would produce
// 0/0 or div-by-zero).
func rampShapes(sessions []*chargingmodel.ChargingSession) []float64 {
	out := make([]float64, 0, len(sessions))
	for _, s := range sessions {
		if s.AvgPowerW == nil || s.PeakPowerW == nil {
			continue
		}
		peak := *s.PeakPowerW
		avg := *s.AvgPowerW
		if peak <= 0 || avg <= 0 {
			continue
		}
		if math.IsNaN(peak) || math.IsInf(peak, 0) ||
			math.IsNaN(avg) || math.IsInf(avg, 0) {
			continue
		}
		out = append(out, avg/peak)
	}
	return out
}

// dominantChargerType returns the charger_type appearing in the
// most sessions. Ties broken alphabetically. "unspecified" when no
// session names a type. Mirrors dominantString in
// internal/ai/tools/charge_curve_clustering.go (C3 sibling).
func dominantChargerType(sessions []*chargingmodel.ChargingSession) string {
	counts := make(map[string]int, len(sessions))
	for _, s := range sessions {
		ct := "unspecified"
		if s.ChargerType != nil && *s.ChargerType != "" {
			ct = *s.ChargerType
		}
		counts[ct]++
	}
	if len(counts) == 0 {
		return "unspecified"
	}
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	best := keys[0]
	bestN := counts[best]
	for _, k := range keys[1:] {
		if counts[k] > bestN {
			best = k
			bestN = counts[k]
		}
	}
	return best
}

// exampleSessionIDs returns the first MaxExampleSessionIDs session
// IDs in observation order — useful for the narrator to ground a
// "see session N" reference without drowning the envelope in IDs.
func exampleSessionIDs(sessions []*chargingmodel.ChargingSession) []int64 {
	limit := MaxExampleSessionIDs
	if len(sessions) < limit {
		limit = len(sessions)
	}
	out := make([]int64, 0, limit)
	for i := 0; i < limit; i++ {
		out = append(out, sessions[i].ID)
	}
	return out
}

// meanStddev computes the population mean and stddev of values.
// Returns (0,0) for an empty slice. Population (1/n) form rather
// than sample (1/(n-1)) for stable boundary behaviour at the
// MinSessions=3 floor.
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

// CurrentEffectiveClusters returns the per-cluster envelope that the
// deterministic ChargingCurvePage CURRENTLY uses for every vehicle.
// Today this is the trivial rule-label classification (this slice
// does not persist learned clusters); the AI tool
// query_charge_curve_clusters returns this so the narrator can
// COMPARE the learned envelope against what the deterministic UI
// actually shows today.
//
// The returned slice contains one entry per cluster ID with
// Source=[SourceRuleLabelFallback] and SessionCount=0; the cluster
// IDs are returned in deterministic [ClusterIDs] order.
//
// A future slice that persists learned clusters would replace this
// implementation with a per-vehicle store read.
func CurrentEffectiveClusters() []LearnedCluster {
	out := make([]LearnedCluster, 0, len(ClusterIDs))
	for _, id := range ClusterIDs {
		out = append(out, LearnedCluster{
			ClusterID:           id,
			Source:              SourceRuleLabelFallback,
			SessionCount:        0,
			DominantChargerType: "unspecified",
			ExampleSessionIDs:   []int64{},
		})
	}
	return out
}
