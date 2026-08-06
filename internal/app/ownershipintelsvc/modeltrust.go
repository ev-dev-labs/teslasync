package ownershipintelsvc

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

const (
	// minScoredForGrade is the evidence floor before a trust grade is issued.
	minScoredForGrade = 8
	// driftSplitRatio splits the scored history into an early and a late half
	// so a widening error can be detected without a separate model registry.
	driftSplitRatio = 0.5
	// nominalCoveragePct is the coverage a well-calibrated interval should hit.
	nominalCoveragePct = 80.0
	// recentPredictionLimit bounds the raw rows attached to the report.
	recentPredictionLimit = 40
)

var allowedTargets = map[string]string{
	"range_m":              "m",
	"energy_wh":            "Wh",
	"charge_duration_s":    "s",
	"drive_duration_s":     "s",
	"efficiency_wh_per_m":  "Wh/m",
	"battery_capacity_wh":  "Wh",
	"cost_minor":           "minor",
	"soc_pct":              "%",
	"departure_soc_pct":    "%",
	"tire_pressure_kpa":    "kPa",
	"maintenance_due_m":    "m",
	"session_energy_wh":    "Wh",
	"degradation_pct":      "%",
	"arrival_soc_pct":      "%",
	"grid_intensity_g_wh":  "g/Wh",
	"idle_consumption_wh":  "Wh",
	"regen_share_pct":      "%",
	"consumable_life_m":    "m",
	"premium_minor":        "minor",
	"tariff_cost_minor":    "minor",
	"utilisation_pct":      "%",
	"availability_pct":     "%",
	"charge_rate_w":        "W",
	"ambient_temp_c":       "degC",
	"cabin_temp_c":         "degC",
	"trip_distance_m":      "m",
	"parasitic_draw_w":     "W",
	"phantom_drain_wh":     "Wh",
	"supercharge_cost_min": "minor",
}

// RecordPrediction stores a forecast so it can later be scored against reality.
func (s *Service) RecordPrediction(
	ctx context.Context,
	subject string,
	request domain.RecordPredictionRequest,
) (*domain.Prediction, error) {
	if request.VehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	modelName, ok := requireText(request.ModelName, 120)
	if !ok {
		return nil, fmt.Errorf("%w: model_name is required", ErrInvalidInput)
	}
	target := strings.TrimSpace(request.Target)
	unit, known := allowedTargets[target]
	if !known {
		return nil, fmt.Errorf("%w: target %q is not a recognised SI-canonical prediction target", ErrInvalidInput, target)
	}
	if request.SIUnit != "" && request.SIUnit != unit {
		return nil, fmt.Errorf("%w: target %q is measured in %s, not %s", ErrInvalidInput, target, unit, request.SIUnit)
	}
	if !requirePositive(request.HorizonS) {
		return nil, fmt.Errorf("%w: horizon_s must be positive", ErrInvalidInput)
	}
	if math.IsNaN(request.PredictedValue) || math.IsInf(request.PredictedValue, 0) {
		return nil, fmt.Errorf("%w: predicted_value must be finite", ErrInvalidInput)
	}
	if request.PredictedLow != nil && request.PredictedHigh != nil && *request.PredictedLow > *request.PredictedHigh {
		return nil, fmt.Errorf("%w: predicted_low cannot exceed predicted_high", ErrInvalidInput)
	}
	reference, ok := cleanText(request.Reference, 200)
	if !ok {
		return nil, fmt.Errorf("%w: reference is too long", ErrInvalidInput)
	}
	predictedAt := request.PredictedAt
	if predictedAt.IsZero() {
		predictedAt = s.now()
	}
	record, err := s.durable.CreatePrediction(ctx, subject, port.PredictionRecord{
		VehicleID:      request.VehicleID,
		ModelName:      modelName,
		Target:         target,
		SIUnit:         unit,
		PredictedAt:    predictedAt.UTC(),
		HorizonS:       request.HorizonS,
		PredictedValue: request.PredictedValue,
		PredictedLow:   request.PredictedLow,
		PredictedHigh:  request.PredictedHigh,
		Reference:      reference,
	})
	if err != nil {
		return nil, fmt.Errorf("create prediction: %w", err)
	}
	prediction := predictionToDomain(*record)
	return &prediction, nil
}

