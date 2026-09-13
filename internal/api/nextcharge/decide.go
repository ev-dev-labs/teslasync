package nextcharge

import (
	"fmt"
	"math"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/chargeautopilot"
)

// Verdicts returned by Decide. The frontend maps these to i18n copy.
const (
	VerdictEnough        = "enough"
	VerdictWait          = "wait"
	VerdictChargeHomeNow = "charge_home_now"
	VerdictSupercharger  = "supercharger"
	VerdictSkipDC        = "skip_dc"
)

// Reason keys for i18n interpolation (nextCharge.reason.*).
const (
	ReasonEnough              = "enough"
	ReasonWaitOffpeak         = "wait_offpeak"
	ReasonSuperchargerFaster  = "supercharger_faster"
	ReasonSuperchargerCheaper = "supercharger_cheaper"
	ReasonSkipDC              = "skip_dc"
	ReasonChargeHomeNow       = "charge_home_now"
)

const (
	defaultHorizon    = 12 * time.Hour
	minWaitLead       = 15 * time.Minute
	minWaitSavingsUSD = 0.50
	scCheaperRatio    = 0.90 // Supercharger wins if < 90% of the cheaper home option
	scPremiumRatio    = 1.10 // skip DC if Supercharger is ≥10% more than charge-now
)

// Quote is the cheapest billed Supercharger/DC site for this VIN.
type Quote struct {
	Site      string
	AvgPerKWh float64 // USD per kWh from Tesla invoices
}

// Input seeds a 12-hour energy verdict.
type Input struct {
	Profile    chargeautopilot.Profile
	CurrentSOC int
	Now        time.Time
	Horizon    time.Duration
	Quote      *Quote
}

// Decision is the GET /charge-autopilot/decision wire shape.
type Decision struct {
	Verdict            string     `json:"verdict"`
	ReasonKey          string     `json:"reason_key"`
	Reason             string     `json:"reason"`
	CurrentSOC         int        `json:"current_soc"`
	TargetSOC          int        `json:"target_soc"`
	KWhNeeded          float64    `json:"kwh_needed"`
	HorizonHours       float64    `json:"horizon_hours"`
	HomeNowCost        *float64   `json:"home_now_cost,omitempty"`
	HomeWaitCost       *float64   `json:"home_wait_cost,omitempty"`
	HomeWaitStart      *time.Time `json:"home_wait_start,omitempty"`
	HomeSavings        *float64   `json:"home_savings,omitempty"`
	SuperchargerSite   *string    `json:"supercharger_site,omitempty"`
	SuperchargerPerKWh *float64   `json:"supercharger_per_kwh,omitempty"`
	SuperchargerCost   *float64   `json:"supercharger_cost,omitempty"`
	ReadyBy            time.Time  `json:"ready_by"`
	CappedByHealth     bool       `json:"capped_by_health_guardrail"`
}

