package science

import (
	"math"
	"sort"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/physics"
)

// Rest-detection and fit-gate constants.
const (
	RestQuietA = physics.PackCurrentQuietA
	// RestDwellMin is the minimum quiet dwell for an OCV point.
	RestDwellMin = 10.0
	// OCVBinMinN gates per-bin OCV slope fits.
	OCVBinMinN = 20
	// IRStepMinA is the minimum |dI| for a DCIR step.
	IRStepMinA = 5.0
	// IROhmicLoS / IROhmicHiS bound the ohmic dt window (documented).
	IROhmicLoS = 1.0
	IROhmicHiS = 10.0
	// ArrheniusMinBins / ArrheniusMinSpanC gate the Ea fit.
	ArrheniusMinBins  = 3
	ArrheniusMinSpanC = 10.0
	// GasConstantR is J/(mol K).
	GasConstantR = 8.314
)

// RestWindow is one quiet Park dwell usable for OCV.
type RestWindow struct {
	Start     time.Time
	End       time.Time
	DwellS    float64
	V         float64
	SocPct    float64
	TempC     *float64
	EnergyWh  *float64
	Direction string
}

// FindRest scans sorted samples for Park + quiet-current dwells of at
// least RestDwellMin minutes. Overlapping charge (Charging/Starting) is
// excluded. Direction comes from pre-window current polarity.
func FindRest(samples []physics.Sample) []RestWindow {
	out := []RestWindow{}
	var cur *RestWindow
	var lastV, lastSoc float64
	var vN int
	var lastT *float64
	var lastE *float64
	finish := func() {
		if cur == nil {
			return
		}
		cur.DwellS = cur.End.Sub(cur.Start).Seconds()
		if cur.DwellS >= RestDwellMin*60 && vN > 0 {
			cur.V, cur.SocPct = lastV, lastSoc
			cur.TempC, cur.EnergyWh = lastT, lastE
			out = append(out, *cur)
		}
		cur = nil
	}
	for i := range samples {
		s := samples[i]
		if i > 0 {
			dt := s.At.Sub(samples[i-1].At).Seconds()
			if dt <= 0 || dt > physics.DefaultUnknownGapS || s.Firmware != samples[i-1].Firmware {
				finish()
			}
		}
		quiet := s.Gear == "P" && s.PackCurrentA != nil && math.Abs(*s.PackCurrentA) < RestQuietA
		charging := s.DetailedChargeState == "Charging" || s.DetailedChargeState == "Starting" ||
			s.ChargeState == "Charging" || s.ChargeState == "Starting"
		if quiet && !charging && s.PackVoltageV != nil && s.SocPct != nil {
			if cur == nil {
				cur = &RestWindow{Start: s.At, Direction: restDirection(samples, i)}
				lastV, lastSoc, vN = 0, 0, 0
				lastT, lastE = nil, nil
			}
			cur.End = s.At
			lastV = *s.PackVoltageV
			lastSoc = *s.SocPct
			vN++
			if s.PackTempMaxC != nil {
				lastT = s.PackTempMaxC
			}
			if s.EnergyRemainingWh != nil {
				lastE = s.EnergyRemainingWh
			}
		} else {
			finish()
		}
	}
	finish()
	return out
}

// restDirection reads pre-window current polarity (Tesla sign:
// positive = charging into pack).
func restDirection(samples []physics.Sample, i int) string {
	start := samples[i].At.Add(-5 * time.Minute)
	var sum float64
	var n int
	for j := i - 1; j >= 0; j-- {
		if samples[j].At.Before(start) {
			break
		}
		if samples[j].PackCurrentA != nil {
			sum += *samples[j].PackCurrentA
			n++
		}
	}
	if n == 0 {
		return "undetermined"
	}
	avg := sum / float64(n)
	if avg > RestQuietA {
		return "charge_rest"
	}
	if avg < -RestQuietA {
		return "discharge_rest"
	}
	return "undetermined"
}