// RecordOutcome closes the loop on a stored forecast.
func (s *Service) RecordOutcome(
	ctx context.Context,
	subject string,
	request domain.RecordOutcomeRequest,
) (*domain.Prediction, error) {
	if request.PredictionID <= 0 {
		return nil, fmt.Errorf("%w: prediction_id must be positive", ErrInvalidInput)
	}
	if math.IsNaN(request.ObservedValue) || math.IsInf(request.ObservedValue, 0) {
		return nil, fmt.Errorf("%w: observed_value must be finite", ErrInvalidInput)
	}
	observedAt := request.ObservedAt
	if observedAt.IsZero() {
		observedAt = s.now()
	}
	record, err := s.durable.RecordOutcome(ctx, subject, request.PredictionID, request.ObservedValue, observedAt.UTC())
	if err != nil {
		return nil, fmt.Errorf("record outcome: %w", err)
	}
	prediction := predictionToDomain(*record)
	return &prediction, nil
}

// ModelTrust scores every forecast the platform has made against what actually
// happened, producing a per-model accuracy scorecard.
func (s *Service) ModelTrust(
	ctx context.Context,
	subject string,
	vehicleID int64,
	windowDays int,
) (*domain.ModelTrustReport, error) {
	if vehicleID <= 0 {
		return nil, fmt.Errorf("%w: vehicle_id must be positive", ErrInvalidInput)
	}
	window := s.window(windowDays)
	records, err := s.durable.ListPredictions(ctx, subject, vehicleID, window.From, window.To)
	if err != nil {
		return nil, fmt.Errorf("list predictions: %w", err)
	}

	report := &domain.ModelTrustReport{
		VehicleID:        vehicleID,
		Window:           window,
		Scorecards:       []domain.ModelScorecard{},
		Recent:           []domain.Prediction{},
		TotalPredictions: len(records),
		Evidence:         []domain.Evidence{},
	}

	grouped := map[string][]port.PredictionRecord{}
	for _, record := range records {
		key := record.ModelName + "\x00" + record.Target
		grouped[key] = append(grouped[key], record)
		if record.ObservedValue != nil {
			report.TotalScored++
		}
	}

	trustSum, trustCount := 0.0, 0
	for _, group := range grouped {
		scorecard := buildScorecard(group, window)
		switch scorecard.TrustGrade {
		case domain.TrustTrusted:
			report.TrustedCount++
		case domain.TrustWatch:
			report.WatchCount++
		case domain.TrustUnreliable:
			report.UnreliableCount++
		}
		if scorecard.TrustGrade != domain.TrustUnevaluated {
			trustSum += scorecard.TrustScore
			trustCount++
		}
		report.Scorecards = append(report.Scorecards, scorecard)
	}
	sort.SliceStable(report.Scorecards, func(i, j int) bool {
		if report.Scorecards[i].ModelName == report.Scorecards[j].ModelName {
			return report.Scorecards[i].Target < report.Scorecards[j].Target
		}
		return report.Scorecards[i].ModelName < report.Scorecards[j].ModelName
	})
	if trustCount > 0 {
		report.PortfolioTrust = pointer(trustSum / float64(trustCount))
	}

	sorted := append([]port.PredictionRecord(nil), records...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].PredictedAt.After(sorted[j].PredictedAt) })
	for index, record := range sorted {
		if index >= recentPredictionLimit {
			break
		}
		report.Recent = append(report.Recent, predictionToDomain(record))
	}

	reasons := []string{}
	if len(records) == 0 {
		reasons = append(reasons, "no forecasts have been recorded for this vehicle in the selected window")
	}
	if report.TotalScored < minScoredForGrade {
		reasons = append(reasons, fmt.Sprintf("only %d forecasts have a recorded outcome; %d are needed before a trust grade is issued",
			report.TotalScored, minScoredForGrade))
	}
	coverage := 0.0
	if len(records) > 0 {
		coverage = float64(report.TotalScored) / float64(len(records)) * 100
	}
	report.Quality = quality(
		gradeQuality(report.TotalScored, minScoredForGrade, 60),
		report.TotalScored,
		domain.Float64Pointer(coverage),
		window,
		reasons...,
	)
	report.Evidence = append(report.Evidence, evidence(
		"model_predictions",
		domain.TimePointer(window.To),
		domain.IntPointer(len(records)),
		fmt.Sprintf(
			"%d forecasts were compared with %d realised outcomes. Skill is measured against a persistence baseline and intervals are scored at a %.0f%% nominal coverage.",
			len(records), report.TotalScored, nominalCoveragePct,
		),
	))
	return report, nil
}

