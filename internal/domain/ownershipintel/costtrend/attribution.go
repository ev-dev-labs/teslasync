// Package costtrend attributes recorded charging spend without estimating missing bills.
package costtrend

import (
	"math"
	"math/bits"
	"sort"
)

const (
	MaxSessions   = 4096
	MaxCostMinor  = 1_000_000_000
	minSiteVisits = 2
)

type Session struct {
	SiteID         int64
	Currency       string
	CostMinor      *int64
	BilledEnergyWh *float64
}

type Period struct {
	DistanceM *float64
	Sessions  []Session
}

type Coverage struct {
	Sessions           int      `json:"sessions"`
	RecordedCosts      int      `json:"recorded_costs"`
	ComparedSessions   int      `json:"compared_sessions"`
	RecordedSpendMinor int64    `json:"recorded_spend_minor"`
	ComparedSpendMinor int64    `json:"compared_spend_minor"`
	RecordedDistanceM  *float64 `json:"recorded_distance_m,omitempty"`
}

type Attribution struct {
	Currency               string   `json:"currency"`
	Prior                  Coverage `json:"prior"`
	Current                Coverage `json:"current"`
	ComparableSites        int      `json:"comparable_sites"`
	DistanceMinor          int64    `json:"distance_minor"`
	PurchaseIntensityMinor int64    `json:"purchase_intensity_minor"`
	SiteMixMinor           int64    `json:"site_mix_minor"`
	EffectivePriceMinor    int64    `json:"effective_price_minor"`
	UnattributedMinor      int64    `json:"unattributed_minor"`
}

type Reason string

const (
	Published              Reason = "comparable_change"
	InsufficientCoverage   Reason = "insufficient_coverage"
	BelowMaterialThreshold Reason = "below_material_threshold"
)

type siteSpend struct {
	visits int
	wh     float64
	minor  int64
}

func summarize(period Period, currency string) (Coverage, map[int64]siteSpend) {
	total := Coverage{Sessions: len(period.Sessions)}
	if period.DistanceM != nil && *period.DistanceM >= 10_000 && *period.DistanceM <= 100_000_000 {
		distance := *period.DistanceM
		total.RecordedDistanceM = &distance
	}
	sites := map[int64]siteSpend{}
	for _, row := range period.Sessions {
		if row.Currency != currency || row.CostMinor == nil || *row.CostMinor < 0 || *row.CostMinor > MaxCostMinor {
			continue
		}
		total.RecordedCosts++
		total.RecordedSpendMinor += *row.CostMinor
		if row.SiteID <= 0 || row.BilledEnergyWh == nil || !(*row.BilledEnergyWh >= 100 && *row.BilledEnergyWh <= 1_000_000) {
			continue
		}
		s := sites[row.SiteID]
		s.visits++
		s.wh += *row.BilledEnergyWh
		s.minor += *row.CostMinor
		sites[row.SiteID] = s
	}
	return total, sites
}

// Compare takes externally qualified distances, settled amounts and billed
// energy at a common meter boundary. Omitted values remain coverage gaps.
func Compare(prior, current Period, currency string, minDeltaMinor int64) (*Attribution, Reason) {
	if len(currency) != 3 || minDeltaMinor <= 0 || minDeltaMinor > MaxCostMinor ||
		len(prior.Sessions) > MaxSessions || len(current.Sessions) > MaxSessions {
		return nil, InsufficientCoverage
	}
	oldCoverage, oldSites := summarize(prior, currency)
	newCoverage, newSites := summarize(current, currency)
	if oldCoverage.RecordedDistanceM == nil || newCoverage.RecordedDistanceM == nil {
		return nil, InsufficientCoverage
	}
	ids := make([]int64, 0, len(oldSites))
	for id, before := range oldSites {
		if before.visits >= minSiteVisits && newSites[id].visits >= minSiteVisits {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })

	var oldWh, newWh float64
	for _, id := range ids {
		before, after := oldSites[id], newSites[id]
		oldWh += before.wh
		newWh += after.wh
		oldCoverage.ComparedSessions += before.visits
		newCoverage.ComparedSessions += after.visits
		oldCoverage.ComparedSpendMinor += before.minor
		newCoverage.ComparedSpendMinor += after.minor
	}
	if !coverageSupportsComparison(oldCoverage) || !coverageSupportsComparison(newCoverage) {
		return nil, InsufficientCoverage
	}
	change := newCoverage.ComparedSpendMinor - oldCoverage.ComparedSpendMinor
	if change > -minDeltaMinor && change < minDeltaMinor {
		return nil, BelowMaterialThreshold
	}
	var blend [2][2]float64
	for _, id := range ids {
		before, after := oldSites[id], newSites[id]
		share := [2]float64{before.wh / oldWh, after.wh / newWh}
		price := [2]float64{float64(before.minor) / before.wh, float64(after.minor) / after.wh}
		for i := range share {
			for j := range price {
				blend[i][j] += share[i] * price[j]
			}
		}
	}
	distance := [2]float64{*oldCoverage.RecordedDistanceM, *newCoverage.RecordedDistanceM}
	intensity := [2]float64{oldWh / distance[0], newWh / distance[1]}
	var scenarios [16]float64
	for mask := range scenarios {
		scenarios[mask] = distance[mask&1] * intensity[(mask>>1)&1] * blend[(mask>>2)&1][(mask>>3)&1]
	}
	effects := symmetricEffects(scenarios)
	recordedDelta := newCoverage.RecordedSpendMinor - oldCoverage.RecordedSpendMinor
	return &Attribution{
		Currency: currency, Prior: oldCoverage, Current: newCoverage, ComparableSites: len(ids),
		DistanceMinor: effects[0], PurchaseIntensityMinor: effects[1], SiteMixMinor: effects[2], EffectivePriceMinor: effects[3],
		UnattributedMinor: recordedDelta - effects[0] - effects[1] - effects[2] - effects[3],
	}, Published
}

func coverageSupportsComparison(coverage Coverage) bool {
	return coverage.ComparedSessions >= 4 &&
		4*coverage.ComparedSessions >= 3*coverage.Sessions &&
		4*coverage.ComparedSpendMinor >= 3*coverage.RecordedSpendMinor
}

func symmetricEffects(scenarios [16]float64) (rounded [4]int64) {
	// Average each substitution over every order so no one factor absorbs every interaction.
	weights := [4]float64{1.0 / 4, 1.0 / 12, 1.0 / 12, 1.0 / 4}
	for factor := range rounded {
		bit := 1 << factor
		marginal := 0.0
		for mask, base := range scenarios {
			if mask&bit == 0 {
				marginal += weights[bits.OnesCount(uint(mask))] * (scenarios[mask|bit] - base)
			}
		}
		rounded[factor] = int64(math.Round(marginal))
	}
	return rounded
}
