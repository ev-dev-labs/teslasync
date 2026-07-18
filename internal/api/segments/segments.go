package segments

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Pure, unit-testable core. Nothing in this file touches the database, the
// clock, or the network — every function is a deterministic transform of its
// inputs, so the haversine distance, the greedy clustering, the leaderboard
// ranking, and the ghost alignment/interpolation are reproducible and
// independently testable (segments_test.go).
// ---------------------------------------------------------------------------

const (
	// earthRadiusM is the mean Earth radius in metres used by the haversine
	// great-circle distance. A sphere is more than accurate enough at the
	// sub-kilometre scale a segment radius operates on.
	earthRadiusM = 6371000.0

	// DefaultRadiusM is the default segment match radius: two drives share a
	// segment when their start points are within this many metres of each other
	// AND their end points are within this many metres. 250 m comfortably
	// absorbs parking-spot / driveway / GPS-fix variation without merging
	// genuinely distinct routes.
	DefaultRadiusM = 250.0

	// MinAttempts is how many member drives a cluster needs before it is an
	// "interesting" segment worth surfacing. A single drive is just a drive; a
	// segment implies a repeat you can race against.
	MinAttempts = 2

	// SplitSamples is the number of intervals the ghost split-delta series is
	// sampled at (yielding SplitSamples+1 fraction points from 0.0 to 1.0).
	SplitSamples = 20

	// MaxSeriesPoints caps the per-drive ghost progress series so a long,
	// high-rate drive cannot fan the response into an unbounded payload. The
	// series is uniformly downsampled (first + last preserved) past this.
	MaxSeriesPoints = 300
)

// DrivePoint is the pure projection of one completed drive used by clustering
// and ranking. Coordinates are WGS84 decimal degrees; DistanceM/EnergyWh are
// SI (metres / watt-hours); DurationS is seconds. HasEnergy distinguishes a
// genuine zero from an absent energy reading so efficiency ranking can skip
// unmeasured drives rather than treat them as infinitely efficient.
type DrivePoint struct {
	DriveID    int64
	StartedAt  time.Time
	StartLat   float64
	StartLon   float64
	EndLat     float64
	EndLon     float64
	StartPlace string
	EndPlace   string
	DistanceM  float64
	DurationS  float64
	EnergyWh   float64
	HasEnergy  bool
}

// Cluster is a set of drives detected as the same segment. Seed is the first
// drive assigned to the cluster (the earliest, since detection runs over
// chronologically-sorted input); its start/end coordinates are the stable
// anchor persisted for the segment and re-used to match future drives.
type Cluster struct {
	Seed   DrivePoint
	Drives []DrivePoint
}

// Summary is the pure, computed shape of a detected segment (no JSON, no id).
// The handler maps it onto the wire DTO and fills the persisted id.
type Summary struct {
	Seed           DrivePoint
	Name           string
	StartAddress   string
	EndAddress     string
	DistanceM      float64
	AttemptCount   int
	BestTime       DrivePoint
	BestEff        DrivePoint
	HasBestEff     bool
	BestEffWhPerKm float64
	Latest         DrivePoint
}

// Ranked is one leaderboard row in a pure form. Drive carries the underlying
// attempt; WhPerKm is only meaningful when HasWhPerKm is true.
type Ranked struct {
	Rank         int
	Drive        DrivePoint
	WhPerKm      float64
	HasWhPerKm   bool
	DeltaToBestS float64
	IsPR         bool
}

// TelemetrySample is one drive-telemetry tick projected for the ghost series:
// OffsetS is seconds since the drive started; SpeedMps is instantaneous speed.
type TelemetrySample struct {
	OffsetS  float64
	SpeedMps float64
}

// ProgressPoint is one point of a normalized ghost progress series: how far
// along the route (0..1 by integrated distance), how long into the drive
// (seconds), and how fast (m/s) at that point.
type ProgressPoint struct {
	FractionOfDistance float64
	ElapsedS           float64
	SpeedMps           float64
}

// SplitDeltaPoint is the time gap between two ghost drives at a shared distance
// fraction. DeltaS = elapsed(A) - elapsed(B): negative means A reached that
// fraction sooner (A ahead), positive means A is behind.
type SplitDeltaPoint struct {
	Fraction float64
	DeltaS   float64
}

// HaversineMeters returns the great-circle distance in metres between two
// WGS84 points. Pure.
func HaversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	rLat1 := lat1 * math.Pi / 180
	rLat2 := lat2 * math.Pi / 180
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rLat1)*math.Cos(rLat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusM * c
}

