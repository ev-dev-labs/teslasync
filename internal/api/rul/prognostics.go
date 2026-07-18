package rul

import (
	"fmt"
	"math"
	"time"
)

// ---------------------------------------------------------------------------
// Pure, unit-testable core. Nothing in this file touches the database or the
// network. The only ambient dependency is the current time, which is INJECTED
// (`now time.Time`) into the two functions that emit dates, so every function
// here is a deterministic transform of its inputs — the linear regression,
// rate math, EOL projection, status classification, and forecast-series
// generation are reproducible and independently testable (prognostics_test.go).
// ---------------------------------------------------------------------------

// Status is the health classification of a component.
type Status string

const (
	StatusHealthy     Status = "healthy"
	StatusWatch       Status = "watch"
	StatusReplaceSoon Status = "replace_soon"
	StatusOverdue     Status = "overdue"
)

// Tunable, documented thresholds and constants. Named so a test can pin them
// and an admin-facing tuning surface could later expose them.
const (
	// replaceSoonDays — a valid projection with fewer than this many days left
	// is "replace soon".
	replaceSoonDays = 30.0
	// replaceSoonLifePct — under this % of usable life remaining is
	// "replace soon" regardless of the day count.
	replaceSoonLifePct = 10.0
	// watchLifePct — under this % of usable life remaining is "watch".
	watchLifePct = 25.0

	// adequateRegressionPoints — daily SoH samples at/above which the
	// data-adequacy weight on the battery confidence saturates to 1.0.
	adequateRegressionPoints = 30.0
	// adequateDriveSamples — drive rows at/above which the km-wear confidence
	// saturates to 1.0.
	adequateDriveSamples = 40.0
	// ageConfidenceCap — age-based estimates (12V, cabin filter) are exact on
	// elapsed time but blind to replacement history, so their confidence is
	// pinned here rather than derived from a fit.
	ageConfidenceCap = 0.6

	// maxProjectionDays caps a "remaining_days" sentinel so a near-zero wear
	// rate never yields +Inf on the wire (100 years).
	maxProjectionDays = 36500.0

	// minSoCForSoH — daily battery samples whose peak State-of-Charge is below
	// this are dropped from the SoH series: capacity extrapolated from a low
	// SoC is too noisy to trust.
	minSoCForSoH = 50.0

	// projectionSteps — number of segments (steps+1 points) in a forecast
	// series.
	projectionSteps = 24
	// defaultHorizonDays — forecast horizon used when the wear rate is flat /
	// indeterminate, so the chart still renders a short flat curve instead of
	// nothing.
	defaultHorizonDays = 180.0
	// maxBandFraction — the confidence band's half-width at the horizon under
	// ZERO confidence, as a fraction of the current→EOL health span.
	maxBandFraction = 0.35
)

// clamp bounds v to [lo, hi].
func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// round1/round2/round4 round to a fixed number of decimals so the JSON body
// carries a stable, display-ready numeric form (mirrors the carbon / tco
// rounding boundary). round4 keeps enough precision for the small per-day SoH
// decline of a healthy battery.
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

// Point is one (x, y) observation for the linear fit. X is typically days since
// the first sample; Y is the health metric (e.g. SoH %).
type Point struct {
	X float64
	Y float64
}

// Fit is the result of an ordinary-least-squares line fit.
type Fit struct {
	Slope     float64 // dY/dX
	Intercept float64 // Y at X=0
	R2        float64 // coefficient of determination, 0..1
	N         int     // sample count
}

