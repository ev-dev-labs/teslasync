package ownershipintelsvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

// Underwriting constants. Every baseline is a documented, fixed assumption so
// two runs over the same evidence always produce the same score.
const (
	// harshPowerFloorW is the absolute power a drive must reach before its
	// peak-to-average ratio is treated as a harsh acceleration event.
	harshPowerFloorW = 100000.0
	// harshPowerRatio is the peak-over-average multiple that marks a drive.
	harshPowerRatio = 2.5
	// highSpeedThresholdMps is roughly 113 km/h, the point where crash energy
	// rises steeply enough for underwriters to treat it as a severity driver.
	highSpeedThresholdMps = 31.3
	// congestionSpeedMps is roughly 30 km/h and stands in for dense urban use.
	congestionSpeedMps = 8.3
	// longHaulDurationS is two hours, the classic fatigue-exposure threshold.
	longHaulDurationS = 7200
	// coldExposureC is the temperature below which grip and stopping distance
	// degrade materially.
	coldExposureC = 0.0
	// industryLossRatio converts written premium into expected incurred loss.
	// It is an explicit, disclosed assumption — never inferred from the data.
	industryLossRatio = 0.62
	// nightStartHour and nightEndHour bound the elevated-risk overnight band.
	nightStartHour = 22
	nightEndHour   = 5
)

type riskFactorSpec struct {
	code      string
	label     string
	rateUnit  string
	baseline  float64
	weight    float64
	direction domain.RiskFactorDirection
	frequency bool
	severity  bool
	narrative string
	lever     string
	effort    float64
}

// riskFactorSpecs is the fixed underwriting model. Weights sum to 1.0.
var riskFactorSpecs = []riskFactorSpec{
	{
		code: "harsh_power", label: "Harsh acceleration exposure",
		rateUnit: "events_per_1e6_m", baseline: 6.0, weight: 0.16,
		direction: domain.DirectionHigherIsWorse, frequency: true,
		narrative: "Drives whose peak power exceeded 2.5x their own average above 100 kW.",
		lever:     "Ease off launches on the first 5 seconds of each departure.",
		effort:    0.5,
	},
	{
		code: "speed_exposure", label: "High-speed distance share",
		rateUnit: "fraction", baseline: 0.12, weight: 0.18,
		direction: domain.DirectionHigherIsWorse, severity: true,
		narrative: "Share of distance driven on trips that peaked above 113 km/h.",
		lever:     "Hold motorway cruise 8 km/h lower on the longest recurring route.",
		effort:    0.25,
	},
	{
		code: "speed_variance", label: "Speed volatility",
		rateUnit: "peak_over_mean_ratio", baseline: 2.2, weight: 0.10,
		direction: domain.DirectionHigherIsWorse, severity: true,
		narrative: "Ratio of peak speed to average speed across the window.",
		lever:     "Increase following distance so speed holds steadier in traffic.",
		effort:    0.5,
	},
	{
		code: "night_exposure", label: "Overnight distance share",
		rateUnit: "fraction", baseline: 0.10, weight: 0.12,
		direction: domain.DirectionHigherIsWorse, frequency: true,
		narrative: "Share of distance driven between 22:00 and 05:00.",
		lever:     "Shift one recurring late trip earlier in the evening.",
		effort:    1.0,
	},
	{
		code: "trip_density", label: "Trip frequency",
		rateUnit: "drives_per_day", baseline: 3.2, weight: 0.10,
		direction: domain.DirectionHigherIsWorse, frequency: true,
		narrative: "Each separate departure carries its own claim opportunity.",
		lever:     "Chain two short errands into one trip on the busiest weekday.",
		effort:    0.5,
	},
	{
		code: "urban_congestion", label: "Dense-traffic distance share",
		rateUnit: "fraction", baseline: 0.30, weight: 0.12,
		direction: domain.DirectionHigherIsWorse, frequency: true,
		narrative: "Share of distance on trips averaging under 30 km/h.",
		lever:     "Move one commute leg outside the congested window.",
		effort:    1.5,
	},
	{
		code: "long_haul", label: "Long-duration exposure",
		rateUnit: "fraction", baseline: 0.08, weight: 0.08,
		direction: domain.DirectionHigherIsWorse, severity: true,
		narrative: "Share of distance on trips longer than two hours without a logged stop.",
		lever:     "Insert a charge or rest stop on trips beyond two hours.",
		effort:    0.5,
	},
	{
		code: "cold_exposure", label: "Sub-zero driving share",
		rateUnit: "fraction", baseline: 0.15, weight: 0.08,
		direction: domain.DirectionHigherIsWorse, severity: true,
		narrative: "Share of distance driven below 0 degrees Celsius ambient.",
		lever:     "Delay non-essential departures until the road surface clears.",
		effort:    0.25,
	},
	{
		code: "regen_discipline", label: "Regenerative braking discipline",
		rateUnit: "fraction", baseline: 0.14, weight: 0.06,
		direction: domain.DirectionHigherIsBetter, severity: true,
		narrative: "Recovered energy share; higher values indicate smoother deceleration.",
		lever:     "Lift earlier so regen does more of the braking work.",
		effort:    0.25,
	},
}

