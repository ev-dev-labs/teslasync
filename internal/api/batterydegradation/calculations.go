package batterydegradation

import (
	"fmt"
	"math"
	"sort"
)

func (h *Handler) predictDegradation(snapshots []batterySnapshotData) regressionResult {
	res := regressionResult{}
	pred := &res.Prediction

	if len(snapshots) < 3 {
		res.Projections = []predictiveProjection{}
		return res
	}

	pred.HasEnoughData = true

	firstTime := snapshots[0].CreatedAt
	n := float64(len(snapshots))
	var sumX, sumY, sumXY, sumX2 float64

	for _, s := range snapshots {
		x := s.CreatedAt.Sub(firstTime).Hours() / (24 * 365.25) // years
		y := s.HealthScore
		sumX += x
		sumY += y
		sumXY += x * y
		sumX2 += x * x
	}

	xBar := sumX / n
	yBar := sumY / n
	ssx := sumX2 - n*xBar*xBar

	if math.Abs(ssx) < 1e-10 {
		res.Projections = []predictiveProjection{}
		return res
	}

	slope := (sumXY - n*xBar*yBar) / ssx
	intercept := yBar - slope*xBar

	pred.SlopePerYear = math.Round(slope*100) / 100
	res.RatePerMonth = math.Abs(slope) / 12

	var sse float64
	for _, s := range snapshots {
		x := s.CreatedAt.Sub(firstTime).Hours() / (24 * 365.25)
		residual := s.HealthScore - (intercept + slope*x)
		sse += residual * residual
	}
	se := 0.0
	if n > 2 {
		se = math.Sqrt(sse / (n - 2))
	}

	tValue := 2.0
	if n > 30 {
		tValue = 1.96
	}

	if slope < 0 {
		yearsTo80 := (80 - intercept) / slope
		currentYears := h.currentTime().Sub(firstTime).Hours() / (24 * 365.25)
		remainingYears := yearsTo80 - currentYears
		if remainingYears > 0 {
			pred.YearsTo80Pct = math.Round(remainingYears*10) / 10
			predictedTime := h.currentTime().AddDate(0, int(remainingYears*12), 0)
			pred.PredictedDate = predictedTime.Format("2006-01")
		}
	}

	currentYears := h.currentTime().Sub(firstTime).Hours() / (24 * 365.25)

	type projPoint struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	}
	var oldProjections []projPoint
	var enhancedProjections []predictiveProjection

	for i := 0; i <= 36; i++ {
		futureYears := currentYears + float64(i)/12.0
		health := intercept + slope*futureYears
		if health < 0 {
			health = 0
		}
		if health > 100 {
			health = 100
		}
		month := h.currentTime().AddDate(0, i, 0).Format("2006-01")

		oldProjections = append(oldProjections, projPoint{
			Month:  month,
			Health: math.Round(health*10) / 10,
		})

		xDev := futureYears - xBar
		piWidth := 0.0
		if ssx > 1e-10 && n > 2 {
			piWidth = tValue * se * math.Sqrt(1+1/n+(xDev*xDev)/ssx)
		}
		low := math.Max(0, health-piWidth)
		high := math.Min(100, health+piWidth)

		enhancedProjections = append(enhancedProjections, predictiveProjection{
			Date:           month,
			HealthPct:      math.Round(health*10) / 10,
			ConfidenceLow:  math.Round(low*10) / 10,
			ConfidenceHigh: math.Round(high*10) / 10,
		})
	}

	pred.ProjectionPoints = make([]struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	}, len(oldProjections))
	for i, p := range oldProjections {
		pred.ProjectionPoints[i].Month = p.Month
		pred.ProjectionPoints[i].Health = p.Health
	}

	res.Projections = enhancedProjections
	return res
}

