// Package waitoracle predicts Supercharger wait times from the fleet's
// own charging history (tesla_charging_sessions).
//
// Model: arrivals per hour-of-week bucket give the arrival rate λ;
// the site median session duration gives the service time; Little's law
// (L = λW) yields offered load in Erlangs; Erlang-C for a c-stall site
// yields the wait probability and expected queue delay. Stall count is
// unknown from session data, so it is estimated as the peak concurrency
// ever observed at the site — a documented lower bound.
//
// All buckets are UTC: historical starts are UTC and the arrival instant
// is converted to UTC before bucketing, so the curve is self-consistent
// (DST smears bucket edges by up to an hour twice a year).
package waitoracle

import (
	"math"
	"sort"
	"strconv"
	"time"
)

// Verdicts for the arrival bucket.
const (
	VerdictQuiet  = "quiet"
	VerdictSteady = "steady"
	VerdictBusy   = "busy"
	VerdictPacked = "packed"
)

// Confidence levels, driven by sample depth.
const (
	ConfidenceHigh   = "high"
	ConfidenceMedium = "medium"
	ConfidenceLow    = "low"
)

const (
	hoursPerWeek = 24 * 7
	// minBucketStarts gates medium confidence: fewer starts in the
	// arrival bucket and the estimate leans on the site average.
	minBucketStarts = 8
	// minSiteSessions gates the forecast at all: below this the site
	// has no usable history.
	minSiteSessions = 10
	// maxHistoryRows bounds the raw session pull for median/concurrency.
	maxHistoryRows = 10000
	// historyWeeks bounds how far back demand is measured, so closed
	// or rebuilt sites age out of the curve.
	historyWeeks = 26
)

// Bucket is one hour-of-week demand cell in UTC.
type Bucket struct {
	Weekday int // 0=Sunday, matching time.Weekday
	Hour    int // 0..23 UTC
	Starts  int // session starts observed in this cell
	// Congested counts starts that paid a congestion fee — Tesla's own
	// "this site was full" signal.
	Congested int
}

// Session is the minimal (start, stop) pair for median + concurrency.
type Session struct {
	Start time.Time
	Stop  time.Time
}

// SiteHistory is everything Forecast needs: pre-aggregated demand plus
// raw sessions for duration/concurrency.
type SiteHistory struct {
	Site     string
	Sessions int // total sessions in window (uncapped count)
	Weeks    float64
	Buckets  []Bucket // sparse; missing cells are zero
	Spans    []Session
}

// HourPoint is one hour of the arrival day for the chart.
type HourPoint struct {
	Hour        int     `json:"hour"`
	ExpectedMin float64 `json:"expected_wait_min"`
	Busyness    float64 `json:"busyness"`
}

// Forecast is the wait prediction for one arrival instant.
type Forecast struct {
	Site           string      `json:"site"`
	ArriveAt       time.Time   `json:"arrive_at"`
	ExpectedMin    float64     `json:"expected_wait_min"`
	WaitProbPct    float64     `json:"wait_probability_pct"`
	Busyness       float64     `json:"busyness"`
	Verdict        string      `json:"verdict"`
	Confidence     string      `json:"confidence"`
	StallsEstimate int         `json:"stalls_estimated"`
	BestHour       int         `json:"best_hour_utc"`
	BestWaitMin    float64     `json:"best_wait_min"`
	SaveMin        float64     `json:"save_min"`
	Hours          []HourPoint `json:"hours"`
	Evidence       []string    `json:"evidence"`
}

// ErrNoHistory is returned when the site has too little data.
type noHistoryError string

func (e noHistoryError) Error() string { return string(e) }

// ErrNoHistory signals insufficient site history.
const ErrNoHistory = noHistoryError("site has insufficient charging history")