func buildScorecard(records []port.PredictionRecord, window domain.Window) domain.ModelScorecard {
	scorecard := domain.ModelScorecard{
		ModelName:   records[0].ModelName,
		Target:      records[0].Target,
		SIUnit:      records[0].SIUnit,
		SampleCount: len(records),
		TrustGrade:  domain.TrustUnevaluated,
		DriftStatus: "unknown",
		Calibration: []domain.CalibrationBin{},
	}

	scored := make([]port.PredictionRecord, 0, len(records))
	for _, record := range records {
		if record.ObservedValue != nil {
			scored = append(scored, record)
		}
	}
	sort.SliceStable(scored, func(i, j int) bool { return scored[i].PredictedAt.Before(scored[j].PredictedAt) })
	scorecard.ScoredCount = len(scored)
	scorecard.PendingCount = len(records) - len(scored)

	if len(scored) == 0 {
		scorecard.Narrative = "No outcome has been recorded yet, so this model cannot be graded."
		scorecard.Quality = quality(domain.QualityInsufficient, 0, nil, window,
			"every forecast is still awaiting its realised outcome")
		return scorecard
	}
	scorecard.FirstScoredAt = domain.TimePointer(scored[0].PredictedAt)
	scorecard.LastScoredAt = domain.TimePointer(scored[len(scored)-1].PredictedAt)

	errors := make([]float64, 0, len(scored))
	absErrors := make([]float64, 0, len(scored))
	squared := make([]float64, 0, len(scored))
	pctErrors := make([]float64, 0, len(scored))
	naiveAbs := make([]float64, 0, len(scored))
	insideInterval, intervalCount := 0, 0

	var previousObserved *float64
	for _, record := range scored {
		observed := *record.ObservedValue
		delta := record.PredictedValue - observed
		errors = append(errors, delta)
		absErrors = append(absErrors, math.Abs(delta))
		squared = append(squared, delta*delta)
		if math.Abs(observed) > 1e-9 {
			pctErrors = append(pctErrors, math.Abs(delta)/math.Abs(observed)*100)
		}
		if previousObserved != nil {
			naiveAbs = append(naiveAbs, math.Abs(*previousObserved-observed))
		}
		previous := observed
		previousObserved = &previous
		if record.PredictedLow != nil && record.PredictedHigh != nil {
			intervalCount++
			if observed >= *record.PredictedLow && observed <= *record.PredictedHigh {
				insideInterval++
			}
		}
	}

	scorecard.Bias = mean(errors)
	scorecard.MeanAbsError = mean(absErrors)
	if meanSquared := mean(squared); meanSquared != nil {
		scorecard.RootMeanSqError = pointer(math.Sqrt(*meanSquared))
	}
	scorecard.MeanAbsPctError = mean(pctErrors)
	scorecard.MedianAbsPctError = median(pctErrors)
	if intervalCount > 0 {
		scorecard.IntervalCoveragePc = pointer(float64(insideInterval) / float64(intervalCount) * 100)
	}
	if naiveMean := mean(naiveAbs); naiveMean != nil && *naiveMean > 0 && scorecard.MeanAbsError != nil {
		scorecard.SkillVsNaivePct = pointer(clamp((1 - *scorecard.MeanAbsError / *naiveMean)*100, -200, 100))
	}

	if len(absErrors) >= minScoredForGrade {
		split := int(float64(len(absErrors)) * driftSplitRatio)
		if split > 0 && split < len(absErrors) {
			early := mean(absErrors[:split])
			late := mean(absErrors[split:])
			if early != nil && late != nil && *early > 0 {
				ratio := *late / *early
				scorecard.DriftRatio = pointer(ratio)
				switch {
				case ratio > 1.5:
					scorecard.DriftStatus = "degrading"
				case ratio < 0.67:
					scorecard.DriftStatus = "improving"
				default:
					scorecard.DriftStatus = "stable"
				}
			}
		}
	}
	scorecard.Calibration = buildCalibration(scored)
	scorecard.TrustScore, scorecard.TrustGrade = gradeTrust(scorecard)
	scorecard.Narrative = trustNarrative(scorecard)
	scorecard.Quality = quality(
		gradeQuality(len(scored), minScoredForGrade, 60),
		len(scored),
		domain.Float64Pointer(clamp(float64(len(scored))/float64(maxInt(len(records), 1))*100, 0, 100)),
		window,
	)
	return scorecard
}