type riskObservation struct {
	values      map[string]float64
	exposurePct map[string]float64
	samples     map[string]int
}

// InsuranceRiskProfile scores telematics-derived underwriting risk.
func (s *Service) InsuranceRiskProfile(
	ctx context.Context,
	subject string,
	vehicleID int64,
	windowDays int,
) (*domain.InsuranceRiskProfile, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	window := s.window(windowDays)
	drives, err := s.source.ListDrives(ctx, vehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list drives: %w", err)
	}
	policyRecord, err := s.durable.GetPolicy(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("get insurance policy: %w", err)
	}

	profile := &domain.InsuranceRiskProfile{
		VehicleID: vehicleID,
		Window:    window,
		Factors:   []domain.RiskFactor{},
		Trend:     []domain.RiskTrendPoint{},
		Levers:    []domain.RiskLever{},
		Evidence:  []domain.Evidence{},
	}
	if policyRecord != nil {
		profile.Policy = policyToDomain(*policyRecord)
	}

	usable := usableDrives(drives)
	if len(usable) == 0 {
		profile.RiskGrade = domain.RiskStandard
		profile.RiskScore = 0
		profile.FrequencyIndex = 1
		profile.SeverityIndex = 1
		profile.LossCostIndex = 1
		profile.Quality = quality(
			domain.QualityInsufficient, 0, nil, window,
			"no completed drives with distance and duration in the selected window",
		)
		return profile, nil
	}

	observation := observeRisk(usable)
	profile.ExposureDistanceM = observation.values["_distance_m"]
	profile.ExposureDurationS = int64(observation.values["_duration_s"])
	profile.DriveCount = len(usable)
	profile.NightDistanceM = observation.values["_night_distance_m"]

	frequencyRaw, severityRaw, totalRaw := 0.0, 0.0, 0.0
	scored := make([]domain.RiskFactor, 0, len(riskFactorSpecs))
	for _, spec := range riskFactorSpecs {
		observed, ok := observation.values[spec.code]
		if !ok {
			continue
		}
		deviation := factorDeviation(spec, observed)
		weighted := deviation * spec.weight
		totalRaw += weighted
		if spec.frequency {
			frequencyRaw += weighted
		}
		if spec.severity {
			severityRaw += weighted
		}
		factor := domain.RiskFactor{
			Code:         spec.code,
			Label:        spec.label,
			Direction:    spec.direction,
			ObservedRate: observed,
			BaselineRate: spec.baseline,
			RateUnit:     spec.rateUnit,
			Weight:       spec.weight,
			Score:        deviation,
			SampleCount:  observation.samples[spec.code],
			Narrative:    spec.narrative,
		}
		if pct, ok := observation.exposurePct[spec.code]; ok {
			factor.Percentile = domain.Float64Pointer(pct)
		}
		scored = append(scored, factor)
	}

	magnitude := 0.0
	for _, factor := range scored {
		magnitude += math.Abs(factor.Score * factor.Weight)
	}
	for index := range scored {
		if magnitude > 0 {
			scored[index].ContributionPct = math.Abs(scored[index].Score*scored[index].Weight) / magnitude * 100
		}
	}
	sort.SliceStable(scored, func(i, j int) bool {
		if scored[i].Score*scored[i].Weight == scored[j].Score*scored[j].Weight {
			return scored[i].Code < scored[j].Code
		}
		return scored[i].Score*scored[i].Weight > scored[j].Score*scored[j].Weight
	})
	profile.Factors = scored

	profile.RiskScore = clamp(50*(1+totalRaw), 0, 100)
	profile.FrequencyIndex = clamp(math.Exp(0.5*frequencyRaw), 0.4, 3.0)
	profile.SeverityIndex = clamp(math.Exp(0.5*severityRaw), 0.4, 3.0)
	profile.LossCostIndex = clamp(profile.FrequencyIndex*profile.SeverityIndex, 0.25, 4.0)
	profile.RiskGrade = gradeLossCost(profile.LossCostIndex)
	profile.PeerPercentile = domain.Float64Pointer(clamp(profile.RiskScore, 0, 100))
	profile.Trend = riskTrend(usable, window)
	profile.Levers = riskLevers(scored, profile, policyRecord)
	if policyRecord != nil {
		profile.Premium = simulatePremium(*policyRecord, profile)
	}

	coverage := float64(len(usable)) / float64(maxInt(len(drives), 1)) * 100
	profile.Quality = quality(
		gradeQuality(len(usable), 12, 40),
		len(usable),
		domain.Float64Pointer(coverage),
		window,
		qualityReasons(len(usable), policyRecord != nil)...,
	)
	profile.Evidence = append(profile.Evidence,
		evidence(
			"drives",
			domain.TimePointer(usable[len(usable)-1].StartedAt),
			domain.IntPointer(len(usable)),
			fmt.Sprintf(
				"%d completed drives covering %.0f m of exposure were scored against nine fixed underwriting baselines.",
				len(usable), profile.ExposureDistanceM,
			),
		),
	)
	if policyRecord != nil {
		profile.Evidence = append(profile.Evidence, evidence(
			"insurance_policies",
			domain.TimePointer(policyRecord.UpdatedAt),
			domain.IntPointer(1),
			fmt.Sprintf(
				"Premium simulation anchored on the stored %s baseline with a %.0f%% maximum telematics discount and a disclosed %.0f%% loss-ratio assumption.",
				policyRecord.Insurer, policyRecord.MaxDiscountPct, industryLossRatio*100,
			),
		))
	}
	profile.EvidencePacketHash = insuranceDigest(vehicleID, window, profile)
	return profile, nil
}

