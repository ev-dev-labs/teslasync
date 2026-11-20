package smartreadinesssvc

import (
	"math"
	"math/big"
	"strconv"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

const (
	maxSiteRateWindows = 100
	minimumRateDelay   = 5 * time.Minute
)

type pricedWindow struct {
	from     time.Time
	to       *time.Time
	rate     *big.Rat
	currency string
}

func estimateSiteRateComparison(
	plan domain.Plan, estimate domain.LatestStart, capacityWh float64,
	windows []domain.SiteRateWindow, now time.Time,
) *domain.ChargeCostComparison {
	if !plan.CompareSiteRates || estimate.Status != domain.LatestStartEstimate ||
		estimate.EarliestSafeStartAt == nil || estimate.ChargingPowerW <= 0 ||
		!finiteBetween(capacityWh, 1, 500000) || len(windows) < 2 || len(windows) > maxSiteRateWindows {
		return nil
	}
	requiredWh := capacityWh * estimate.RequiredHighPct / 100
	if !finiteBetween(requiredWh, 0.000001, 500000) {
		return nil
	}
	hours := requiredWh / estimate.ChargingPowerW
	if !finiteBetween(hours, 0, 24*7) {
		return nil
	}
	duration := time.Duration(math.Ceil(hours * float64(time.Hour)))
	energy, ok := new(big.Rat).SetString(strconv.FormatFloat(requiredWh, 'f', 6, 64))
	if !ok || duration <= 0 {
		return nil
	}
	rates, ok := parseSiteRateWindows(windows)
	if !ok {
		return nil
	}
	nowCost, currency, ok := chargeCostAt(now, duration, energy, rates)
	if !ok || nowCost.Sign() <= 0 {
		return nil
	}
	var bestCost *big.Rat
	var bestStart time.Time
	for _, start := range possibleRateStarts(now, *estimate.EarliestSafeStartAt, duration, rates) {
		cost, candidateCurrency, covered := chargeCostAt(start, duration, energy, rates)
		if !covered || candidateCurrency != currency || cost.Cmp(nowCost) >= 0 {
			continue
		}
		if bestCost == nil || cost.Cmp(bestCost) < 0 || (cost.Cmp(bestCost) == 0 && start.Before(bestStart)) {
			bestCost, bestStart = cost, start
		}
	}
	if bestCost == nil {
		return nil
	}
	saving := new(big.Rat).Sub(nowCost, bestCost)
	if saving.Cmp(big.NewRat(1, 1)) < 0 ||
		new(big.Rat).Mul(saving, big.NewRat(10, 1)).Cmp(nowCost) < 0 {
		return nil
	}
	return &domain.ChargeCostComparison{
		LowerRateStartAt: bestStart.UTC(), RequiredEnergyWh: requiredWh,
		CostNowDecimal: nowCost.FloatString(6), CostLaterDecimal: bestCost.FloatString(6),
		SavingDecimal: saving.FloatString(6), Currency: currency,
	}
}

func parseSiteRateWindows(windows []domain.SiteRateWindow) ([]pricedWindow, bool) {
	rates := make([]pricedWindow, 0, len(windows))
	for _, window := range windows {
		rate, ok := new(big.Rat).SetString(window.RatePerWh)
		if !ok || rate.Sign() < 0 || rate.Cmp(big.NewRat(1000000, 1)) >= 0 ||
			!validCurrency(window.Currency) || window.EffectiveFrom.IsZero() ||
			(window.EffectiveTo != nil && !window.EffectiveFrom.Before(*window.EffectiveTo)) {
			return nil, false
		}
		if len(rates) > 0 {
			prior := rates[len(rates)-1]
			if prior.to == nil || window.EffectiveFrom.Before(*prior.to) {
				return nil, false
			}
		}
		rates = append(rates, pricedWindow{
			from: window.EffectiveFrom, to: window.EffectiveTo, rate: rate, currency: window.Currency,
		})
	}
	return rates, true
}

func validCurrency(currency string) bool {
	if len(currency) != 3 {
		return false
	}
	for _, character := range currency {
		if character < 'A' || character > 'Z' {
			return false
		}
	}
	return true
}

func possibleRateStarts(now, latest time.Time, duration time.Duration, rates []pricedWindow) []time.Time {
	candidates := make([]time.Time, 0, len(rates)*4+1)
	appendIfFeasible := func(start time.Time) {
		if !start.Before(now.Add(minimumRateDelay)) && !start.After(latest) {
			candidates = append(candidates, start)
		}
	}
	appendIfFeasible(latest)
	for _, rate := range rates {
		appendIfFeasible(rate.from)
		appendIfFeasible(rate.from.Add(-duration))
		if rate.to != nil {
			appendIfFeasible(*rate.to)
			appendIfFeasible(rate.to.Add(-duration))
		}
	}
	return candidates
}

func chargeCostAt(
	start time.Time, duration time.Duration, energy *big.Rat, rates []pricedWindow,
) (*big.Rat, string, bool) {
	end := start.Add(duration)
	cursor := start
	cost := new(big.Rat)
	currency := ""
	for _, rate := range rates {
		if rate.to != nil && !rate.to.After(cursor) {
			continue
		}
		if rate.from.After(cursor) {
			return nil, "", false
		}
		if currency != "" && currency != rate.currency {
			return nil, "", false
		}
		currency = rate.currency
		until := end
		if rate.to != nil && rate.to.Before(until) {
			until = *rate.to
		}
		portion := new(big.Rat).SetFrac64(until.Sub(cursor).Nanoseconds(), duration.Nanoseconds())
		portion.Mul(portion, energy)
		portion.Mul(portion, rate.rate)
		cost.Add(cost, portion)
		cursor = until
		if !cursor.Before(end) {
			return cost, currency, true
		}
	}
	return nil, "", false
}