// LinearFit computes the ordinary-least-squares line Y = Slope*X + Intercept
// plus R² over the points. Pure and deterministic. Degenerate inputs never
// produce NaN:
//
//   - N < 2            ⇒ zero slope, R²=0 (a single point's Y becomes the
//     intercept so callers can still read a "current" value).
//   - zero variance in X ⇒ zero slope, intercept = mean(Y), R²=0.
//   - zero variance in Y ⇒ zero slope, R²=0 (a flat metric carries no trend
//     information, so confidence stays low rather than a spurious R²=1).
func LinearFit(pts []Point) Fit {
	n := len(pts)
	if n < 2 {
		f := Fit{N: n}
		if n == 1 {
			f.Intercept = pts[0].Y
		}
		return f
	}
	var sumX, sumY, sumXY, sumX2 float64
	for _, p := range pts {
		sumX += p.X
		sumY += p.Y
		sumXY += p.X * p.Y
		sumX2 += p.X * p.X
	}
	fn := float64(n)
	meanX := sumX / fn
	meanY := sumY / fn
	ssX := sumX2 - fn*meanX*meanX
	if ssX <= 0 {
		// All X identical ⇒ no slope determinable. Report the mean as a flat
		// line so downstream rate math sees zero wear.
		return Fit{Slope: 0, Intercept: meanY, R2: 0, N: n}
	}
	slope := (sumXY - fn*meanX*meanY) / ssX
	intercept := meanY - slope*meanX

	var ssRes, ssTot float64
	for _, p := range pts {
		pred := intercept + slope*p.X
		ssRes += (p.Y - pred) * (p.Y - pred)
		ssTot += (p.Y - meanY) * (p.Y - meanY)
	}
	r2 := 0.0
	if ssTot > 0 {
		r2 = clamp(1-ssRes/ssTot, 0, 1)
	}
	return Fit{Slope: slope, Intercept: intercept, R2: r2, N: n}
}

// RegressionConfidence scores how trustworthy a battery degradation projection
// is: the fit quality (R²) scaled by a data-adequacy ramp on the sample count.
// Sparse history caps confidence low even for a tight fit. Clamped to [0,1].
// Pure.
func RegressionConfidence(r2 float64, n int) float64 {
	adequacy := clamp(float64(n)/adequateRegressionPoints, 0, 1)
	return clamp(clamp(r2, 0, 1)*adequacy, 0, 1)
}

// SampleConfidence scores an estimate that rests on a simple sample count (e.g.
// the drives backing a km/day rate): it ramps 0→1 as the count reaches
// `adequate`. Clamped to [0,1]. Pure.
func SampleConfidence(samples int, adequate float64) float64 {
	if adequate <= 0 {
		return 0
	}
	return clamp(float64(samples)/adequate, 0, 1)
}

// RemainingDays projects how many days until a linearly-declining health metric
// reaches its end-of-life threshold, from the current value and a positive
// per-day wear rate. A non-positive/NaN rate is "no measurable wear" ⇒
// (0, false): the caller MUST treat remaining life as indeterminate, never as
// zero. When current is already at/below eol the result is <= 0 (overdue) with
// ok=true. The positive result is capped at maxProjectionDays. Pure.
func RemainingDays(current, eol, ratePerDay float64) (days float64, ok bool) {
	if ratePerDay <= 0 || math.IsNaN(ratePerDay) || math.IsInf(ratePerDay, 0) {
		return 0, false
	}
	days = (current - eol) / ratePerDay
	if days > maxProjectionDays {
		days = maxProjectionDays
	}
	return days, true
}

// LifeRemainingPct maps a health value onto a 0..100 "fraction of usable life
// left", where 100 = fresh and 0 = at the end-of-life threshold. For the HV
// battery, health is SoH and eol is the SoH floor (e.g. 70); for wear/age parts
// eol is 0 so life-remaining equals health. Clamped to [0,100]. Pure.
func LifeRemainingPct(health, eol float64) float64 {
	span := 100 - eol
	if span <= 0 {
		return clamp(health, 0, 100)
	}
	return clamp((health-eol)/span*100, 0, 100)
}

// ClassifyStatus applies the documented, deterministic thresholds:
//
//   - overdue      — health already at/below EOL, OR a valid projection shows
//     remaining_days <= 0.
//   - replace_soon — < replaceSoonLifePct % life left, OR a valid projection
//     with < replaceSoonDays days left.
//   - watch        — < watchLifePct % of usable life left.
//   - healthy      — everything else, INCLUDING the sparse-data case (no
//     projection + ample life) so missing history never masquerades as a
//     failure.
//
// hasProjection guards the time-based branches so an indeterminate rate can
// never fabricate an "overdue" / "replace_soon" from a zero remaining_days.
// Pure.
func ClassifyStatus(healthBelowEOL, hasProjection bool, remainingDays, lifeRemainingPct float64) Status {
	if healthBelowEOL {
		return StatusOverdue
	}
	if hasProjection && remainingDays <= 0 {
		return StatusOverdue
	}
	if lifeRemainingPct < replaceSoonLifePct {
		return StatusReplaceSoon
	}
	if hasProjection && remainingDays < replaceSoonDays {
		return StatusReplaceSoon
	}
	if lifeRemainingPct < watchLifePct {
		return StatusWatch
	}
	return StatusHealthy
}