// Predict computes the wait forecast for arriving at arrival (any location; it
// is converted to UTC). Pure: no I/O, deterministic.
func Predict(h SiteHistory, arrival time.Time) (*Forecast, error) {
	if h.Sessions < minSiteSessions || len(h.Spans) == 0 {
		return nil, ErrNoHistory
	}
	weeks := h.Weeks
	if weeks < 1 {
		weeks = 1
	}
	medianMin := medianDurationMin(h.Spans)
	if medianMin <= 0 {
		return nil, ErrNoHistory
	}
	stalls := peakConcurrency(h.Spans)
	if stalls < 1 {
		stalls = 1
	}

	starts := make([]float64, hoursPerWeek)
	for _, b := range h.Buckets {
		if b.Weekday < 0 || b.Weekday > 6 || b.Hour < 0 || b.Hour > 23 {
			continue
		}
		starts[b.Weekday*24+b.Hour] += float64(b.Starts)
	}
	var peak float64
	for _, s := range starts {
		peak = math.Max(peak, s)
	}
	rate := func(cell int) float64 { // arrivals/hour in this cell
		if weeks <= 0 {
			return 0
		}
		return starts[cell] / weeks
	}

	arrUTC := arrival.UTC()
	arrCell := int(arrUTC.Weekday())*24 + arrUTC.Hour()
	load := rate(arrCell) * medianMin / 60 // Erlangs (Little's law)
	waitMin, waitProb := erlangCWait(load, float64(medianMin), stalls)

	busyness := 0.0
	if peak > 0 {
		busyness = starts[arrCell] / peak * 100
	}
	verdict := verdictFor(busyness, load >= float64(stalls))
	confidence := ConfidenceHigh
	if starts[arrCell] < minBucketStarts {
		confidence = ConfidenceMedium
	}
	if h.Sessions < 30 || weeks < 4 {
		confidence = ConfidenceLow
	}

	// Best arrival within ±3h of the arrival hour, same weekday.
	bestHour, bestWait := arrUTC.Hour(), waitMin
	day := int(arrUTC.Weekday()) * 24
	for d := -3; d <= 3; d++ {
		hr := arrUTC.Hour() + d
		if hr < 0 || hr > 23 {
			continue
		}
		w, _ := erlangCWait(rate(day+hr)*medianMin/60, float64(medianMin), stalls)
		if w < bestWait-0.5 { // half-minute hysteresis: no churn
			bestHour, bestWait = hr, w
		}
	}

	hours := make([]HourPoint, 0, 24)
	for hr := 0; hr < 24; hr++ {
		w, _ := erlangCWait(rate(day+hr)*medianMin/60, float64(medianMin), stalls)
		b := 0.0
		if peak > 0 {
			b = starts[day+hr] / peak * 100
		}
		hours = append(hours, HourPoint{Hour: hr, ExpectedMin: round1(w), Busyness: round1(b)})
	}

	return &Forecast{
		Site:           h.Site,
		ArriveAt:       arrUTC,
		ExpectedMin:    round1(waitMin),
		WaitProbPct:    round1(waitProb * 100),
		Busyness:       round1(busyness),
		Verdict:        verdict,
		Confidence:     confidence,
		StallsEstimate: stalls,
		BestHour:       bestHour,
		BestWaitMin:    round1(bestWait),
		SaveMin:        round1(math.Max(0, waitMin-bestWait)),
		Hours:          hours,
		Evidence:       evidence(h, medianMin, stalls),
	}, nil
}

// erlangCWait returns (expected queue wait minutes, P(wait > 0)) for
// offered load a Erlangs, mean service time svcMin, c servers. When the
// site is saturated (a >= c) the queue is unbounded: it reports one
// full service time as the expected wait with P=1 — a deliberate,
// documented floor, not a prediction of the unbounded tail.
func erlangCWait(a, svcMin float64, c int) (waitMin, waitProb float64) {
	if a <= 0 || c <= 0 {
		return 0, 0
	}
	if a >= float64(c) {
		return svcMin, 1
	}
	rho := a / float64(c)
	// Erlang-C: p = [a^c/(c!(1-ρ))] / [Σ₀ᶜ⁻¹ aᵏ/k! + a^c/(c!(1-ρ))]
	sum := 0.0
	term := 1.0 // a^k/k!
	for k := 0; k < c; k++ {
		if k > 0 {
			term *= a / float64(k)
		}
		sum += term
	}
	term *= a / float64(c) // a^c/c!
	last := term / (1 - rho)
	p := last / (sum + last)
	return p * svcMin / (float64(c) - a), p
}

func verdictFor(busyness float64, saturated bool) string {
	switch {
	case saturated || busyness >= 75:
		return VerdictPacked
	case busyness >= 50:
		return VerdictBusy
	case busyness >= 25:
		return VerdictSteady
	default:
		return VerdictQuiet
	}
}

func medianDurationMin(spans []Session) float64 {
	ds := make([]float64, 0, len(spans))
	for _, s := range spans {
		if s.Stop.After(s.Start) {
			ds = append(ds, s.Stop.Sub(s.Start).Minutes())
		}
	}
	if len(ds) == 0 {
		return 0
	}
	sort.Float64s(ds)
	mid := len(ds) / 2
	if len(ds)%2 == 1 {
		return ds[mid]
	}
	return (ds[mid-1] + ds[mid]) / 2
}

// peakConcurrency sweeps start/stop events; the max overlap is the
// stall-count lower bound.
func peakConcurrency(spans []Session) int {
	type event struct {
		t     time.Time
		delta int
	}
	evs := make([]event, 0, 2*len(spans))
	for _, s := range spans {
		if !s.Stop.After(s.Start) {
			continue
		}
		evs = append(evs, event{s.Start, 1}, event{s.Stop, -1})
	}
	sort.Slice(evs, func(i, j int) bool {
		if evs[i].t.Equal(evs[j].t) {
			return evs[i].delta < evs[j].delta // ends before starts
		}
		return evs[i].t.Before(evs[j].t)
	})
	peak, cur := 0, 0
	for _, e := range evs {
		cur += e.delta
		peak = max(peak, cur)
	}
	return peak
}

func evidence(h SiteHistory, medianMin float64, stalls int) []string {
	congested := 0
	starts := 0
	for _, b := range h.Buckets {
		congested += b.Congested
		starts += b.Starts
	}
	out := []string{
		strconv.Itoa(starts) + " sessions over " + strconv.FormatFloat(h.Weeks, 'f', 1, 64) + " weeks",
		"median session " + strconv.FormatFloat(medianMin, 'f', 0, 64) + " min",
		strconv.Itoa(stalls) + " stalls observed at peak overlap",
	}
	if starts > 0 && congested > 0 {
		out = append(out, "congestion fees on "+strconv.Itoa(congested*100/starts)+"% of sessions")
	}
	return out
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
