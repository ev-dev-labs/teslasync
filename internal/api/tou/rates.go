package tou

import (
	"math"
)

// BuildHourlyRates returns the canonical 24-hour rate and tier array for a season.
func BuildHourlyRates(season Season) []HourlyRate {
	rates := make([]HourlyRate, 24)
	for i := range rates {
		rates[i] = HourlyRate{Hour: i, RateCents: 0, Tier: "unknown"}
	}

	for tier, blocks := range season.Tiers {
		for _, block := range blocks {
			for hour := block.Start; hour < block.End && hour < 24; hour++ {
				rates[hour] = HourlyRate{
					Hour:      hour,
					RateCents: Round2(block.Rate * 100),
					Tier:      tier,
				}
			}
		}
	}
	return rates
}

// BuildHourlyRates remains the canonical implementation; HourlyRates is a
// descriptive alias for callers that prefer the noun form.
func HourlyRates(season Season) []HourlyRate {
	return BuildHourlyRates(season)
}

// TierLabel converts a canonical tariff tier to the user-facing label.
func TierLabel(tier string) string {
	switch tier {
	case "ON_PEAK":
		return "on-peak"
	case "MID_PEAK":
		return "mid-peak"
	case "OFF_PEAK", "SUPER_OFF_PEAK":
		return "off-peak"
	default:
		return "unknown"
	}
}

// CostForWindow returns total dollars and average cents per kWh for a contiguous
// window. The 24-hour wrap is intentional and used by both callers.
func CostForWindow(rates []HourlyRate, startHour, durationHours int, kWhNeeded float64) (cost float64, avgRateCents float64) {
	if durationHours <= 0 || len(rates) == 0 {
		return 0, 0
	}
	totalRateCents := 0.0
	for i := 0; i < durationHours; i++ {
		hour := startHour + i
		if hour >= 0 {
			hour %= 24
		} else {
			hour = (hour%24 + 24) % 24
		}
		if hour >= len(rates) {
			continue
		}
		totalRateCents += rates[hour].RateCents
	}
	avgRateCents = totalRateCents / float64(durationHours)
	return avgRateCents / 100.0 * kWhNeeded, avgRateCents
}

// Round2 rounds a monetary or percentage value to two decimal places.
func Round2(value float64) float64 {
	return math.Round(value*100) / 100
}

// Round1 rounds a value to one decimal place.
func Round1(value float64) float64 {
	return math.Round(value*10) / 10
}
