package rangeproj

func getEfficiency(lookup map[string]efficiencyBucket, temp, speed string) float64 {
	if b, ok := lookup[temp+"|"+speed]; ok {
		return b.WhKm
	}
	return 0
}

func tempBucketFor(tempC int) string {
	switch {
	case tempC < 0:
		return "freezing"
	case tempC < 10:
		return "cold"
	case tempC < 25:
		return "mild"
	default:
		return "hot"
	}
}

func defaultEfficiency(tempC, speedKmh int) float64 {
	base := 155.0 // mild city baseline
	if speedKmh > 90 {
		base = 195
	} else if speedKmh > 50 {
		base = 170
	}
	if tempC < 0 {
		base *= 1.35
	} else if tempC < 10 {
		base *= 1.15
	} else if tempC > 35 {
		base *= 1.08
	}
	return base
}

func buildRangeFactors(avgTemp, avgSpeed, avgEff *float64) []rangeFactor {
	var factors []rangeFactor

	// Temperature impact
	if avgTemp != nil {
		temp := *avgTemp
		impact := 0.0
		desc := "Moderate temperature, minimal impact"
		if temp < 0 {
			impact = -20
			desc = "Cold weather significantly reduces range"
		} else if temp < 10 {
			impact = -10
			desc = "Cool weather moderately reduces range"
		} else if temp > 35 {
			impact = -8
			desc = "High heat increases cooling load"
		} else if temp >= 15 && temp <= 25 {
			impact = 2
			desc = "Ideal temperature for battery efficiency"
		}
		factors = append(factors, rangeFactor{
			Name: "temperature", ImpactPct: impact, Description: desc,
		})
	}

	// Speed impact
	if avgSpeed != nil {
		speed := *avgSpeed
		impact := 0.0
		desc := "Moderate speed, good efficiency"
		if speed > 120 {
			impact = -15
			desc = "High-speed driving greatly reduces range"
		} else if speed > 100 {
			impact = -8
			desc = "Highway speed reduces range moderately"
		} else if speed < 50 {
			impact = 5
			desc = "Low-speed city driving improves range"
		}
		factors = append(factors, rangeFactor{
			Name: "speed", ImpactPct: impact, Description: desc,
		})
	}

	// HVAC estimate
	factors = append(factors, rangeFactor{
		Name: "hvac", ImpactPct: -3, Description: "Climate control active",
	})

	// Driving style from efficiency
	if avgEff != nil {
		eff := *avgEff
		impact := 0.0
		desc := "Average driving style"
		if eff < 140 {
			impact = 5
			desc = "Efficient driving style"
		} else if eff > 200 {
			impact = -10
			desc = "Aggressive driving reduces range"
		} else if eff > 170 {
			impact = -5
			desc = "Moderately aggressive driving"
		}
		factors = append(factors, rangeFactor{
			Name: "driving_style", ImpactPct: impact, Description: desc,
		})
	}

	// Elevation placeholder
	factors = append(factors, rangeFactor{
		Name: "elevation", ImpactPct: -1, Description: "Minor elevation changes",
	})

	return factors
}

func ptrF64(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}