func qualityReasons(sampleCount int, hasPolicy bool) []string {
	reasons := make([]string, 0, 2)
	if sampleCount < 40 {
		reasons = append(reasons, "fewer than 40 scored drives; factor rates remain volatile")
	}
	if !hasPolicy {
		reasons = append(reasons, "no stored policy baseline, so premium simulation is unavailable")
	}
	return reasons
}

func usableDrives(drives []port.DriveRecord) []port.DriveRecord {
	usable := make([]port.DriveRecord, 0, len(drives))
	for _, drive := range drives {
		if drive.EndedAt == nil || drive.DistanceM == nil || *drive.DistanceM <= 0 {
			continue
		}
		if drive.DurationS == nil || *drive.DurationS <= 0 {
			continue
		}
		usable = append(usable, drive)
	}
	sort.SliceStable(usable, func(i, j int) bool { return usable[i].StartedAt.Before(usable[j].StartedAt) })
	return usable
}

func observeRisk(drives []port.DriveRecord) riskObservation {
	observation := riskObservation{
		values:      map[string]float64{},
		exposurePct: map[string]float64{},
		samples:     map[string]int{},
	}
	var (
		totalDistance, totalDuration                    float64
		highSpeedDistance, nightDistance, urbanDistance float64
		longHaulDistance, coldDistance                  float64
		harshDrives, speedSamples, tempSamples          int
		highSpeedDrives, nightDrives, urbanDrives       int
		longHaulDrives, coldDrives, harshCandidates     int
		peakSpeed, meanSpeedWeighted                    float64
		energyTotal, regenTotal                         float64
	)
	for _, drive := range drives {
		distance := deref(drive.DistanceM)
		duration := float64(derefI64(drive.DurationS))
		totalDistance += distance
		totalDuration += duration

		if drive.PeakPowerW != nil && drive.AvgPowerW != nil && *drive.AvgPowerW > 0 {
			harshCandidates++
			if *drive.PeakPowerW >= harshPowerFloorW && *drive.PeakPowerW >= harshPowerRatio**drive.AvgPowerW {
				harshDrives++
			}
		}
		if drive.MaxSpeedMps != nil {
			speedSamples++
			if *drive.MaxSpeedMps > peakSpeed {
				peakSpeed = *drive.MaxSpeedMps
			}
			if *drive.MaxSpeedMps >= highSpeedThresholdMps {
				highSpeedDistance += distance
				highSpeedDrives++
			}
		}
		averageSpeed := distance / math.Max(duration, 1)
		if drive.AvgSpeedMps != nil && *drive.AvgSpeedMps > 0 {
			averageSpeed = *drive.AvgSpeedMps
		}
		meanSpeedWeighted += averageSpeed * distance
		if averageSpeed < congestionSpeedMps {
			urbanDistance += distance
			urbanDrives++
		}
		if isNight(drive.StartedAt) {
			nightDistance += distance
			nightDrives++
		}
		if duration >= longHaulDurationS {
			longHaulDistance += distance
			longHaulDrives++
		}
		if drive.AmbientTempC != nil {
			tempSamples++
			if *drive.AmbientTempC < coldExposureC {
				coldDistance += distance
				coldDrives++
			}
		}
		energyTotal += math.Abs(deref(drive.EnergyUsedWh))
		regenTotal += math.Abs(deref(drive.RegenEnergyWh))
	}

	observation.values["_distance_m"] = totalDistance
	observation.values["_duration_s"] = totalDuration
	observation.values["_night_distance_m"] = nightDistance

	spanDays := math.Max(drives[len(drives)-1].StartedAt.Sub(drives[0].StartedAt).Hours()/24, 1)

	if harshCandidates > 0 && totalDistance > 0 {
		observation.values["harsh_power"] = float64(harshDrives) / (totalDistance / 1e6)
		observation.samples["harsh_power"] = harshCandidates
		observation.exposurePct["harsh_power"] = float64(harshDrives) / float64(harshCandidates) * 100
	}
	if speedSamples > 0 && totalDistance > 0 {
		observation.values["speed_exposure"] = highSpeedDistance / totalDistance
		observation.samples["speed_exposure"] = speedSamples
		observation.exposurePct["speed_exposure"] = float64(highSpeedDrives) / float64(speedSamples) * 100

		averageSpeed := meanSpeedWeighted / math.Max(totalDistance, 1)
		if averageSpeed > 0 && peakSpeed > 0 {
			observation.values["speed_variance"] = peakSpeed / averageSpeed
			observation.samples["speed_variance"] = speedSamples
		}
	}
	if totalDistance > 0 {
		observation.values["night_exposure"] = nightDistance / totalDistance
		observation.samples["night_exposure"] = len(drives)
		observation.exposurePct["night_exposure"] = float64(nightDrives) / float64(len(drives)) * 100

		observation.values["urban_congestion"] = urbanDistance / totalDistance
		observation.samples["urban_congestion"] = len(drives)
		observation.exposurePct["urban_congestion"] = float64(urbanDrives) / float64(len(drives)) * 100

		observation.values["long_haul"] = longHaulDistance / totalDistance
		observation.samples["long_haul"] = len(drives)
		observation.exposurePct["long_haul"] = float64(longHaulDrives) / float64(len(drives)) * 100
	}
	observation.values["trip_density"] = float64(len(drives)) / spanDays
	observation.samples["trip_density"] = len(drives)

	if tempSamples > 0 && totalDistance > 0 {
		observation.values["cold_exposure"] = coldDistance / totalDistance
		observation.samples["cold_exposure"] = tempSamples
		observation.exposurePct["cold_exposure"] = float64(coldDrives) / float64(tempSamples) * 100
	}
	if energyTotal > 0 {
		observation.values["regen_discipline"] = regenTotal / energyTotal
		observation.samples["regen_discipline"] = len(drives)
	}
	return observation
}