// KmPerDay is the distance-accumulation rate over an active window: km driven
// divided by the window span in days (span is floored at 1 day so a single busy
// day never divides by ~0). Non-positive km yields 0. Pure.
func KmPerDay(recentKm, spanDays float64) float64 {
	if recentKm <= 0 {
		return 0
	}
	if spanDays < 1 {
		spanDays = 1
	}
	return recentKm / spanDays
}

// DailyBattery is one day's peak battery observation: the highest EnergyRemaining
// (Wh) and highest State-of-Charge (%) seen that day.
type DailyBattery struct {
	Day         time.Time
	MaxEnergyWh float64
	MaxSocPct   float64
}

// BuildSoHSeries converts daily (max EnergyRemaining, max SoC) observations into
// a State-of-Health series suitable for LinearFit. For each qualifying day it
// extrapolates the observed pack energy up to a full 100% SoC —
// usable_capacity ≈ max_energy / (max_soc/100) — then SoH = usable_capacity /
// nominal * 100 (clamped to 100). Days whose peak SoC is below minSoCForSoH, or
// with non-positive energy, are dropped (their capacity estimate is too noisy).
// X is days since the first RETAINED day so the fit's slope is per-day. Pure.
func BuildSoHSeries(rows []DailyBattery, nominalWh float64) []Point {
	if nominalWh <= 0 || len(rows) == 0 {
		return nil
	}
	var pts []Point
	var first time.Time
	for _, r := range rows {
		if r.MaxSocPct < minSoCForSoH || r.MaxEnergyWh <= 0 {
			continue
		}
		usable := r.MaxEnergyWh / (r.MaxSocPct / 100.0)
		soh := usable / nominalWh * 100.0
		if soh <= 0 {
			continue
		}
		if soh > 100 {
			soh = 100
		}
		if first.IsZero() {
			first = r.Day
		}
		pts = append(pts, Point{X: r.Day.Sub(first).Hours() / 24.0, Y: soh})
	}
	return pts
}

// projInputs carries the numbers ProjectHealthSeries needs, produced alongside
// each ComponentRUL so the detail endpoint can render a forecast without
// recomputing the prognosis.
type projInputs struct {
	currentHealth  float64 // forecast start (SoH % for battery, life % otherwise)
	wearRatePerDay float64 // health %/day decline
	eolHealth      float64 // forecast floor (EOL threshold for battery, 0 otherwise)
	horizonDays    float64 // days to reach eol (<= 0 / indeterminate ⇒ flat default)
	confidence     float64
}

// BatteryRUL derives the HV-battery prognosis from a daily SoH series. It fits a
// line, reads the current SoH off the fit at the latest sample (smoothing
// outliers vs. the raw last point), projects the days until SoH crosses the
// eolThreshold, and classifies. Confidence follows the fit quality + history
// length. An empty series degrades to healthy / zero-confidence rather than
// NaN. Pure/deterministic given `now`.
func BatteryRUL(cfg ComponentConfig, label string, series []Point, now time.Time) (ComponentRUL, projInputs) {
	eol := 70.0
	if cfg.EOLThreshold != nil {
		eol = *cfg.EOLThreshold
	}

	c := ComponentRUL{Component: cfg.Component, Label: label, Status: string(StatusHealthy)}

	if len(series) == 0 {
		c.HealthPct = 0
		c.Confidence = 0
		c.RemainingDays = maxProjectionDays
		c.Basis = "No battery state-of-health history yet; awaiting charge/energy telemetry."
		return c, projInputs{currentHealth: 100, eolHealth: eol, horizonDays: 0, confidence: 0}
	}

	fit := LinearFit(series)
	current := series[len(series)-1].Y
	if fit.N >= 2 {
		current = fit.Intercept + fit.Slope*series[len(series)-1].X
	}
	current = clamp(current, 0, 100)

	rate := 0.0
	if fit.Slope < 0 {
		rate = -fit.Slope
	}
	conf := RegressionConfidence(fit.R2, fit.N)
	remaining, ok := RemainingDays(current, eol, rate)
	life := LifeRemainingPct(current, eol)
	status := ClassifyStatus(current <= eol, ok, remaining, life)

	c.HealthPct = round1(current)
	c.WearRatePerDay = round4(rate)
	c.Confidence = round2(conf)
	c.Status = string(status)
	if ok {
		c.RemainingDays = round1(clamp(remaining, 0, maxProjectionDays))
		if remaining > 0 {
			c.ProjectedEOLDate = eolDatePtr(now, remaining)
		}
		c.Basis = fmt.Sprintf(
			"Linear SoH trend over %d daily samples (%.3f%%/day decline, R²=%.2f); end-of-life at %.0f%% SoH.",
			fit.N, rate, fit.R2, eol)
	} else {
		c.RemainingDays = maxProjectionDays
		c.Basis = fmt.Sprintf(
			"SoH ~%.1f%% over %d samples shows no measurable decline yet; projection deferred until a trend emerges.",
			current, fit.N)
	}
	return c, projInputs{currentHealth: current, wearRatePerDay: rate, eolHealth: eol, horizonDays: remaining, confidence: conf}
}

