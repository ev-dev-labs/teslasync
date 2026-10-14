package batterydegradation

import (
	"fmt"
	"math"
	"sort"
	"time"
)

func chargingHabitsFromSummary(summary batterySummaryStats) chargingHabits {
	return chargingHabits{
		FastChargeCount:       summary.fastChargeCount,
		SlowChargeCount:       summary.slowChargeCount,
		DeepDischargeCount:    summary.deepDischargeCount,
		ChargeToFullCount:     summary.fullChargeCount,
		HighSocCount:          summary.highSocCount,
		AvgEnergyPerSessionWh: summary.avgEnergyWh,
		TotalCount:            summary.totalCount,
	}
}

// Recorded charging throughput estimates charge equivalents, not observed
// discharge/recharge cycles or lifetime pack throughput.
func chargeEquivalentCycles(energyWh, nominalCapacityWh float64, samples int) (float64, bool) {
	if samples <= 0 || !isFinite(energyWh) || energyWh < 0 ||
		!isFinite(nominalCapacityWh) || nominalCapacityWh <= 0 {
		return 0, false
	}
	cycles := energyWh / nominalCapacityWh
	if !isFinite(cycles) {
		return 0, false
	}
	return cycles, true
}

func isFinite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func numericEvidence(value float64, available bool, min, max float64) *float64 {
	if !available || !isFinite(value) || value < min || value > max {
		return nil
	}
	return &value
}

func distanceEvidence(value *float64) *float64 {
	if value == nil || !isFinite(*value) || *value < 0 {
		return nil
	}
	rounded := roundTo(*value, 1)
	if !isFinite(rounded) {
		rounded = *value
	}
	return &rounded
}

// Earliest retained evidence bounds observation, not manufacture or installation.
func batteryObservation(now time.Time, history []batteryHealthHistoryPoint, firstCharging, firstDrive *time.Time) (*int, *time.Time, string) {
	var first *time.Time
	source := "unavailable"
	consider := func(candidate time.Time, provenance string) {
		if candidate.IsZero() || candidate.After(now) {
			return
		}
		if first == nil || candidate.Before(*first) {
			value := candidate.UTC()
			first = &value
			source = provenance
		}
	}
	for _, point := range history {
		if date, err := time.Parse("2006-01-02", point.Date); err == nil {
			consider(date, "battery_health_history")
		}
	}
	if firstCharging != nil {
		consider(*firstCharging, "charging_session")
	}
	if firstDrive != nil {
		consider(*firstDrive, "drive_session")
	}
	if first == nil {
		return nil, nil, source
	}
	months := int(now.Sub(*first).Hours() / (24 * 30.44))
	return &months, first, source
}

// The median estimates current capacity from telemetry; it does not calibrate
// the nominal original-capacity denominator (candidate BD-C01).
func recentCapacityEvidence(history []batteryHealthHistoryPoint, sampleCount int) (float64, bool) {
	valid := make([]batteryHealthHistoryPoint, 0, len(history))
	for _, point := range history {
		if !math.IsNaN(point.CapacityWh) && !math.IsInf(point.CapacityWh, 0) && point.CapacityWh >= 0 {
			valid = append(valid, point)
		}
	}
	if len(valid) == 0 || sampleCount <= 0 {
		return 0, false
	}
	start := max(0, len(valid)-sampleCount)
	values := make([]float64, 0, len(valid)-start)
	for _, point := range valid[start:] {
		values = append(values, point.CapacityWh)
	}
	sort.Float64s(values)
	mid := len(values) / 2
	if len(values)%2 == 0 {
		return values[mid-1]/2 + values[mid]/2, true
	}
	return values[mid], true
}

func (h *Handler) predictDegradation(snapshots []batterySnapshotData) regressionResult {
	return h.predictDegradationAt(snapshots, h.currentTime())
}