func isNight(at time.Time) bool {
	hour := at.UTC().Hour()
	return hour >= nightStartHour || hour < nightEndHour
}

// factorDeviation converts an observed rate into a signed, bounded deviation
// where positive always means "worse than baseline".
func factorDeviation(spec riskFactorSpec, observed float64) float64 {
	if spec.baseline <= 0 {
		return 0
	}
	deviation := (observed - spec.baseline) / spec.baseline
	if spec.direction == domain.DirectionHigherIsBetter {
		deviation = -deviation
	}
	return clamp(deviation, -1, 3)
}

func gradeLossCost(lossCost float64) domain.RiskGrade {
	switch {
	case lossCost < 0.85:
		return domain.RiskPreferred
	case lossCost < 1.10:
		return domain.RiskStandard
	case lossCost < 1.45:
		return domain.RiskSubstandard
	default:
		return domain.RiskHigh
	}
}

func riskTrend(drives []port.DriveRecord, window domain.Window) []domain.RiskTrendPoint {
	if len(drives) == 0 {
		return []domain.RiskTrendPoint{}
	}
	buckets := map[time.Time][]port.DriveRecord{}
	order := []time.Time{}
	for _, drive := range drives {
		start := drive.StartedAt.UTC().Truncate(24 * time.Hour)
		start = start.AddDate(0, 0, -int(start.Weekday()))
		if _, seen := buckets[start]; !seen {
			order = append(order, start)
		}
		buckets[start] = append(buckets[start], drive)
	}
	sort.Slice(order, func(i, j int) bool { return order[i].Before(order[j]) })

	points := make([]domain.RiskTrendPoint, 0, len(order))
	for _, start := range order {
		bucket := buckets[start]
		observation := observeRisk(bucket)
		raw := 0.0
		frequencyRaw, severityRaw := 0.0, 0.0
		for _, spec := range riskFactorSpecs {
			observed, ok := observation.values[spec.code]
			if !ok {
				continue
			}
			weighted := factorDeviation(spec, observed) * spec.weight
			raw += weighted
			if spec.frequency {
				frequencyRaw += weighted
			}
			if spec.severity {
				severityRaw += weighted
			}
		}
		lossCost := clamp(math.Exp(0.5*frequencyRaw), 0.4, 3.0) * clamp(math.Exp(0.5*severityRaw), 0.4, 3.0)
		points = append(points, domain.RiskTrendPoint{
			BucketStart:   start,
			RiskScore:     clamp(50*(1+raw), 0, 100),
			DistanceM:     observation.values["_distance_m"],
			DriveCount:    len(bucket),
			LossCostIndex: clamp(lossCost, 0.25, 4.0),
		})
	}
	_ = window
	return points
}