// Decide returns the next-charge verdict. Pure: no I/O.
func Decide(in Input) Decision {
	now := in.Now
	horizon := in.Horizon
	if horizon <= 0 {
		horizon = defaultHorizon
	}
	p := in.Profile
	target, capped := chargeautopilot.EffectiveTarget(p.TargetSOC, p.DailyCapSOC, p.TripOverride)
	readyBy, err := chargeautopilot.NextReadyBy(p.ReadyBy, now)
	if err != nil {
		readyBy = now.Add(24 * time.Hour)
	}

	d := Decision{
		CurrentSOC:     in.CurrentSOC,
		TargetSOC:      target,
		HorizonHours:   horizon.Hours(),
		ReadyBy:        readyBy,
		CappedByHealth: capped,
	}
	attachQuote(&d, in.Quote, 0)

	if in.CurrentSOC >= target {
		d.KWhNeeded = 0
		d.Verdict = VerdictEnough
		d.ReasonKey = ReasonEnough
		d.Reason = fmt.Sprintf("Battery is at %d%%, already at the %d%% target.", in.CurrentSOC, target)
		return d
	}

	kwhNeeded := round2(float64(target-in.CurrentSOC) / 100.0 * p.BatteryCapacityKWh)
	d.KWhNeeded = kwhNeeded
	attachQuote(&d, in.Quote, kwhNeeded)

	preview, previewErr := chargeautopilot.Preview(chargeautopilot.PreviewInput{
		Profile:    p,
		CurrentSOC: in.CurrentSOC,
		Now:        now,
	})
	if previewErr != nil || preview == nil {
		if in.Quote != nil && in.Quote.AvgPerKWh > 0 {
			d.Verdict = VerdictSupercharger
			d.ReasonKey = ReasonSuperchargerFaster
			d.Reason = fmt.Sprintf(
				"Home charging cannot finish before ready-by; %s is the cheapest billed Supercharger at $%.2f/kWh.",
				in.Quote.Site, in.Quote.AvgPerKWh,
			)
			return d
		}
		d.Verdict = VerdictChargeHomeNow
		d.ReasonKey = ReasonChargeHomeNow
		d.Reason = "Start charging at home now — no cheaper Supercharger quote and no feasible off-peak window."
		return d
	}

	d.HomeNowCost = ptrf(round2(preview.ChargeNowCost))
	d.HomeWaitCost = ptrf(round2(preview.OptimizedCost))
	d.HomeSavings = ptrf(round2(preview.Savings))
	waitStart := preview.Window.StartTime
	d.HomeWaitStart = &waitStart
	d.KWhNeeded = round2(preview.KWhNeeded)
	attachQuote(&d, in.Quote, preview.KWhNeeded)

	homeFloor := preview.OptimizedCost
	if preview.ChargeNowCost < homeFloor {
		homeFloor = preview.ChargeNowCost
	}
	scCost := 0.0
	if in.Quote != nil && in.Quote.AvgPerKWh > 0 {
		scCost = round2(in.Quote.AvgPerKWh * preview.KWhNeeded)
	}

	if in.Quote != nil && scCost > 0 && homeFloor > 0 && scCost < homeFloor*scCheaperRatio {
		d.Verdict = VerdictSupercharger
		d.ReasonKey = ReasonSuperchargerCheaper
		d.Reason = fmt.Sprintf(
			"%s is cheaper ($%.2f vs $%.2f at home) for the %.1f kWh you still need.",
			in.Quote.Site, scCost, homeFloor, preview.KWhNeeded,
		)
		return d
	}

	waitOK := waitStart.After(now.Add(minWaitLead)) &&
		!waitStart.After(now.Add(horizon)) &&
		preview.Savings >= minWaitSavingsUSD
	if waitOK {
		d.Verdict = VerdictWait
		d.ReasonKey = ReasonWaitOffpeak
		d.Reason = fmt.Sprintf(
			"Wait for off-peak at %s — save $%.2f versus charging now.",
			waitStart.Format(time.Kitchen), preview.Savings,
		)
		return d
	}

	if in.Quote != nil && scCost > 0 && preview.ChargeNowCost > 0 && scCost > preview.ChargeNowCost*scPremiumRatio {
		d.Verdict = VerdictSkipDC
		d.ReasonKey = ReasonSkipDC
		d.Reason = fmt.Sprintf(
			"Skip %s ($%.2f) — home now is $%.2f for the same energy.",
			in.Quote.Site, scCost, preview.ChargeNowCost,
		)
		return d
	}

	d.Verdict = VerdictChargeHomeNow
	d.ReasonKey = ReasonChargeHomeNow
	d.Reason = "Charge at home now — the cheapest window is already open (or too far out to wait)."
	return d
}

func attachQuote(d *Decision, q *Quote, kwh float64) {
	if q == nil || q.AvgPerKWh <= 0 {
		return
	}
	d.SuperchargerSite = ptrs(q.Site)
	d.SuperchargerPerKWh = ptrf(round4(q.AvgPerKWh))
	if kwh > 0 {
		d.SuperchargerCost = ptrf(round2(q.AvgPerKWh * kwh))
	}
}

func ptrf(v float64) *float64 { return &v }
func ptrs(v string) *string   { return &v }

func round2(f float64) float64 { return math.Round(f*100) / 100 }
func round4(f float64) float64 { return math.Round(f*10000) / 10000 }
