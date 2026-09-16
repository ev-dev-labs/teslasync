package science

import (
	"math"

	"github.com/ev-dev-labs/teslasync/internal/physics"
)

// Underinflation model constants. The linear 10%-per-fraction rule is a
// labeled model, not a measurement: extra Crr fraction ≈ 0.10 × ΔP
// fraction. Uncertainty is a wide ±50% band disclosed on the payload.
const (
	UnderinflationGain   = 0.10
	UnderinflationUncRel = 0.50
)

// UnderinflationFrac returns the worst-corner pressure deficit fraction
// against recommended kPa, or nil when inputs are missing.
func UnderinflationFrac(fl, fr, rl, rr, recommended *float64) *float64 {
	if recommended == nil || *recommended <= 0 || math.IsNaN(*recommended) || math.IsInf(*recommended, 0) {
		return nil
	}
	worst := 0.0
	for _, p := range []*float64{fl, fr, rl, rr} {
		if p == nil || *p <= 0 || math.IsNaN(*p) || math.IsInf(*p, 0) {
			return nil
		}
		deficit := (*recommended - *p) / *recommended
		if deficit > worst {
			worst = deficit
		}
	}
	return &worst
}

// UnderinflationWh estimates extra rolling energy over distanceM given
// base rolling Wh and the deficit fraction. Returns estimate + sensitivity band
// ends. Unknown inputs → ok=false, never zero.
func UnderinflationWh(baseRollingWh, deficitFrac *float64) (est, lo, hi float64, ok bool) {
	if baseRollingWh == nil || deficitFrac == nil || *deficitFrac < 0 || *baseRollingWh < 0 ||
		math.IsNaN(*baseRollingWh) || math.IsInf(*baseRollingWh, 0) || math.IsNaN(*deficitFrac) || math.IsInf(*deficitFrac, 0) {
		return 0, 0, 0, false
	}

	est = *baseRollingWh * UnderinflationGain * *deficitFrac
	half := est * UnderinflationUncRel
	return est, est - half, est + half, true
}

// Rolling loss depends on distance traveled at each pressure, not the latest
// pressure applied retroactively to every trip in the window.
func DistanceWeightedDeficit(samples []physics.Sample, recommended *float64) *float64 {
	var weighted, distance float64
	for i := 1; i < len(samples); i++ {
		a, b := samples[i-1], samples[i]
		dt := b.At.Sub(a.At).Seconds()
		if dt <= 0 || dt > physics.DefaultUnknownGapS || a.SpeedMps == nil || b.SpeedMps == nil {
			return nil
		}
		if math.IsNaN(*a.SpeedMps) || math.IsInf(*a.SpeedMps, 0) || math.IsNaN(*b.SpeedMps) || math.IsInf(*b.SpeedMps, 0) {
			return nil
		}
		d := (math.Abs(*a.SpeedMps) + math.Abs(*b.SpeedMps)) / 2 * dt
		if d == 0 {
			continue
		}
		lo := UnderinflationFrac(a.TpmsFLKpa, a.TpmsFRKpa, a.TpmsRLKpa, a.TpmsRRKpa, recommended)
		hi := UnderinflationFrac(b.TpmsFLKpa, b.TpmsFRKpa, b.TpmsRLKpa, b.TpmsRRKpa, recommended)
		if lo == nil || hi == nil {
			return nil
		}
		weighted += (*lo + *hi) / 2 * d
		distance += d
	}
	if distance <= 0 {
		return nil
	}
	value := weighted / distance
	return &value
}