func riskLevers(
	factors []domain.RiskFactor,
	profile *domain.InsuranceRiskProfile,
	policy *port.PolicyRecord,
) []domain.RiskLever {
	specByCode := map[string]riskFactorSpec{}
	for _, spec := range riskFactorSpecs {
		specByCode[spec.code] = spec
	}
	levers := make([]domain.RiskLever, 0, 4)
	rank := 0
	for _, factor := range factors {
		if factor.Score <= 0.05 {
			continue
		}
		spec := specByCode[factor.Code]
		const targetReduction = 25.0
		improvedRate := factor.ObservedRate
		if spec.direction == domain.DirectionHigherIsWorse {
			improvedRate = factor.ObservedRate * (1 - targetReduction/100)
		} else {
			improvedRate = factor.ObservedRate * (1 + targetReduction/100)
		}
		improvedDeviation := factorDeviation(spec, improvedRate)
		scoreDelta := (improvedDeviation - factor.Score) * spec.weight * 50
		rank++
		lever := domain.RiskLever{
			FactorCode:          factor.Code,
			Label:               spec.lever,
			TargetReductionPct:  targetReduction,
			ProjectedScoreDelta: scoreDelta,
			Difficulty:          leverDifficulty(spec.effort),
			Confidence:          clamp(0.45+float64(factor.SampleCount)/200, 0.45, 0.95),
			PayoffRank:          rank,
			EffortHoursPerWeek:  domain.Float64Pointer(spec.effort),
		}
		if policy != nil && profile.LossCostIndex > 0 {
			improvedLoss := profile.LossCostIndex * math.Exp(0.5*(improvedDeviation-factor.Score)*spec.weight)
			currentPremium := modelledPremiumMinor(*policy, profile.LossCostIndex)
			improvedPremium := modelledPremiumMinor(*policy, improvedLoss)
			saving := currentPremium - improvedPremium
			if saving > 0 {
				lever.ProjectedPremiumSave = pointer(saving)
			}
		}
		levers = append(levers, lever)
		if rank >= 4 {
			break
		}
	}
	return levers
}