// OCVBins builds the OCV(SOC) surface: 10%-SOC bins × 10°C temp bins.
// Bins below OCVBinMinN report unknown slopes, never a fit.
func OCVBins(points []OCVPoint) []OCVBin {
	type key struct{ soc, temp int }
	groups := map[key][]OCVPoint{}
	for _, p := range points {
		if p.TempC == nil {
			continue
		}
		t := *p.TempC
		groups[key{int(p.SocPct / 10), int(math.Floor(t / 10))}] = append(groups[key{int(p.SocPct / 10), int(math.Floor(t / 10))}], p)
	}
	out := []OCVBin{}
	for k, g := range groups {
		b := OCVBin{
			SocLoPct: float64(k.soc * 10), SocHiPct: float64(k.soc*10 + 10),
			TempLoC: float64(k.temp * 10), TempHiC: float64(k.temp*10 + 10),
			N: len(g), Unknown: true,
		}
		var s float64
		for _, p := range g {
			s += p.OCVPackV
		}
		b.MeanOCVV = s / float64(len(g))
		if len(g) >= OCVBinMinN {
			xs := make([]float64, len(g))
			ys := make([]float64, len(g))
			for i, p := range g {
				xs[i], ys[i] = p.SocPct, p.OCVPackV
			}
			if f, ok := LinReg(xs, ys); ok {
				b.SlopeVPerPct = &f.Slope
				b.Unknown = false
			}
		}
		out = append(out, b)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].SocLoPct != out[j].SocLoPct {
			return out[i].SocLoPct < out[j].SocLoPct
		}
		return out[i].TempLoC < out[j].TempLoC
	})
	return out
}

// Hysteresis computes charge-rest minus discharge-rest means per SOC bin.
// Bins need ≥3 points per side; else unknown.
func Hysteresis(points []OCVPoint) []HysteresisBin {
	type side struct{ c, d []float64 }
	type bin struct{ soc, temp int }
	groups := map[bin]*side{}
	for _, p := range points {
		if p.TempC == nil {
			continue
		}
		b := bin{int(p.SocPct / 10), int(math.Floor(*p.TempC / 10))}
		g := groups[b]
		if g == nil {
			g = &side{}
			groups[b] = g
		}
		switch p.Direction {
		case "charge_rest":
			g.c = append(g.c, p.OCVPackV)
		case "discharge_rest":
			g.d = append(g.d, p.OCVPackV)
		}
	}
	out := []HysteresisBin{}
	for b, g := range groups {
		h := HysteresisBin{
			SocLoPct: float64(b.soc * 10), SocHiPct: float64(b.soc*10 + 10),
			TempLoC: float64(b.temp * 10), TempHiC: float64(b.temp*10 + 10),
			NCharge: len(g.c), NDischarge: len(g.d), Unknown: true,
		}
		if len(g.c) >= 3 && len(g.d) >= 3 {
			d := Mean(g.c) - Mean(g.d)
			h.DeltaV = &d
			h.Unknown = false
		}
		out = append(out, h)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].SocLoPct != out[j].SocLoPct {
			return out[i].SocLoPct < out[j].SocLoPct
		}
		return out[i].TempLoC < out[j].TempLoC
	})
	return out
}

// DCIR finds current steps with simultaneous V and I: dt in the ohmic
// window, |dI| above threshold. Gaps (missing V/I) reject the pair.
func DCIR(samples []physics.Sample, context string) []IRPoint {
	out := []IRPoint{}
	for i := 1; i < len(samples); i++ {
		prev, cur := samples[i-1], samples[i]
		if prev.ElectricalUnaligned || cur.ElectricalUnaligned {
			continue
		}
		dt := cur.At.Sub(prev.At).Seconds()
		if dt < IROhmicLoS || dt > IROhmicHiS {
			continue
		}
		if prev.PackVoltageV == nil || cur.PackVoltageV == nil ||
			prev.PackCurrentA == nil || cur.PackCurrentA == nil {
			continue
		}
		di := *cur.PackCurrentA - *prev.PackCurrentA
		if math.Abs(di) < IRStepMinA {
			continue
		}
		dv := *cur.PackVoltageV - *prev.PackVoltageV
		ir := dv / di
		if ir <= 0 || math.IsNaN(ir) || math.IsInf(ir, 0) || cur.Firmware != prev.Firmware {
			continue
		}
		p := IRPoint{
			At: cur.At.UTC(), IRPackOhm: ir,
			DeltaIV: di, DeltaVV: dv, DtS: dt, Context: context,
		}
		if cur.PackTempMaxC != nil {
			p.TempC = cur.PackTempMaxC
		}
		if cur.SocPct != nil {
			p.SocPct = cur.SocPct
		}
		out = append(out, p)
	}
	return out
}