// buildCalibration bins forecasts by their predicted magnitude percentile so a
// systematic bias at one end of the range becomes visible.
func buildCalibration(scored []port.PredictionRecord) []domain.CalibrationBin {
	if len(scored) < 4 {
		return []domain.CalibrationBin{}
	}
	ordered := append([]port.PredictionRecord(nil), scored...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].PredictedValue < ordered[j].PredictedValue })
	binCount := 4
	if len(ordered) >= 20 {
		binCount = 5
	}
	bins := make([]domain.CalibrationBin, 0, binCount)
	for index := 0; index < binCount; index++ {
		start := index * len(ordered) / binCount
		end := (index + 1) * len(ordered) / binCount
		if start >= end {
			continue
		}
		slice := ordered[start:end]
		absErrors := make([]float64, 0, len(slice))
		biases := make([]float64, 0, len(slice))
		inside, intervals := 0, 0
		for _, record := range slice {
			delta := record.PredictedValue - *record.ObservedValue
			absErrors = append(absErrors, math.Abs(delta))
			biases = append(biases, delta)
			if record.PredictedLow != nil && record.PredictedHigh != nil {
				intervals++
				if *record.ObservedValue >= *record.PredictedLow && *record.ObservedValue <= *record.PredictedHigh {
					inside++
				}
			}
		}
		bin := domain.CalibrationBin{
			LowerPct:     float64(start) / float64(len(ordered)) * 100,
			UpperPct:     float64(end) / float64(len(ordered)) * 100,
			SampleCount:  len(slice),
			MeanAbsError: deref(mean(absErrors)),
			MeanBias:     deref(mean(biases)),
		}
		if intervals > 0 {
			bin.CoveragePct = pointer(float64(inside) / float64(intervals) * 100)
		}
		bins = append(bins, bin)
	}
	return bins
}