func leverDifficulty(effortHours float64) string {
	switch {
	case effortHours <= 0.3:
		return "easy"
	case effortHours <= 0.75:
		return "moderate"
	default:
		return "committed"
	}
}

func modelledPremiumMinor(policy port.PolicyRecord, lossCost float64) int64 {
	discountPct := clamp((1-lossCost)*100, -100, policy.MaxDiscountPct)
	return roundMinor(float64(policy.AnnualPremiumMinor) * (1 - discountPct/100))
}

func simulatePremium(policy port.PolicyRecord, profile *domain.InsuranceRiskProfile) *domain.PremiumSimulation {
	modelled := modelledPremiumMinor(policy, profile.LossCostIndex)
	discountPct := clamp((1-profile.LossCostIndex)*100, -100, policy.MaxDiscountPct)
	simulation := &domain.PremiumSimulation{
		Currency:             policy.Currency,
		BaselinePremiumMinor: policy.AnnualPremiumMinor,
		ModelledPremiumMinor: modelled,
		DeltaMinor:           modelled - policy.AnnualPremiumMinor,
		AppliedDiscountPct:   discountPct,
		MaxDiscountPct:       policy.MaxDiscountPct,
		DeductibleMinor:      policy.DeductibleMinor,
		ExpectedLossMinor: pointer(roundMinor(
			float64(policy.AnnualPremiumMinor) * industryLossRatio * profile.LossCostIndex,
		)),
	}
	if policy.AnnualPremiumMinor > 0 {
		simulation.DeltaPct = float64(simulation.DeltaMinor) / float64(policy.AnnualPremiumMinor) * 100
	}
	if profile.Window.Days > 0 && profile.ExposureDistanceM > 0 {
		annualDistance := profile.ExposureDistanceM * (365.0 / float64(profile.Window.Days))
		simulation.CostPerDistanceMinor = safeDiv(float64(modelled), annualDistance)
	}
	return simulation
}

