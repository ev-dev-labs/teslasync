package science

import (
	"math"
	"math/rand"
	"sort"
)

// CI method labels. Every fit discloses which one it used.
const (
	CIStudentT  = "student_t_independent_errors"
	CIBootstrap = "bootstrap_percentile"
	CINone      = "none"
)

// Fit is one linear regression: y = intercept + slope*x.
type Fit struct {
	N         int     `json:"n"`
	Slope     float64 `json:"slope"`
	Intercept float64 `json:"intercept"`
	R2        float64 `json:"r2"`
	SESlope   float64 `json:"se_slope"`
	CI95Low   float64 `json:"ci95_low"`
	CI95High  float64 `json:"ci95_high"`
	CIMethod  string  `json:"ci_method"`
}

// LinReg fits y on x with a conditional Student-t slope interval.
// Independent Gaussian residuals are assumed, not established by this fit.
// Requires n≥3 and non-constant x; else ok=false and the
// caller must report the fit unknown, never a line through 2 points.
func LinReg(x, y []float64) (Fit, bool) {
	if len(x) != len(y) || len(x) < 3 {
		return Fit{}, false
	}
	n := float64(len(x))
	for i := range x {
		if math.IsNaN(x[i]) || math.IsNaN(y[i]) || math.IsInf(x[i], 0) || math.IsInf(y[i], 0) {
			return Fit{}, false
		}
	}
	mx, my := Mean(x), Mean(y)
	var sxx, sxy float64
	for i := range x {
		sxx += (x[i] - mx) * (x[i] - mx)
		sxy += (x[i] - mx) * (y[i] - my)
	}
	if sxx == 0 {
		return Fit{}, false
	}
	slope := sxy / sxx
	intercept := my - slope*mx
	var sse, sst float64
	for i := range x {
		r := y[i] - (intercept + slope*x[i])
		sse += r * r
		sst += (y[i] - my) * (y[i] - my)
	}
	r2 := 0.0
	if sst > 0 {
		r2 = 1 - sse/sst
	}
	se := 0.0
	if n > 2 {
		se = math.Sqrt((sse / (n - 2)) / sxx)
	}
	return Fit{
		N:         len(x),
		Slope:     slope,
		Intercept: intercept,
		R2:        r2,
		SESlope:   se,
		CI95Low:   slope - criticalT95(len(x)-2)*se,
		CI95High:  slope + criticalT95(len(x)-2)*se,
		CIMethod:  CIStudentT,
	}, true
}

// Two-sided 95% t critical values; higher degrees of freedom use a
// conservative lower-df bound rather than a small-sample normal interval.
func criticalT95(df int) float64 {
	values := [...]float64{0, 12.706205, 4.302653, 3.182447, 2.776445, 2.570582, 2.446912, 2.364625, 2.306005, 2.262158, 2.228139,
		2.200986, 2.178813, 2.160369, 2.144787, 2.131450, 2.119906, 2.109816, 2.100923, 2.093025, 2.085964,
		2.079614, 2.073874, 2.068658, 2.063899, 2.059539, 2.055529, 2.051831, 2.048408, 2.045230, 2.042273}
	if df < len(values) {
		return values[df]
	}
	if df < 60 {
		return values[30]
	}
	if df < 120 {
		return 2.000298
	}
	return 1.979931
}

// BootstrapSlope returns the percentile 95% CI of the regression slope
// over B resamples with a fixed seed (deterministic). Requires n≥3.
func BootstrapSlope(x, y []float64, b int) (low, high float64, ok bool) {
	if len(x) != len(y) || len(x) < 3 || b < 50 {
		return 0, 0, false
	}
	rng := rand.New(rand.NewSource(42))
	slopes := make([]float64, 0, b)
	n := len(x)
	for k := 0; k < b; k++ {
		xs := make([]float64, n)
		ys := make([]float64, n)
		for i := range xs {
			j := rng.Intn(n)
			xs[i], ys[i] = x[j], y[j]
		}
		if f, ok := LinReg(xs, ys); ok {
			slopes = append(slopes, f.Slope)
		}
	}
	if len(slopes) < 50 {
		return 0, 0, false
	}
	sort.Float64s(slopes)
	lo := int(0.025 * float64(len(slopes)))
	hi := int(0.975*float64(len(slopes))) - 1
	if hi <= lo {
		return 0, 0, false
	}
	return slopes[lo], slopes[hi], true
}

// HoldoutSplit cuts paired series ordered in time: the first 1-frac trains,
// the last frac validates. Returns false when either side has <3 points.
func HoldoutSplit(x, y []float64, frac float64) (trainX, trainY, testX, testY []float64, ok bool) {
	if len(x) != len(y) || frac <= 0 || frac >= 1 {
		return nil, nil, nil, nil, false
	}
	cut := int(float64(len(x)) * (1 - frac))
	if cut < 3 || len(x)-cut < 3 {
		return nil, nil, nil, nil, false
	}
	return x[:cut], y[:cut], x[cut:], y[cut:], true
}

// RMSE of y against predictions.
func RMSE(y, pred []float64) (float64, bool) {
	if len(y) != len(pred) || len(y) == 0 {
		return 0, false
	}
	var s float64
	for i := range y {
		s += (y[i] - pred[i]) * (y[i] - pred[i])
	}
	return math.Sqrt(s / float64(len(y))), true
}

// Pearson returns the correlation coefficient. Requires n≥3.
func Pearson(x, y []float64) (float64, bool) {
	if len(x) != len(y) || len(x) < 3 {
		return 0, false
	}
	mx, my := Mean(x), Mean(y)
	var num, dx, dy float64
	for i := range x {
		num += (x[i] - mx) * (y[i] - my)
		dx += (x[i] - mx) * (x[i] - mx)
		dy += (y[i] - my) * (y[i] - my)
	}
	if dx == 0 || dy == 0 {
		return 0, false
	}
	return num / math.Sqrt(dx*dy), true
}

// Mean of values. Empty input returns NaN.
func Mean(v []float64) float64 {
	if len(v) == 0 {
		return math.NaN()
	}
	var s float64
	for _, x := range v {
		s += x
	}
	return s / float64(len(v))
}

// StdDev is the sample standard deviation. Requires n≥2.
func StdDev(v []float64) (float64, bool) {
	if len(v) < 2 {
		return 0, false
	}
	m := Mean(v)
	var s float64
	for _, x := range v {
		s += (x - m) * (x - m)
	}
	return math.Sqrt(s / float64(len(v)-1)), true
}