// WithinRadius reports whether two points are within radiusM metres. Pure.
func WithinRadius(lat1, lon1, lat2, lon2, radiusM float64) bool {
	return HaversineMeters(lat1, lon1, lat2, lon2) <= radiusM
}

// SameSegment reports whether drives a and b belong to the same segment: their
// start points are within radiusM AND their end points are within radiusM.
// Pure.
func SameSegment(a, b DrivePoint, radiusM float64) bool {
	return WithinRadius(a.StartLat, a.StartLon, b.StartLat, b.StartLon, radiusM) &&
		WithinRadius(a.EndLat, a.EndLon, b.EndLat, b.EndLon, radiusM)
}

// ClusterDrives greedily groups drives into segments: each drive joins the
// FIRST existing cluster whose seed it matches (SameSegment), otherwise it
// seeds a new cluster. Anchoring membership to the seed (rather than a drifting
// centroid) keeps detection deterministic and makes the persisted anchor the
// exact predicate the leaderboard re-uses to re-find members. Input order is
// respected, so callers pass drives chronologically (earliest first) to get
// stable, earliest-drive seeds. Pure.
func ClusterDrives(drives []DrivePoint, radiusM float64) []Cluster {
	clusters := make([]Cluster, 0, 8)
	for _, d := range drives {
		placed := false
		for i := range clusters {
			if SameSegment(clusters[i].Seed, d, radiusM) {
				clusters[i].Drives = append(clusters[i].Drives, d)
				placed = true
				break
			}
		}
		if !placed {
			clusters = append(clusters, Cluster{Seed: d, Drives: []DrivePoint{d}})
		}
	}
	return clusters
}

// MostCommon returns the most frequent non-blank string, breaking ties toward
// the lexicographically smallest value so the result is deterministic. Returns
// "" when every value is blank. Pure.
func MostCommon(vals []string) string {
	counts := make(map[string]int, len(vals))
	for _, v := range vals {
		if strings.TrimSpace(v) == "" {
			continue
		}
		counts[v]++
	}
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	best := ""
	bestN := 0
	for _, k := range keys {
		if counts[k] > bestN {
			bestN = counts[k]
			best = k
		}
	}
	return best
}

// WhPerKm is a drive's energy efficiency in watt-hours per kilometre. Returns
// 0 for a non-positive distance (undefined efficiency). Pure.
func WhPerKm(energyWh, distanceM float64) float64 {
	if distanceM <= 0 {
		return 0
	}
	return energyWh / (distanceM / 1000.0)
}

// MedianDistanceM is the median member distance (SI metres) — a representative
// segment length that resists an outlier detour. Returns 0 for no drives. Pure.
func MedianDistanceM(drives []DrivePoint) float64 {
	if len(drives) == 0 {
		return 0
	}
	ds := make([]float64, len(drives))
	for i, d := range drives {
		ds[i] = d.DistanceM
	}
	sort.Float64s(ds)
	n := len(ds)
	if n%2 == 1 {
		return ds[n/2]
	}
	return (ds[n/2-1] + ds[n/2]) / 2
}

// segmentName builds "start → end" from the most-common place labels, falling
// back to the seed's rounded coordinates when a label is missing so the name is
// always meaningful. Pure.
func segmentName(start, end string, seed DrivePoint) string {
	s := start
	if strings.TrimSpace(s) == "" {
		s = fmt.Sprintf("%.4f, %.4f", seed.StartLat, seed.StartLon)
	}
	e := end
	if strings.TrimSpace(e) == "" {
		e = fmt.Sprintf("%.4f, %.4f", seed.EndLat, seed.EndLon)
	}
	return s + " → " + e
}

