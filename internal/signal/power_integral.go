package signal

import (
	"math"
	"sort"
	"time"
)

// PowerSample is signed battery power: positive draw, negative recovery.
// Nil explicitly ends a known interval; it is not measured zero.
type PowerSample struct {
	Time   time.Time
	PowerW *float64
}

type PowerIntegral struct {
	DrawWh   float64
	RegenWh  float64
	CoveredS float64
}

func (e PowerIntegral) MeanPowerW() (float64, bool) {
	if e.CoveredS <= 0 {
		return 0, false
	}
	w := (e.DrawWh - e.RegenWh) * 3600 / e.CoveredS
	return w, !math.IsNaN(w) && !math.IsInf(w, 0)
}

// IntegratePower holds each change-feed observation until the next change,
// clipping intervals to the requested window instead of weighting emissions.
func IntegratePower(samples []PowerSample, from, to time.Time) PowerIntegral {
	var out PowerIntegral
	if !to.After(from) {
		return out
	}
	ordered := append([]PowerSample(nil), samples...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Time.Before(ordered[j].Time) })
	for i, sample := range ordered {
		if sample.PowerW == nil || math.IsNaN(*sample.PowerW) || math.IsInf(*sample.PowerW, 0) {
			continue
		}
		start, end := sample.Time, to
		if start.Before(from) {
			start = from
		}
		if i+1 < len(ordered) && ordered[i+1].Time.Before(end) {
			end = ordered[i+1].Time
		}
		if !end.After(start) {
			continue
		}
		seconds := end.Sub(start).Seconds()
		energyWh := *sample.PowerW * seconds / 3600
		if math.IsNaN(energyWh) || math.IsInf(energyWh, 0) {
			continue
		}
		out.CoveredS += seconds
		if energyWh >= 0 {
			out.DrawWh += energyWh
		} else {
			out.RegenWh -= energyWh
		}
	}
	return out
}
