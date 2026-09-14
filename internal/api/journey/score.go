package journey

import (
	"math"
	"sort"
	"strconv"
)

// Signal weights for stop ranking. They sum to 1; when a signal is
// unavailable for every candidate it drops out and the remainder
// renormalize, so a missing feed degrades the ranking instead of
// zeroing it.
const (
	weightWait     = 0.35
	weightPrice    = 0.30
	weightHealth   = 0.20
	weightCorridor = 0.15
)

// Candidate is one caller-nominated stop: a fleet-known site plus where
// it sits and when the driver would arrive.
type Candidate struct {
	Site    string
	Lat     float64
	Lng     float64
	ArriveS int64 // arrival instant, unix seconds (any zone; UTC-normalised downstream)
}

// Signals are the measured inputs per candidate. Nil means unavailable:
// the signal drops out of that candidate's blend.
type Signals struct {
	WaitS     *float64  // expected queue wait, SI seconds
	PerKWh    *float64  // realized price per kWh
	PeakKW    []float64 // peak-kW samples for the health read
	Available bool      // any signal present at all
}

// ScoredStop is one ranked candidate with its per-signal breakdown.
type ScoredStop struct {
	Site      string   `json:"site"`
	Score     float64  `json:"score"`
	WaitS     *float64 `json:"wait_s"`
	UnitPrice *float64 `json:"unit_price"`
	Health    *float64 `json:"health"`
	CorridorM float64  `json:"corridor_m"`
	Evidence  []string `json:"evidence"`
}

// RankStops scores candidates for one charge need. origin/dest anchor
// the straight-line corridor; energyWh scales the price signal into
// absolute spend. Pure: no I/O, deterministic. SI throughout.
func RankStops(originLat, originLng, destLat, destLng, energyWh float64, cands []Candidate, sigs []Signals) []ScoredStop {
	out := make([]ScoredStop, 0, len(cands))
	for i, c := range cands {
		var sig Signals
		if i < len(sigs) {
			sig = sigs[i]
		}
		health := healthScore(sig.PeakKW)
		out = append(out, ScoredStop{
			Site:      c.Site,
			WaitS:     sig.WaitS,
			UnitPrice: scaledPrice(sig.PerKWh, energyWh),
			Health:    health,
			CorridorM: corridorDeviationM(originLat, originLng, destLat, destLng, c.Lat, c.Lng),
			Evidence:  evidenceFor(sig, energyWh),
		})
	}
	// Relative 0..100 per signal across candidates; a lone candidate
	// with data scores 100, without data the signal is skipped.
	norm := func(pick func(*ScoredStop) *float64, lowerBetter bool) map[int]float64 {
		vals := map[int]float64{}
		for i := range out {
			if v := pick(&out[i]); v != nil {
				vals[i] = *v
			}
		}
		scores := map[int]float64{}
		if len(vals) == 0 {
			return scores
		}
		if len(vals) == 1 {
			for i := range vals {
				scores[i] = 100
			}
			return scores
		}
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, v := range vals {
			lo, hi = math.Min(lo, v), math.Max(hi, v)
		}
		if hi == lo {
			for i := range vals {
				scores[i] = 100
			}
			return scores
		}
		for i, v := range vals {
			if lowerBetter {
				scores[i] = (hi - v) / (hi - lo) * 100
			} else {
				scores[i] = (v - lo) / (hi - lo) * 100
			}
		}
		return scores
	}
	waitN := norm(func(s *ScoredStop) *float64 { return s.WaitS }, true)
	priceN := norm(func(s *ScoredStop) *float64 { return s.UnitPrice }, true)
	healthN := norm(func(s *ScoredStop) *float64 { return s.Health }, false)
	corrVals := map[int]float64{}
	for i := range out {
		corrVals[i] = out[i].CorridorM
	}
	corrN := map[int]float64{}
	{
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, v := range corrVals {
			lo, hi = math.Min(lo, v), math.Max(hi, v)
		}
		for i, v := range corrVals {
			if hi == lo {
				corrN[i] = 100
			} else {
				corrN[i] = (hi - v) / (hi - lo) * 100
			}
		}
	}
	for i := range out {
		sum, wsum := 0.0, 0.0
		if v, ok := waitN[i]; ok {
			sum, wsum = sum+v*weightWait, wsum+weightWait
		}
		if v, ok := priceN[i]; ok {
			sum, wsum = sum+v*weightPrice, wsum+weightPrice
		}
		if v, ok := healthN[i]; ok {
			sum, wsum = sum+v*weightHealth, wsum+weightHealth
		}
		sum, wsum = sum+corrN[i]*weightCorridor, wsum+weightCorridor
		out[i].Score = round1(sum / wsum)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Score > out[j].Score })
	return out
}

