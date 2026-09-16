package science

import (
	"math"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/physics"
)

// Thermal gate constants.
const (
	// ThermalMinDTC is the minimum |T0-Tinf| for a fittable transient.
	ThermalMinDTC = 3.0
	// ThermalMinN gates log-linear tau fits.
	ThermalMinN = 6
	// Slower temperature feeds may legitimately have a five-minute cadence.
	ThermalMaxGap = 5 * time.Minute
)

// TempSample is one pack/cabin/ambient observation.
type TempSample struct {
	At       time.Time
	PackC    *float64
	CabinC   *float64
	AmbientC *float64
	SentryOn bool
	HvacW    *float64
}

// TempSamplesFromPhysics projects solver samples to thermal inputs.
func TempSamplesFromPhysics(samples []physics.Sample) []TempSample {
	out := make([]TempSample, 0, len(samples))
	for _, s := range samples {
		out = append(out, TempSample{
			At: s.At, PackC: s.PackTempMaxC, CabinC: s.InsideTempC,
			AmbientC: s.OutsideTempC, SentryOn: s.SentryOn, HvacW: s.HvacPowerW,
		})
	}
	return out
}

// FitCooldown fits T(t) = Tinf + (T0-Tinf)·e^(-t/τ) by log-linear
// regression on (T-Tinf). Ambient pins Tinf; without it the fit is
// unknown. Sentry-on windows are rejected (active load, not passive).
func FitCooldown(samples []TempSample, pack bool) ThermalFit {
	f := ThermalFit{Kind: "pack_cooldown", Unknown: true, SolarUnk: true}
	if !pack {
		f.Kind = "cabin_cooldown"
	}
	pts := make([]TempSample, 0, len(samples))
	for _, s := range samples {
		if s.SentryOn || s.HvacW == nil || *s.HvacW != 0 {
			return f
		}
		var t *float64
		if pack {
			t = s.PackC
		} else {
			t = s.CabinC
		}
		if t == nil || s.AmbientC == nil {
			return f
		}
		pts = append(pts, s)
	}
	if len(pts) < ThermalMinN {
		return f
	}
	sort.Slice(pts, func(i, j int) bool { return pts[i].At.Before(pts[j].At) })
	t0 := pts[0].At
	f.Start, f.End = t0.UTC(), pts[len(pts)-1].At.UTC()
	tinf := *pts[len(pts)-1].AmbientC
	for i, s := range pts {
		if math.Abs(*s.AmbientC-tinf) > 1 {
			return f
		}
		if i > 0 && (!s.At.After(pts[i-1].At) || s.At.Sub(pts[i-1].At) > ThermalMaxGap) {
			return f
		}
	}
	f.TInfC = &tinf
	var t0v float64
	if pack {
		t0v = *pts[0].PackC
	} else {
		t0v = *pts[0].CabinC
	}
	if math.Abs(t0v-tinf) < ThermalMinDTC {
		return f
	}
	xs := []float64{}
	ys := []float64{}
	for _, s := range pts {
		var t float64
		if pack {
			t = *s.PackC
		} else {
			t = *s.CabinC
		}
		d := (t - tinf) / (t0v - tinf)
		if d <= 0 {
			return f
		}
		xs = append(xs, s.At.Sub(t0).Seconds())
		ys = append(ys, math.Log(d))
	}
	if len(xs) < ThermalMinN {
		return f
	}
	lr, ok := LinReg(xs, ys)
	if !ok || lr.Slope >= 0 {
		return f
	}
	tau := -1 / lr.Slope
	f.TauS = &tau
	// CI via slope CI inversion (slope < 0 both ends required).
	if lr.CI95Low < 0 && lr.CI95High < 0 {
		lo, hi := -1/lr.CI95Low, -1/lr.CI95High
		if lo > hi {
			lo, hi = hi, lo
		}
		f.TauCI95Low, f.TauCI95High = &lo, &hi
	}
	f.N = len(xs)
	f.R2 = &lr.R2
	pred := make([]float64, len(xs))
	meas := make([]float64, len(xs))
	for i := range xs {
		pred[i] = tinf + (t0v-tinf)*math.Exp(-xs[i]/tau)
		meas[i] = tinf + (t0v-tinf)*math.Exp(ys[i])
	}
	if rmse, ok := RMSE(meas, pred); ok {
		f.ResidualC = &rmse
	}
	f.Unknown = false
	return f
}