// Arrhenius fits ln(IR) vs 1/T(K). Requires ≥3 temp bins spanning ≥10°C;
// below that the fit is unknown, never a two-point line.
func Arrhenius(points []IRPoint) ArrheniusFit {
	a := ArrheniusFit{Unknown: true, Honesty: ArrheniusHonesty}
	xs := []float64{}
	ys := []float64{}
	bins := map[int]bool{}
	lo, hi := 0.0, 0.0
	first := true
	for _, p := range points {
		if p.TempC == nil || p.IRPackOhm <= 0 {
			continue
		}
		tk := *p.TempC + 273.15
		if tk <= 0 {
			continue
		}
		xs = append(xs, 1/tk)
		ys = append(ys, math.Log(p.IRPackOhm))
		bins[int(math.Floor(*p.TempC/5))] = true
		if first || *p.TempC < lo {
			lo = *p.TempC
		}
		if first || *p.TempC > hi {
			hi = *p.TempC
		}
		first = false
	}
	a.TempBins = len(bins)
	a.TempSpanC = hi - lo
	if len(bins) < ArrheniusMinBins || hi-lo < ArrheniusMinSpanC {
		return a
	}
	f, ok := LinReg(xs, ys)
	if !ok {
		return a
	}
	a.Fit = f
	// Pack resistance follows R ~ exp(+Ea/RT): ln(IR) vs 1/T has a
	// positive slope and Ea = slope·R.
	ea := f.Slope * GasConstantR
	a.EaJPerMol = &ea
	loEa := f.CI95Low * GasConstantR
	hiEa := f.CI95High * GasConstantR
	a.EaCI95Low, a.EaCI95High = &loEa, &hiEa
	a.Unknown = false
	return a
}

// CapacityProxy tracks energy_remaining / soc_fraction at rest over time.
// Slope comes with analytic CI plus holdout RMSE; below n=6 the slope is
// unknown. This is a proxy with uncertainty, never a bare health percent.
func CapacityProxy(points []OCVPoint) (slopeWhPerDay, ciLow, ciHigh float64, n int, holdoutRMSE *float64, ok bool) {
	if len(points) < 6 {
		return 0, 0, 0, len(points), nil, false
	}
	pts := append([]OCVPoint(nil), points...)
	sort.Slice(pts, func(i, j int) bool { return pts[i].At.Before(pts[j].At) })
	xs := []float64{}
	ys := []float64{}
	t0 := pts[0].At
	for _, p := range pts {
		if p.EnergyWh == nil || p.SocPct <= 1 {
			continue
		}
		xs = append(xs, p.At.Sub(t0).Hours()/24)
		ys = append(ys, *p.EnergyWh/(p.SocPct/100))
	}
	if len(xs) < 6 {
		return 0, 0, 0, len(xs), nil, false
	}
	trainX, trainY, testX, testY, splitOK := HoldoutSplit(xs, ys, 0.2)
	if !splitOK {
		return 0, 0, 0, len(xs), nil, false
	}
	f, ok := LinReg(trainX, trainY)
	if !ok {
		return 0, 0, 0, len(xs), nil, false
	}
	if testX != nil {
		pred := make([]float64, len(testX))
		for i := range testX {
			pred[i] = f.Intercept + f.Slope*testX[i]
		}
		if rmse, ok := RMSE(testY, pred); ok {
			holdoutRMSE = &rmse
		}
	}
	return f.Slope, f.CI95Low, f.CI95High, len(xs), holdoutRMSE, true
}

// DominantFirmware returns the mode firmware label, or "unknown".
func DominantFirmware(samples []physics.Sample) string {
	counts := map[string]int{}
	best, bestN := "unknown", 0
	for _, s := range samples {
		if s.Firmware == "" {
			continue
		}
		counts[s.Firmware]++
		if counts[s.Firmware] > bestN {
			best, bestN = s.Firmware, counts[s.Firmware]
		}
	}
	return best
}