// scaledPrice converts $/kWh into absolute spend for the charge need so
// the price signal reflects money, not rates. Nil in, nil out.
func scaledPrice(perKWh *float64, energyWh float64) *float64 {
	if perKWh == nil || energyWh <= 0 {
		return perKWh
	}
	v := *perKWh * energyWh / 1000
	return &v
}

// healthScore reads stall consistency from peak-kW samples: a site
// where every session peaks alike is healthy; wild variance means
// degraded stalls. Needs 3+ samples; 0..100, higher is healthier.
func healthScore(peaks []float64) *float64 {
	vals := make([]float64, 0, len(peaks))
	for _, p := range peaks {
		if p > 0 {
			vals = append(vals, p)
		}
	}
	if len(vals) < 3 {
		return nil
	}
	mean := 0.0
	for _, v := range vals {
		mean += v
	}
	mean /= float64(len(vals))
	if mean <= 0 {
		return nil
	}
	variance := 0.0
	for _, v := range vals {
		d := v - mean
		variance += d * d
	}
	variance /= float64(len(vals))
	cv := math.Sqrt(variance) / mean
	depth := math.Min(1, float64(len(vals))/20) // full credit at 20+ samples
	h := math.Max(0, 1-cv) * (0.5 + 0.5*depth) * 100
	return &h
}

// corridorDeviationM is the cross-track distance from the candidate to
// the straight origin→destination line: a documented proxy for detour
// until turn-by-turn routing exists. Degenerate (zero-length) routes
// measure from the origin point.
func corridorDeviationM(oLat, oLng, dLat, dLng, cLat, cLng float64) float64 {
	const earthM = 6371000.0
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	lat1, lng1 := toRad(oLat), toRad(oLng)
	lat2, lng2 := toRad(dLat), toRad(dLng)
	lat3, lng3 := toRad(cLat), toRad(cLng)
	hav := func(a float64) float64 {
		s := math.Sin(a / 2)
		return s * s
	}
	central := func(la1, ln1, la2, ln2 float64) float64 {
		h := hav(la2-la1) + math.Cos(la1)*math.Cos(la2)*hav(ln2-ln1)
		return 2 * math.Asin(math.Min(1, math.Sqrt(math.Max(0, h))))
	}
	d13 := central(lat1, lng1, lat3, lng3)
	d12 := central(lat1, lng1, lat2, lng2)
	if d12 == 0 {
		return d13 * earthM
	}
	y := math.Sin(lng3-lng1) * math.Cos(lat3)
	x := math.Cos(lat1)*math.Sin(lat3) - math.Sin(lat1)*math.Cos(lat3)*math.Cos(lng3-lng1)
	bearing13 := math.Atan2(y, x)
	y2 := math.Sin(lng2-lng1) * math.Cos(lat2)
	x2 := math.Cos(lat1)*math.Sin(lat2) - math.Sin(lat1)*math.Cos(lat2)*math.Cos(lng2-lng1)
	bearing12 := math.Atan2(y2, x2)
	xt := math.Asin(math.Max(-1, math.Min(1, math.Sin(d13)*math.Sin(bearing13-bearing12))))
	return math.Abs(xt) * earthM
}

func evidenceFor(sig Signals, energyWh float64) []string {
	out := []string{}
	if sig.WaitS != nil {
		out = append(out, "expected wait "+formatDur(*sig.WaitS))
	}
	if sig.PerKWh != nil && energyWh > 0 {
		out = append(out, "≈$"+strconv.FormatFloat(*sig.PerKWh*energyWh/1000, 'f', 2, 64)+" for this charge")
	} else if sig.PerKWh != nil {
		out = append(out, "$"+strconv.FormatFloat(*sig.PerKWh, 'f', 2, 64)+"/kWh realized")
	}
	if len(sig.PeakKW) >= 3 {
		out = append(out, strconv.Itoa(len(sig.PeakKW))+" peak-power samples")
	}
	if !sig.Available {
		out = append(out, "no fleet data — ranked on corridor only")
	}
	return out
}

func formatDur(s float64) string {
	if s < 90 {
		return strconv.Itoa(int(math.Round(s))) + "s"
	}
	return strconv.Itoa(int(math.Round(s/60))) + " min"
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