func insuranceDigest(vehicleID int64, window domain.Window, profile *domain.InsuranceRiskProfile) string {
	hasher := sha256.New()
	fmt.Fprintf(hasher, "v1|%d|%s|%s|", vehicleID, window.From.UTC().Format(time.RFC3339), window.To.UTC().Format(time.RFC3339))
	fmt.Fprintf(hasher, "%.6f|%.6f|%.6f|%.6f|", profile.RiskScore, profile.FrequencyIndex, profile.SeverityIndex, profile.LossCostIndex)
	for _, factor := range profile.Factors {
		fmt.Fprintf(hasher, "%s=%.8f;", factor.Code, factor.ObservedRate)
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func policyToDomain(record port.PolicyRecord) *domain.InsurancePolicy {
	return &domain.InsurancePolicy{
		ID:                 record.ID,
		VehicleID:          record.VehicleID,
		Insurer:            record.Insurer,
		PolicyRef:          record.PolicyRef,
		Currency:           record.Currency,
		AnnualPremiumMinor: record.AnnualPremiumMinor,
		DeductibleMinor:    record.DeductibleMinor,
		CoverageStart:      record.CoverageStart,
		CoverageEnd:        record.CoverageEnd,
		TelematicsProgram:  record.TelematicsProgram,
		MaxDiscountPct:     record.MaxDiscountPct,
		Version:            record.Version,
		CreatedAt:          record.CreatedAt,
		UpdatedAt:          record.UpdatedAt,
	}
}

// UpsertInsurancePolicy stores or replaces the underwriting baseline.
func (s *Service) UpsertInsurancePolicy(
	ctx context.Context,
	subject string,
	request domain.UpsertInsurancePolicyRequest,
) (*domain.InsurancePolicy, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	insurer, ok := requireText(request.Insurer, 160)
	if !ok {
		return nil, fmt.Errorf("%w: insurer is required", ErrInvalidInput)
	}
	policyRef, ok := cleanText(request.PolicyRef, 160)
	if !ok {
		return nil, fmt.Errorf("%w: policy_ref is too long", ErrInvalidInput)
	}
	currency, ok := validCurrency(request.Currency)
	if !ok {
		return nil, fmt.Errorf("%w: currency must be an ISO-4217 alpha-3 code", ErrInvalidInput)
	}
	if !requireNonNeg(request.AnnualPremiumMinor) || !requireNonNeg(request.DeductibleMinor) {
		return nil, fmt.Errorf("%w: monetary amounts must not be negative", ErrInvalidInput)
	}
	if request.CoverageStart.IsZero() {
		return nil, fmt.Errorf("%w: coverage_start is required", ErrInvalidInput)
	}
	if request.CoverageEnd != nil && !request.CoverageEnd.After(request.CoverageStart) {
		return nil, fmt.Errorf("%w: coverage_end must be after coverage_start", ErrInvalidInput)
	}
	if request.MaxDiscountPct < 0 || request.MaxDiscountPct > 60 {
		return nil, fmt.Errorf("%w: max_discount_pct must be between 0 and 60", ErrInvalidInput)
	}
	record, err := s.durable.UpsertPolicy(ctx, subject, port.PolicyRecord{
		VehicleID:          request.VehicleID,
		Insurer:            insurer,
		PolicyRef:          policyRef,
		Currency:           currency,
		AnnualPremiumMinor: request.AnnualPremiumMinor,
		DeductibleMinor:    request.DeductibleMinor,
		CoverageStart:      request.CoverageStart.UTC(),
		CoverageEnd:        request.CoverageEnd,
		TelematicsProgram:  request.TelematicsProgram,
		MaxDiscountPct:     request.MaxDiscountPct,
	})
	if err != nil {
		return nil, fmt.Errorf("upsert insurance policy: %w", err)
	}
	return policyToDomain(*record), nil
}

// DeleteInsurancePolicy removes the stored underwriting baseline.
func (s *Service) DeleteInsurancePolicy(ctx context.Context, subject string, id int64) error {
	if id <= 0 {
		return fmt.Errorf("%w: policy id must be positive", ErrInvalidInput)
	}
	if err := s.durable.DeletePolicy(ctx, subject, id); err != nil {
		return fmt.Errorf("delete insurance policy: %w", err)
	}
	return nil
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