// WearRUL derives a distance-wear prognosis (tires, brakes) from the lifetime
// odometer (kmSinceRef — a whole-life proxy; there is no per-service reset
// feed, documented in doc.go) and a recent km/day accumulation rate.
// remaining_km = nominal - kmSinceRef; remaining_days = remaining_km / kmPerDay.
// Health is the % of nominal life left. Confidence ramps with the drive count
// backing the rate. Pure/deterministic given `now`.
func WearRUL(cfg ComponentConfig, label string, kmSinceRef, kmPerDay float64, driveSamples int, now time.Time) (ComponentRUL, projInputs) {
	c := ComponentRUL{Component: cfg.Component, Label: label, Status: string(StatusHealthy)}

	nominalKm := 0.0
	if cfg.NominalLifeKm != nil {
		nominalKm = *cfg.NominalLifeKm
	}
	if nominalKm <= 0 {
		c.HealthPct = 100
		c.Basis = "No nominal distance life configured for this component."
		return c, projInputs{currentHealth: 100, eolHealth: 0, horizonDays: 0, confidence: 0}
	}

	remainingKm := nominalKm - kmSinceRef
	health := clamp(remainingKm/nominalKm*100, 0, 100)
	rate := 0.0 // health %/day
	if kmPerDay > 0 {
		rate = kmPerDay / nominalKm * 100
	}
	conf := SampleConfidence(driveSamples, adequateDriveSamples)
	remaining, ok := RemainingDays(health, 0, rate)
	status := ClassifyStatus(remainingKm <= 0, ok, remaining, health)

	c.HealthPct = round1(health)
	c.WearRatePerDay = round4(rate)
	c.Confidence = round2(conf)
	c.Status = string(status)
	rkm := round1(math.Max(remainingKm, 0))
	c.RemainingKm = &rkm
	if ok {
		c.RemainingDays = round1(clamp(remaining, 0, maxProjectionDays))
		if remaining > 0 {
			c.ProjectedEOLDate = eolDatePtr(now, remaining)
		}
	} else {
		c.RemainingDays = maxProjectionDays
	}
	c.Basis = fmt.Sprintf(
		"Whole-life estimate: %.0f of %.0f km used at %.1f km/day (odometer proxy; no per-service reset data).",
		safeF(kmSinceRef), nominalKm, safeF(kmPerDay))
	return c, projInputs{currentHealth: health, wearRatePerDay: rate, eolHealth: 0, horizonDays: remaining, confidence: conf}
}

// AgeRUL derives an age-based prognosis (12V battery, cabin filter) from elapsed
// service days versus a nominal calendar life. remaining_days = nominal - age.
// Health is the % of calendar life left. Confidence is fixed at ageConfidenceCap
// — the elapsed time is exact, but replacement history is unknown, so it is
// capped rather than derived. Pure/deterministic given `now`.
func AgeRUL(cfg ComponentConfig, label string, ageDays float64, now time.Time) (ComponentRUL, projInputs) {
	c := ComponentRUL{Component: cfg.Component, Label: label, Status: string(StatusHealthy)}

	nominalDays := 0
	if cfg.NominalLifeDays != nil {
		nominalDays = *cfg.NominalLifeDays
	}
	if nominalDays <= 0 {
		c.HealthPct = 100
		c.Basis = "No nominal calendar life configured for this component."
		return c, projInputs{currentHealth: 100, eolHealth: 0, horizonDays: 0, confidence: 0}
	}
	if ageDays < 0 {
		ageDays = 0
	}

	nd := float64(nominalDays)
	remaining := nd - ageDays
	health := clamp(remaining/nd*100, 0, 100)
	rate := 100.0 / nd // health %/day
	conf := ageConfidenceCap

	status := ClassifyStatus(remaining <= 0, true, remaining, health)

	c.HealthPct = round1(health)
	c.WearRatePerDay = round4(rate)
	c.Confidence = round2(conf)
	c.Status = string(status)
	if remaining > 0 {
		c.RemainingDays = round1(clamp(remaining, 0, maxProjectionDays))
		c.ProjectedEOLDate = eolDatePtr(now, remaining)
	} else {
		c.RemainingDays = 0
	}
	c.Basis = fmt.Sprintf(
		"Age-based: %.0f of %d days of nominal calendar life elapsed since enrollment (no replacement record).",
		ageDays, nominalDays)
	return c, projInputs{currentHealth: health, wearRatePerDay: rate, eolHealth: 0, horizonDays: remaining, confidence: conf}
}