// gradeTrust folds accuracy, calibration, skill, and drift into a single score.
func gradeTrust(scorecard domain.ModelScorecard) (float64, domain.TrustGrade) {
	if scorecard.ScoredCount < minScoredForGrade {
		return 0, domain.TrustUnevaluated
	}
	score := 100.0
	if scorecard.MedianAbsPctError != nil {
		score -= clamp(*scorecard.MedianAbsPctError*1.5, 0, 45)
	} else if scorecard.MeanAbsPctError != nil {
		score -= clamp(*scorecard.MeanAbsPctError*1.5, 0, 45)
	}
	if scorecard.IntervalCoveragePc != nil {
		score -= clamp(math.Abs(*scorecard.IntervalCoveragePc-nominalCoveragePct)*0.6, 0, 20)
	}
	if scorecard.SkillVsNaivePct != nil {
		if *scorecard.SkillVsNaivePct < 0 {
			score -= clamp(-*scorecard.SkillVsNaivePct*0.3, 0, 25)
		} else {
			score += clamp(*scorecard.SkillVsNaivePct*0.1, 0, 8)
		}
	}
	switch scorecard.DriftStatus {
	case "degrading":
		score -= 12
	case "improving":
		score += 4
	}
	if scorecard.Bias != nil && scorecard.MeanAbsError != nil && *scorecard.MeanAbsError > 0 {
		// A bias that dominates the absolute error means the model is
		// systematically off rather than merely noisy.
		if math.Abs(*scorecard.Bias)/(*scorecard.MeanAbsError) > 0.7 {
			score -= 10
		}
	}
	score = clamp(score, 0, 100)
	switch {
	case score >= 75:
		return score, domain.TrustTrusted
	case score >= 50:
		return score, domain.TrustWatch
	default:
		return score, domain.TrustUnreliable
	}
}

func trustNarrative(scorecard domain.ModelScorecard) string {
	parts := []string{fmt.Sprintf("%s scored %d of %d forecasts for %s",
		scorecard.ModelName, scorecard.ScoredCount, scorecard.SampleCount, scorecard.Target)}
	if scorecard.MedianAbsPctError != nil {
		parts = append(parts, fmt.Sprintf("median absolute error is %.1f%%", *scorecard.MedianAbsPctError))
	}
	if scorecard.Bias != nil {
		direction := "over"
		if *scorecard.Bias < 0 {
			direction = "under"
		}
		parts = append(parts, fmt.Sprintf("it %spredicts by %.3g %s on average", direction, math.Abs(*scorecard.Bias), scorecard.SIUnit))
	}
	if scorecard.SkillVsNaivePct != nil {
		if *scorecard.SkillVsNaivePct >= 0 {
			parts = append(parts, fmt.Sprintf("it beats a persistence baseline by %.0f%%", *scorecard.SkillVsNaivePct))
		} else {
			parts = append(parts, fmt.Sprintf("it loses to a persistence baseline by %.0f%%", -*scorecard.SkillVsNaivePct))
		}
	}
	if scorecard.IntervalCoveragePc != nil {
		parts = append(parts, fmt.Sprintf("its stated intervals capture %.0f%% of outcomes against a %.0f%% target",
			*scorecard.IntervalCoveragePc, nominalCoveragePct))
	}
	if scorecard.DriftStatus != "unknown" {
		parts = append(parts, fmt.Sprintf("accuracy is %s over the window", scorecard.DriftStatus))
	}
	return strings.Join(parts, ", ") + "."
}

func predictionToDomain(record port.PredictionRecord) domain.Prediction {
	prediction := domain.Prediction{
		ID:             record.ID,
		VehicleID:      record.VehicleID,
		ModelName:      record.ModelName,
		Target:         record.Target,
		SIUnit:         record.SIUnit,
		PredictedAt:    record.PredictedAt,
		HorizonS:       record.HorizonS,
		PredictedValue: record.PredictedValue,
		PredictedLow:   record.PredictedLow,
		PredictedHigh:  record.PredictedHigh,
		Reference:      record.Reference,
		ObservedValue:  record.ObservedValue,
		ObservedAt:     record.ObservedAt,
		CreatedAt:      record.CreatedAt,
	}
	if record.ObservedValue != nil {
		delta := record.PredictedValue - *record.ObservedValue
		prediction.ErrorValue = pointer(delta)
		if math.Abs(*record.ObservedValue) > 1e-9 {
			prediction.AbsErrorPct = pointer(math.Abs(delta) / math.Abs(*record.ObservedValue) * 100)
		}
		if record.PredictedLow != nil && record.PredictedHigh != nil {
			inside := *record.ObservedValue >= *record.PredictedLow && *record.ObservedValue <= *record.PredictedHigh
			prediction.InInterval = &inside
		}
	}
	return prediction
}