// computeRiskFactors scores 5 battery risk categories (0-100, higher = more risk).
func computeRiskFactors(fastChargePct, highSocPct, avgCellTemp, cyclesPerMonth, deepDischargePct float64) []riskFactor {
	factors := make([]riskFactor, 0, 5)

	fastScore := int(math.Min(100, fastChargePct*1.4))
	factors = append(factors, riskFactor{
		Name:   "fast_charge_ratio",
		Score:  fastScore,
		Label:  riskLabel(fastScore),
		Detail: fmt.Sprintf("%.0f%% of sessions are DC fast charge", fastChargePct),
	})

	socScore := int(math.Min(100, highSocPct*1.3))
	factors = append(factors, riskFactor{
		Name:   "high_soc_charging",
		Score:  socScore,
		Label:  riskLabel(socScore),
		Detail: fmt.Sprintf("%.0f%% of sessions charge above 90%%", highSocPct),
	})

	tempScore := 10
	switch {
	case avgCellTemp > 45:
		tempScore = 90
	case avgCellTemp > 40:
		tempScore = 70
	case avgCellTemp > 35:
		tempScore = 50
	case avgCellTemp > 30:
		tempScore = 25
	}
	factors = append(factors, riskFactor{
		Name:   "temperature_exposure",
		Score:  tempScore,
		Label:  riskLabel(tempScore),
		Detail: fmt.Sprintf("Average cell temperature: %.1f°C", avgCellTemp),
	})

	// Baseline is roughly 25 cycles/month.
	cycleScore := 15
	switch {
	case cyclesPerMonth > 40:
		cycleScore = 80
	case cyclesPerMonth > 30:
		cycleScore = 55
	case cyclesPerMonth > 20:
		cycleScore = 35
	}
	factors = append(factors, riskFactor{
		Name:   "cycle_count_rate",
		Score:  cycleScore,
		Label:  riskLabel(cycleScore),
		Detail: fmt.Sprintf("%.0f cycles/month vs ~25 typical", cyclesPerMonth),
	})

	deepScore := int(math.Min(100, deepDischargePct*4))
	factors = append(factors, riskFactor{
		Name:   "deep_discharge_frequency",
		Score:  deepScore,
		Label:  riskLabel(deepScore),
		Detail: fmt.Sprintf("%.0f%% of sessions start below 10%% SOC", deepDischargePct),
	})

	return factors
}

func riskLabel(score int) string {
	switch {
	case score <= 25:
		return "Low"
	case score <= 50:
		return "Moderate"
	case score <= 75:
		return "Elevated"
	default:
		return "High"
	}
}

// generateRecommendations produces actionable tips based on elevated risk factors.
func generateRecommendations(factors []riskFactor) []string {
	recs := make([]string, 0)
	for _, f := range factors {
		if f.Score <= 40 {
			continue
		}
		switch f.Name {
		case "fast_charge_ratio":
			recs = append(recs, "Reduce Supercharging frequency — prefer Level 2 home or destination charging")
		case "high_soc_charging":
			recs = append(recs, "Reduce daily charge limit to 80% for everyday driving")
		case "temperature_exposure":
			recs = append(recs, "Park in shade or climate-controlled garage to reduce heat exposure")
		case "cycle_count_rate":
			recs = append(recs, "Combine short trips when possible to reduce charge cycle frequency")
		case "deep_discharge_frequency":
			recs = append(recs, "Avoid letting battery drop below 20% regularly — plug in nightly")
		}
	}
	if len(recs) == 0 {
		recs = append(recs, "Your battery habits are excellent — keep it up!")
	}
	return recs
}

// aggregateMonthlyTrends groups bounded daily snapshots by month and computes averages.
func aggregateMonthlyTrends(snapshots []batterySnapshotData) []monthlyTrend {
	if len(snapshots) == 0 {
		return []monthlyTrend{}
	}

	type monthAccum struct {
		sumHealth      float64
		sumCapacity    float64
		sumDegradation float64
		sumRange       float64
		sumTemp        float64
		maxCycles      int
		count          int
	}

	months := make(map[string]*monthAccum)
	var monthOrder []string

	for _, s := range snapshots {
		key := s.CreatedAt.Format("2006-01")
		acc, ok := months[key]
		if !ok {
			acc = &monthAccum{}
			months[key] = acc
			monthOrder = append(monthOrder, key)
		}
		acc.sumHealth += s.HealthScore
		acc.sumCapacity += s.CapacityWh
		acc.sumDegradation += s.DegradationPct
		acc.sumRange += s.EstRangeKm
		acc.sumTemp += s.AvgCellTempC
		if s.CycleCount > acc.maxCycles {
			acc.maxCycles = s.CycleCount
		}
		acc.count++
	}

	sort.Strings(monthOrder)

	result := make([]monthlyTrend, 0, len(monthOrder))
	for _, key := range monthOrder {
		acc := months[key]
		n := float64(acc.count)
		result = append(result, monthlyTrend{
			Month:          key,
			AvgHealth:      math.Round(acc.sumHealth/n*10) / 10,
			AvgCapacity:    math.Round(acc.sumCapacity/n*10) / 10,
			AvgDegradation: math.Round(acc.sumDegradation/n*10) / 10,
			AvgRange:       math.Round(acc.sumRange/n*10) / 10,
			MaxCycles:      acc.maxCycles,
			AvgCellTemp:    math.Round(acc.sumTemp/n*10) / 10,
		})
	}
	return result
}