func (h *Handler) predictDegradationAt(snapshots []batterySnapshotData, now time.Time) regressionResult {
	res := regressionResult{Projections: []predictiveProjection{}}
	pred := &res.Prediction
	pred.CrossingStatus = "insufficient_fit"
	res.Horizon.Points = []horizonPoint{}
	valid := make([]batterySnapshotData, 0, len(snapshots))
	for _, s := range snapshots {
		if !s.CreatedAt.IsZero() && !math.IsNaN(s.HealthScore) && !math.IsInf(s.HealthScore, 0) &&
			s.HealthScore >= 0 && s.HealthScore <= 100 {
			valid = append(valid, s)
		}
	}
	sort.Slice(valid, func(i, j int) bool { return valid[i].CreatedAt.Before(valid[j].CreatedAt) })
	snapshots = valid

	if len(snapshots) < 3 {
		res.Projections = []predictiveProjection{}
		return res
	}

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
	if math.IsNaN(slope) || math.IsInf(slope, 0) || math.IsNaN(intercept) || math.IsInf(intercept, 0) {
		return res
	}

	pred.HasEnoughData = true
	pred.FitValid = true
	pred.SlopePerYear = slope
	res.RatePerMonth = -slope / 12

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

	// Fixed normal-like multipliers, not Student-t quantiles or calibrated 95% coverage.
	tValue := 2.0
	if n > 30 {
		tValue = 1.96
	}
	pred.Interval = &predictionInterval{
		Method:            "approximate_ols_future_observation",
		SampleCount:       len(snapshots),
		ResidualDF:        len(snapshots) - 2,
		Multiplier:        tValue,
		EmpiricalCoverage: "unmeasured",
	}

	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	currentYears := now.Sub(firstTime).Hours() / (24 * 365.25)
	pred.CrossingStatus = "no_future_crossing"
	if intercept+slope*currentYears <= 80 {
		pred.CrossingStatus = "below_threshold"
	} else if slope < 0 {
		yearsTo80 := (80 - intercept) / slope
		remainingYears := yearsTo80 - currentYears
		if remainingYears > 0 && !math.IsInf(remainingYears, 0) && !math.IsNaN(remainingYears) {
			pred.CrossingStatus = "future_crossing"
			pred.YearsTo80Pct = remainingYears
			predictedTime := monthStart.AddDate(0, int(remainingYears*12), 0)
			pred.PredictedDate = predictedTime.Format("2006-01")
		}
	}

	type projPoint struct {
		Month  string  `json:"month"`
		Health float64 `json:"health"`
	}
	var oldProjections []projPoint
	var enhancedProjections []predictiveProjection

	for i := 0; i <= 60; i++ {
		futureYears := currentYears + float64(i)/12.0
		health := intercept + slope*futureYears
		if health < 0 {
			health = 0
		}
		if health > 100 {
			health = 100
		}
		month := monthStart.AddDate(0, i, 0).Format("2006-01")

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
	res.Horizon = horizonOutlook{
		Points:        horizonPoints(currentYears, xBar, intercept, slope, se, ssx, n, tValue),
		DataMonths:    int(math.Round((snapshots[len(snapshots)-1].CreatedAt.Sub(firstTime).Hours() / 24 / 30.44))),
		SlopePerYear:  math.Round(slope*100) / 100,
		HasEnoughData: true,
	}
	return res
}

// horizonPoints evaluates the fitted line at the 1/3/5-year horizons with
// the same prediction-interval math as the monthly projections.
func horizonPoints(currentYears, xBar, intercept, slope, se, ssx, n, tValue float64) []horizonPoint {
	out := make([]horizonPoint, 0, 3)
	for _, years := range []int{1, 3, 5} {
		fy := currentYears + float64(years)
		health := intercept + slope*fy
		health = math.Min(100, math.Max(0, health))
		xDev := fy - xBar
		piWidth := 0.0
		if ssx > 1e-10 && n > 2 {
			piWidth = tValue * se * math.Sqrt(1+1/n+(xDev*xDev)/ssx)
		}
		out = append(out, horizonPoint{
			Years:          years,
			HealthPct:      math.Round(health*10) / 10,
			ConfidenceLow:  math.Round(math.Max(0, health-piWidth)*10) / 10,
			ConfidenceHigh: math.Round(math.Min(100, health+piWidth)*10) / 10,
		})
	}
	return out
}

// computeRiskFactors scores 5 battery risk categories (0-100, higher = more risk).
func computeRiskFactors(fastChargePct, highSocPct float64, avgCellTemp *float64, cyclesPerMonth, deepDischargePct float64, tempSamples int) []riskFactor {
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

	tempScore, _ := temperatureExposure(avgCellTemp, tempSamples)
	tempAvailable := tempScore != nil
	thermal := riskFactor{
		Name:      "temperature_exposure",
		Available: &tempAvailable,
		Label:     "Unknown",
	}
	if tempAvailable {
		thermal.Score = *tempScore
		thermal.Label = riskLabel(*tempScore)
		thermal.Detail = fmt.Sprintf("Average cell temperature: %.1f°C", *avgCellTemp)
	}
	factors = append(factors, thermal)

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

// Keep risk shells while explicitly distinguishing absent evidence from low risk.
func healthRiskEvidence(factors []riskFactor, available ...bool) []riskFactor {
	for i := range factors {
		valid := i < len(available) && available[i]
		factors[i].Available = &valid
		if !valid {
			factors[i].Score = 0
			factors[i].Label = "Unknown"
			factors[i].Detail = ""
		}
	}
	return factors
}

// generateRecommendations produces actionable tips based on elevated risk factors.
func generateRecommendations(factors []riskFactor) []string {
	recs := make([]string, 0)
	for _, f := range factors {
		if f.Available != nil && !*f.Available {
			continue
		}
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
		complete := len(factors) > 0
		for _, f := range factors {
			if f.Available != nil && !*f.Available {
				complete = false
			}
		}
		if complete {
			recs = append(recs, "Your battery habits are excellent — keep it up!")
		}
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