// Summarize reduces a cluster to its display + personal-best summary: a name
// and start/end addresses from the most common member labels, a representative
// (median) distance, and the best-by-time, best-by-efficiency, and latest
// member drives. A cluster is assumed non-empty (the caller filters by
// MinAttempts). Pure.
func Summarize(c Cluster) Summary {
	s := Summary{Seed: c.Seed, AttemptCount: len(c.Drives)}
	starts := make([]string, 0, len(c.Drives))
	ends := make([]string, 0, len(c.Drives))
	for _, d := range c.Drives {
		starts = append(starts, d.StartPlace)
		ends = append(ends, d.EndPlace)
	}
	s.StartAddress = MostCommon(starts)
	s.EndAddress = MostCommon(ends)
	s.Name = segmentName(s.StartAddress, s.EndAddress, c.Seed)
	s.DistanceM = MedianDistanceM(c.Drives)

	best := c.Drives[0]
	latest := c.Drives[0]
	var bestEff DrivePoint
	bestEffVal := math.Inf(1)
	for _, d := range c.Drives {
		if d.DurationS > 0 && (best.DurationS <= 0 || d.DurationS < best.DurationS) {
			best = d
		}
		if d.StartedAt.After(latest.StartedAt) {
			latest = d
		}
		if d.HasEnergy && d.DistanceM > 0 {
			if e := WhPerKm(d.EnergyWh, d.DistanceM); e < bestEffVal {
				bestEffVal = e
				bestEff = d
				s.HasBestEff = true
			}
		}
	}
	s.BestTime = best
	s.Latest = latest
	if s.HasBestEff {
		s.BestEff = bestEff
		s.BestEffWhPerKm = bestEffVal
	}
	return s
}

// InterestingSegments summarizes only the clusters with at least minAttempts
// members. Always returns a non-nil (possibly empty) slice. Pure.
func InterestingSegments(clusters []Cluster, minAttempts int) []Summary {
	out := make([]Summary, 0, len(clusters))
	for _, c := range clusters {
		if len(c.Drives) >= minAttempts {
			out = append(out, Summarize(c))
		}
	}
	return out
}

// bestDuration is the minimum positive duration across drives (0 when none).
func bestDuration(drives []DrivePoint) float64 {
	best := math.Inf(1)
	found := false
	for _, d := range drives {
		if d.DurationS > 0 && d.DurationS < best {
			best = d.DurationS
			found = true
		}
	}
	if !found {
		return 0
	}
	return best
}

// RankByTime ranks every attempt fastest-first. DeltaToBestS is each attempt's
// time gap to the fastest run; the rank-1 row is flagged IsPR. Ties break
// toward the earlier drive so ordering is deterministic. Pure.
func RankByTime(drives []DrivePoint) []Ranked {
	best := bestDuration(drives)
	sorted := append([]DrivePoint(nil), drives...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].DurationS != sorted[j].DurationS {
			return sorted[i].DurationS < sorted[j].DurationS
		}
		return sorted[i].StartedAt.Before(sorted[j].StartedAt)
	})
	out := make([]Ranked, 0, len(sorted))
	for i, d := range sorted {
		r := Ranked{
			Rank:         i + 1,
			Drive:        d,
			DeltaToBestS: d.DurationS - best,
			IsPR:         i == 0,
		}
		if d.HasEnergy && d.DistanceM > 0 {
			r.WhPerKm = WhPerKm(d.EnergyWh, d.DistanceM)
			r.HasWhPerKm = true
		}
		out = append(out, r)
	}
	return out
}

// RankByEfficiency ranks the attempts that HAVE a measured efficiency,
// most-efficient (lowest Wh/km) first. Attempts without an energy reading are
// omitted (efficiency is undefined). DeltaToBestS is still the time gap to the
// fastest run over ALL attempts, so a maximally-efficient but slow run reads as
// "+Ns" against the outright PR. Ties break toward the earlier drive. Pure.
func RankByEfficiency(drives []DrivePoint) []Ranked {
	best := bestDuration(drives)
	withEnergy := make([]DrivePoint, 0, len(drives))
	for _, d := range drives {
		if d.HasEnergy && d.DistanceM > 0 {
			withEnergy = append(withEnergy, d)
		}
	}
	sort.SliceStable(withEnergy, func(i, j int) bool {
		ei := WhPerKm(withEnergy[i].EnergyWh, withEnergy[i].DistanceM)
		ej := WhPerKm(withEnergy[j].EnergyWh, withEnergy[j].DistanceM)
		if ei != ej {
			return ei < ej
		}
		return withEnergy[i].StartedAt.Before(withEnergy[j].StartedAt)
	})
	out := make([]Ranked, 0, len(withEnergy))
	for i, d := range withEnergy {
		out = append(out, Ranked{
			Rank:         i + 1,
			Drive:        d,
			WhPerKm:      WhPerKm(d.EnergyWh, d.DistanceM),
			HasWhPerKm:   true,
			DeltaToBestS: d.DurationS - best,
			IsPR:         i == 0,
		})
	}
	return out
}