// NextServiceDue picks the component that needs attention soonest — the one with
// the nearest projected EOL date. Components with no projectable date (flat /
// indeterminate rate) are skipped. Returns nil when nothing is projectable.
// Because the dates are YYYY-MM-DD, a lexical compare is a chronological one.
// Pure.
func NextServiceDue(components []ComponentRUL) *NextService {
	var best *ComponentRUL
	for i := range components {
		c := &components[i]
		if c.ProjectedEOLDate == nil {
			continue
		}
		if best == nil || *c.ProjectedEOLDate < *best.ProjectedEOLDate {
			best = c
		}
	}
	if best == nil {
		return nil
	}
	return &NextService{Component: best.Component, Date: best.ProjectedEOLDate}
}

// ProjectionPoint is one sample of a forecast curve: the projected health at a
// date, plus a confidence band around it.
type ProjectionPoint struct {
	Date            string  `json:"date"`
	ProjectedHealth float64 `json:"projected_health"`
	ConfidenceLow   float64 `json:"confidence_low"`
	ConfidenceHigh  float64 `json:"confidence_high"`
}

// ProjectHealthSeries builds a forecast of a health metric decaying linearly at
// wearRatePerDay from `current` toward `eol`, sampled steps+1 times between
// `now` and the projected EOL (horizonDays out). The confidence band widens
// with time AND with lower confidence: its half-width grows from 0 today to
// maxBandFraction*(current-eol)*(1-confidence) at the horizon. A flat /
// indeterminate horizon falls back to defaultHorizonDays so the chart is never
// empty. Everything is clamped so the wire never carries NaN/Inf or a health
// outside [eol, current]. Deterministic given `now`; pure.
func ProjectHealthSeries(now time.Time, current, wearRatePerDay, eol, horizonDays, confidence float64, steps int) []ProjectionPoint {
	if steps < 1 {
		steps = 1
	}
	h := horizonDays
	if h <= 0 || math.IsNaN(h) || math.IsInf(h, 0) {
		h = defaultHorizonDays
	}
	if h > maxProjectionDays {
		h = maxProjectionDays
	}
	conf := clamp(confidence, 0, 1)
	floor := math.Min(current, eol)
	ceil := math.Max(current, eol)
	bandMax := (current - eol) * maxBandFraction
	if bandMax < 0 {
		bandMax = 0
	}

	out := make([]ProjectionPoint, 0, steps+1)
	for i := 0; i <= steps; i++ {
		frac := float64(i) / float64(steps)
		dayOffset := frac * h
		health := clamp(current-wearRatePerDay*dayOffset, floor, ceil)
		band := bandMax * (1 - conf) * frac
		out = append(out, ProjectionPoint{
			Date:            now.AddDate(0, 0, int(math.Round(dayOffset))).Format("2006-01-02"),
			ProjectedHealth: round1(safeF(health)),
			ConfidenceLow:   round1(clamp(health-band, 0, 100)),
			ConfidenceHigh:  round1(clamp(health+band, 0, 100)),
		})
	}
	return out
}

// eolDatePtr renders `now + days` as a *YYYY-MM-DD string for the JSON body.
// Caller guarantees days > 0.
func eolDatePtr(now time.Time, days float64) *string {
	d := clamp(days, 0, maxProjectionDays)
	s := now.AddDate(0, 0, int(math.Round(d))).Format("2006-01-02")
	return &s
}