// BuildProgressSeries turns per-tick (offset, speed) samples into a normalized
// progress series. Cumulative distance is the trapezoidal integral of
// non-negative speed over time (negative speeds and non-forward time steps
// contribute nothing, keeping the distance monotonic so the fraction is
// well-ordered); the fraction is that cumulative distance divided by the total,
// so both a fast and a slow run map onto the same 0..1 axis for head-to-head
// alignment. Returns a non-nil (possibly empty) slice. Pure.
func BuildProgressSeries(samples []TelemetrySample) []ProgressPoint {
	if len(samples) == 0 {
		return []ProgressPoint{}
	}
	cum := make([]float64, len(samples))
	for i := 1; i < len(samples); i++ {
		dt := samples[i].OffsetS - samples[i-1].OffsetS
		if dt <= 0 {
			cum[i] = cum[i-1]
			continue
		}
		v0 := math.Max(0, samples[i-1].SpeedMps)
		v1 := math.Max(0, samples[i].SpeedMps)
		cum[i] = cum[i-1] + (v0+v1)/2*dt
	}
	total := cum[len(cum)-1]
	out := make([]ProgressPoint, len(samples))
	for i, s := range samples {
		frac := 0.0
		if total > 0 {
			frac = cum[i] / total
		}
		out[i] = ProgressPoint{
			FractionOfDistance: frac,
			ElapsedS:           s.OffsetS,
			SpeedMps:           math.Max(0, s.SpeedMps),
		}
	}
	return out
}

// ElapsedAtFraction linearly interpolates the elapsed time at a distance
// fraction. Fractions before the first / after the last sample clamp to the
// endpoints (never extrapolate). Assumes a fraction-monotonic series as
// produced by BuildProgressSeries. Returns 0 for an empty series. Pure.
func ElapsedAtFraction(series []ProgressPoint, fraction float64) float64 {
	if len(series) == 0 {
		return 0
	}
	if fraction <= series[0].FractionOfDistance {
		return series[0].ElapsedS
	}
	last := series[len(series)-1]
	if fraction >= last.FractionOfDistance {
		return last.ElapsedS
	}
	for i := 1; i < len(series); i++ {
		p0, p1 := series[i-1], series[i]
		if fraction <= p1.FractionOfDistance {
			span := p1.FractionOfDistance - p0.FractionOfDistance
			if span <= 0 {
				return p1.ElapsedS
			}
			t := (fraction - p0.FractionOfDistance) / span
			return p0.ElapsedS + t*(p1.ElapsedS-p0.ElapsedS)
		}
	}
	return last.ElapsedS
}

// SplitDeltas samples the time gap between two ghost drives at n+1 evenly
// spaced distance fractions from 0.0 to 1.0. DeltaS = elapsed(a) - elapsed(b):
// negative where a is ahead, positive where a is behind. n is clamped to at
// least 1. Pure.
func SplitDeltas(a, b []ProgressPoint, n int) []SplitDeltaPoint {
	if n < 1 {
		n = 1
	}
	out := make([]SplitDeltaPoint, 0, n+1)
	for i := 0; i <= n; i++ {
		f := float64(i) / float64(n)
		out = append(out, SplitDeltaPoint{
			Fraction: f,
			DeltaS:   ElapsedAtFraction(a, f) - ElapsedAtFraction(b, f),
		})
	}
	return out
}

// DownsampleSeries uniformly thins a progress series to at most max points,
// always preserving the first and last. A series already within the cap is
// returned unchanged. max <= 0 disables downsampling. Pure.
func DownsampleSeries(series []ProgressPoint, max int) []ProgressPoint {
	if max <= 0 || len(series) <= max {
		return series
	}
	if max == 1 {
		return []ProgressPoint{series[len(series)-1]}
	}
	out := make([]ProgressPoint, 0, max)
	stride := float64(len(series)-1) / float64(max-1)
	lastIdx := -1
	for i := 0; i < max; i++ {
		idx := int(math.Round(float64(i) * stride))
		if idx >= len(series) {
			idx = len(series) - 1
		}
		if idx == lastIdx {
			continue
		}
		out = append(out, series[idx])
		lastIdx = idx
	}
	if lastIdx != len(series)-1 {
		out = append(out, series[len(series)-1])
	}
	return out
}

// round1/round2/round4 fix a value to a stable, display-ready number of
// decimals at the JSON boundary (mirrors the carbon / tco rounding convention).
func round1(v float64) float64 { return math.Round(v*10) / 10 }
func round2(v float64) float64 { return math.Round(v*100) / 100 }
func round4(v float64) float64 { return math.Round(v*10000) / 10000 }

// safeF guards against NaN/Inf which silently break json.Encode.
func safeF(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}
