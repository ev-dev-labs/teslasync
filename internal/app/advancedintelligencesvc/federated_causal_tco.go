package advancedintelligencesvc

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
	port "github.com/ev-dev-labs/teslasync/internal/port/advancedintelligence"
)

var modelVersionPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

func (s *Service) FederatedStatus(
	ctx context.Context,
	subject string,
	vehicleID int64,
	limit, offset int,
) (*domain.FederatedStatusPage, error) {
	limit, offset = normalizePage(limit, offset)
	if subject = cleanToken(subject, 512); subject == "" || vehicleID <= 0 {
		return nil, fmt.Errorf("%w: subject and vehicle_id are required", ErrInvalidInput)
	}
	now := s.now().UTC()
	rows, total, totalBudget, totalSpent, err := s.durable.ListModelCards(
		ctx, subject, vehicleID, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("list federated model cards: %w", err)
	}
	items := make([]domain.FederatedModelCard, 0, len(rows))
	for _, row := range rows {
		items = append(items, modelCardFromRecord(row))
	}
	status := domain.QualitySufficient
	reasons := []string{"model-card state is subject and vehicle scoped"}
	if total == 0 {
		status = domain.QualityInsufficient
		reasons = []string{"no local model card has been created for this subject and vehicle"}
	}
	return &domain.FederatedStatusPage{
		Page: domain.Page[domain.FederatedModelCard]{
			Items: items, Total: total, Limit: limit, Offset: offset,
		},
		VehicleID:          vehicleID,
		TotalEpsilonBudget: totalBudget,
		TotalEpsilonSpent:  totalSpent,
		PrivacyStatement:   "Only aggregate round metadata and privacy accounting are persisted; raw trips, locations, video, and gradients are not stored.",
		DataQuality:        quality(status, total, nil, nil, timePointer(now), reasons...),
		Evidence: []domain.Evidence{
			evidence(
				"advanced_federated_model_cards",
				timePointer(now),
				intPointer(total),
				"Subject-scoped model-card metadata supplies status and privacy accounting.",
			),
		},
		GeneratedAt: now,
	}, nil
}

func (s *Service) StartFederatedRound(
	ctx context.Context,
	subject string,
	request domain.StartFederatedRoundRequest,
) (*domain.FederatedRoundResult, error) {
	subject = cleanToken(subject, 512)
	if err := ValidateFederatedRound(subject, request); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	aggregate, err := s.source.LocalTrainingAggregate(
		ctx, request.VehicleID, now.Add(-90*24*time.Hour), now,
	)
	if err != nil {
		return nil, fmt.Errorf("derive local training aggregate: %w", err)
	}
	status := "insufficient"
	var metric *float64
	sampleCount := 0
	var observedAt *time.Time
	if aggregate != nil {
		sampleCount = aggregate.SampleCount
		observedAt = aggregate.ObservedAt
		if aggregate.SampleCount >= 5 && aggregate.MetricWhPerM != nil &&
			*aggregate.MetricWhPerM >= 0 {
			status = "completed"
			metric = aggregate.MetricWhPerM
		}
	}
	card, round, err := s.durable.CreateRound(ctx, port.CreateRoundParams{
		Subject:           subject,
		VehicleID:         request.VehicleID,
		ModelName:         strings.TrimSpace(request.ModelName),
		ModelVersion:      strings.TrimSpace(request.ModelVersion),
		Task:              request.Task,
		Epsilon:           request.Epsilon,
		EpsilonBudget:     request.EpsilonBudget,
		ExpectedVersion:   request.ExpectedVersion,
		SampleCount:       sampleCount,
		LocalMetricWhPerM: metric,
		Status:            status,
		Now:               now,
	})
	if err != nil {
		return nil, fmt.Errorf("persist local federated round: %w", err)
	}
	roundQuality := domain.QualitySufficient
	roundReasons := []string{"at least five aggregate local samples supported the round"}
	if status == "insufficient" {
		roundQuality = domain.QualityInsufficient
		roundReasons = []string{"fewer than five aggregate local samples were available; epsilon_spent is zero"}
	}
	return &domain.FederatedRoundResult{
		ModelCard: modelCardFromRecord(*card),
		Round:     roundFromRecord(*round),
		DataQuality: quality(
			roundQuality, sampleCount, nil, nil, observedAt, roundReasons...,
		),
		Evidence: []domain.Evidence{
			evidence(
				"drives_aggregate",
				observedAt,
				intPointer(sampleCount),
				"Local training uses aggregate completed-drive energy per distance; no raw drive crosses the service boundary.",
			),
		},
	}, nil
}

func ValidateFederatedRound(
	subject string,
	request domain.StartFederatedRoundRequest,
) error {
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	if subject == "" || request.VehicleID <= 0 ||
		cleanToken(request.ModelName, 120) == "" ||
		!modelVersionPattern.MatchString(strings.TrimSpace(request.ModelVersion)) ||
		request.Task != "efficiency" ||
		request.Epsilon < 0.01 || request.Epsilon > 5 ||
		request.EpsilonBudget < request.Epsilon || request.EpsilonBudget > 20 ||
		request.ExpectedVersion < 0 {
		return fmt.Errorf("%w: federated round fields are invalid", ErrInvalidInput)
	}
	return nil
}

func modelCardFromRecord(row port.FederatedModelCardRecord) domain.FederatedModelCard {
	limitations := []string{
		"The model card describes local aggregate training metadata, not a centralized fleet model.",
		"No raw trips, locations, video, command payloads, or gradients are persisted.",
	}
	if row.LatestStatus != nil && *row.LatestStatus == "insufficient" {
		limitations = append(limitations,
			"The latest round had fewer than five valid aggregate training samples and spent no epsilon.")
	}
	return domain.FederatedModelCard{
		ID:                 row.ID,
		VehicleID:          row.VehicleID,
		ModelName:          row.ModelName,
		ModelVersion:       row.ModelVersion,
		Task:               row.Task,
		Version:            row.Version,
		EpsilonBudget:      row.EpsilonBudget,
		EpsilonSpent:       row.EpsilonSpent,
		RoundCount:         row.RoundCount,
		LatestSampleCount:  row.LatestSampleCount,
		LatestMetricWhPerM: row.LatestMetricWhPerM,
		LatestStatus:       row.LatestStatus,
		UpdatedAt:          row.UpdatedAt.UTC(),
		Limitations:        limitations,
	}
}

func roundFromRecord(row port.FederatedRoundRecord) domain.FederatedRound {
	return domain.FederatedRound{
		ID:                row.ID,
		ModelCardID:       row.ModelCardID,
		RoundNumber:       row.RoundNumber,
		RequestedEpsilon:  row.RequestedEpsilon,
		EpsilonSpent:      row.EpsilonSpent,
		SampleCount:       row.SampleCount,
		LocalMetricWhPerM: row.LocalMetricWhPerM,
		ClippedUpdatePct:  row.ClippedUpdatePct,
		Status:            row.Status,
		StartedAt:         row.StartedAt.UTC(),
		CompletedAt:       row.CompletedAt,
	}
}

func (s *Service) ListCausalExperiments(
	ctx context.Context,
	subject string,
	vehicleID int64,
	limit, offset int,
) (*domain.Page[domain.CausalExperiment], error) {
	limit, offset = normalizePage(limit, offset)
	if subject = cleanToken(subject, 512); subject == "" || vehicleID <= 0 {
		return nil, fmt.Errorf("%w: subject and vehicle_id are required", ErrInvalidInput)
	}
	experiments, results, total, err := s.durable.ListExperiments(
		ctx, subject, vehicleID, limit, offset,
	)
	if err != nil {
		return nil, fmt.Errorf("list causal experiments: %w", err)
	}
	items := make([]domain.CausalExperiment, 0, len(experiments))
	for i := range experiments {
		items = append(items, causalFromRecords(experiments[i], results[i]))
	}
	return &domain.Page[domain.CausalExperiment]{
		Items: items, Total: total, Limit: limit, Offset: offset,
	}, nil
}

func (s *Service) CreateCausalExperiment(
	ctx context.Context,
	subject string,
	request domain.CreateCausalExperimentRequest,
) (*domain.CausalExperiment, error) {
	now := s.now().UTC()
	subject = cleanToken(subject, 512)
	if err := ValidateCausalExperiment(subject, request, now); err != nil {
		return nil, err
	}
	baseline, err := s.source.MetricWindow(
		ctx, request.VehicleID, request.Metric, request.BaselineStart, request.BaselineEnd,
	)
	if err != nil {
		return nil, fmt.Errorf("load causal baseline: %w", err)
	}
	treatment, err := s.source.MetricWindow(
		ctx, request.VehicleID, request.Metric, request.TreatmentStart, request.TreatmentEnd,
	)
	if err != nil {
		return nil, fmt.Errorf("load causal treatment: %w", err)
	}
	state, result := estimateCausalResult(request.Metric, baseline, treatment, now)
	experimentRecord := port.CausalExperimentRecord{
		Subject:          subject,
		VehicleID:        request.VehicleID,
		InterventionKind: request.InterventionKind,
		Metric:           string(request.Metric),
		BaselineStart:    request.BaselineStart.UTC(),
		BaselineEnd:      request.BaselineEnd.UTC(),
		TreatmentStart:   request.TreatmentStart.UTC(),
		TreatmentEnd:     request.TreatmentEnd.UTC(),
		State:            state,
		Version:          1,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	persistedExperiment, persistedResult, err := s.durable.CreateExperiment(
		ctx,
		port.CreateExperimentParams{
			Subject: subject, Experiment: experimentRecord, Result: result,
		},
	)
	if err != nil {
		return nil, fmt.Errorf("persist causal experiment: %w", err)
	}
	item := causalFromRecords(*persistedExperiment, *persistedResult)
	return &item, nil
}

func ValidateCausalExperiment(
	subject string,
	request domain.CreateCausalExperimentRequest,
	now time.Time,
) error {
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	allowedInterventions := map[string]bool{
		"charging_schedule":       true,
		"tire_service":            true,
		"software_update":         true,
		"climate_preconditioning": true,
		"driving_policy":          true,
	}
	if subject == "" || request.VehicleID <= 0 ||
		!allowedInterventions[request.InterventionKind] || !request.Metric.Valid() ||
		request.BaselineStart.IsZero() || request.BaselineEnd.IsZero() ||
		request.TreatmentStart.IsZero() || request.TreatmentEnd.IsZero() ||
		!request.BaselineStart.Before(request.BaselineEnd) ||
		!request.TreatmentStart.Before(request.TreatmentEnd) ||
		request.TreatmentStart.Before(request.BaselineEnd) ||
		request.TreatmentEnd.After(now.Add(time.Minute)) ||
		request.BaselineEnd.Sub(request.BaselineStart) < 24*time.Hour ||
		request.TreatmentEnd.Sub(request.TreatmentStart) < 24*time.Hour ||
		request.BaselineEnd.Sub(request.BaselineStart) > 365*24*time.Hour ||
		request.TreatmentEnd.Sub(request.TreatmentStart) > 365*24*time.Hour {
		return fmt.Errorf("%w: causal experiment fields or windows are invalid", ErrInvalidInput)
	}
	return nil
}

func estimateCausalResult(
	metric domain.CausalMetric,
	baseline, treatment *domain.MetricWindowEvidence,
	now time.Time,
) (string, port.CausalResultRecord) {
	result := port.CausalResultRecord{EstimatedAt: now.UTC()}
	if baseline == nil || treatment == nil {
		return "insufficient", result
	}
	result.BaselineSampleCount = baseline.SampleCount
	result.TreatmentSampleCount = treatment.SampleCount
	if baseline.ConfounderCoveragePct != nil && treatment.ConfounderCoveragePct != nil {
		coverage := math.Min(*baseline.ConfounderCoveragePct, *treatment.ConfounderCoveragePct)
		result.ConfounderCoveragePct = &coverage
	}
	if baseline.SampleCount < 5 || treatment.SampleCount < 5 ||
		baseline.MetricValue == nil || treatment.MetricValue == nil {
		return "insufficient", result
	}
	if result.ConfounderCoveragePct == nil || *result.ConfounderCoveragePct < 70 ||
		baseline.AmbientTempC == nil || treatment.AmbientTempC == nil ||
		math.Abs(*baseline.AmbientTempC-*treatment.AmbientTempC) > 10 {
		return "non_causal", result
	}
	effect := *treatment.MetricValue - *baseline.MetricValue
	switch metric {
	case domain.CausalDriveEnergyWhPerM:
		result.BaselineEnergyWhPerM = baseline.MetricValue
		result.TreatmentEnergyWhPerM = treatment.MetricValue
		result.EffectEnergyWhPerM = &effect
	case domain.CausalChargingSuccessPct:
		result.BaselineSuccessPct = baseline.MetricValue
		result.TreatmentSuccessPct = treatment.MetricValue
		result.EffectSuccessPct = &effect
	case domain.CausalAverageSpeedMps:
		result.BaselineSpeedMps = baseline.MetricValue
		result.TreatmentSpeedMps = treatment.MetricValue
		result.EffectSpeedMps = &effect
	}
	return "estimated", result
}

func causalFromRecords(
	experiment port.CausalExperimentRecord,
	result port.CausalResultRecord,
) domain.CausalExperiment {
	limitations := []string{
		"An estimated difference is observational and does not by itself prove causality.",
		"Confounder coverage measures recorded ambient-temperature coverage; driver and route confounders remain unobserved.",
	}
	if experiment.State == "insufficient" {
		limitations = append(limitations,
			"Effect fields are null because each window requires at least five metric samples.")
	}
	if experiment.State == "non_causal" {
		limitations = append(limitations,
			"Effect fields are null because confounder coverage or comparability is insufficient.")
	}
	status := domain.QualitySufficient
	reasons := []string{"both windows meet sample and ambient-temperature coverage requirements"}
	if experiment.State == "insufficient" {
		status = domain.QualityInsufficient
		reasons = []string{"one or both windows have fewer than five supported metric samples"}
	} else if experiment.State == "non_causal" {
		status = domain.QualityLimited
		reasons = []string{"confounder coverage or ambient-temperature comparability is insufficient"}
	}
	return domain.CausalExperiment{
		ID:                    experiment.ID,
		VehicleID:             experiment.VehicleID,
		InterventionKind:      experiment.InterventionKind,
		Metric:                domain.CausalMetric(experiment.Metric),
		BaselineStart:         experiment.BaselineStart.UTC(),
		BaselineEnd:           experiment.BaselineEnd.UTC(),
		TreatmentStart:        experiment.TreatmentStart.UTC(),
		TreatmentEnd:          experiment.TreatmentEnd.UTC(),
		State:                 experiment.State,
		Version:               experiment.Version,
		BaselineSampleCount:   result.BaselineSampleCount,
		TreatmentSampleCount:  result.TreatmentSampleCount,
		ConfounderCoveragePct: result.ConfounderCoveragePct,
		BaselineEnergyWhPerM:  result.BaselineEnergyWhPerM,
		TreatmentEnergyWhPerM: result.TreatmentEnergyWhPerM,
		EffectEnergyWhPerM:    result.EffectEnergyWhPerM,
		BaselineSuccessPct:    result.BaselineSuccessPct,
		TreatmentSuccessPct:   result.TreatmentSuccessPct,
		EffectSuccessPct:      result.EffectSuccessPct,
		BaselineSpeedMps:      result.BaselineSpeedMps,
		TreatmentSpeedMps:     result.TreatmentSpeedMps,
		EffectSpeedMps:        result.EffectSpeedMps,
		CreatedAt:             experiment.CreatedAt.UTC(),
		UpdatedAt:             experiment.UpdatedAt.UTC(),
		DataQuality: quality(
			status,
			result.BaselineSampleCount+result.TreatmentSampleCount,
			result.ConfounderCoveragePct,
			timePointer(experiment.BaselineStart),
			timePointer(experiment.TreatmentEnd),
			reasons...,
		),
		Evidence: []domain.Evidence{
			evidence(
				"drives_and_charging_sessions",
				timePointer(experiment.TreatmentEnd),
				intPointer(result.BaselineSampleCount+result.TreatmentSampleCount),
				"Typed aggregate metrics are compared across the declared non-overlapping windows.",
			),
		},
		Limitations: limitations,
	}
}

func (s *Service) TCOOptimizer(
	ctx context.Context,
	request domain.TCOOptimizerRequest,
) (*domain.TCOOptimizerResponse, error) {
	if err := ValidateTCORequest(request); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	source, err := s.source.TCO(
		ctx,
		request.VehicleID,
		strings.ToUpper(request.Currency),
		now.Add(-365*24*time.Hour),
		now,
	)
	if err != nil {
		return nil, fmt.Errorf("load tco evidence: %w", err)
	}
	response := BuildTCOOptimizer(request, source, now)
	return &response, nil
}

func ValidateTCORequest(request domain.TCOOptimizerRequest) error {
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	currency := strings.ToUpper(strings.TrimSpace(request.Currency))
	if request.VehicleID <= 0 ||
		request.HorizonS < int64(30*24*time.Hour/time.Second) ||
		request.HorizonS > int64(10*365*24*time.Hour/time.Second) ||
		request.AnnualDistanceM < 1000 || request.AnnualDistanceM > 1_000_000_000 ||
		request.HomeChargingPct < 0 || request.HomeChargingPct > 100 ||
		request.PublicChargingPct < 0 || request.PublicChargingPct > 100 ||
		math.Abs(request.HomeChargingPct+request.PublicChargingPct-100) > 0.001 ||
		request.RiskTolerancePct < 0 || request.RiskTolerancePct > 100 ||
		request.BudgetMinor < 0 ||
		len(currency) != 3 {
		return fmt.Errorf("%w: tco constraints are invalid", ErrInvalidInput)
	}
	for _, character := range currency {
		if character < 'A' || character > 'Z' {
			return fmt.Errorf("%w: currency must be an ISO-style three-letter code", ErrInvalidInput)
		}
	}
	return nil
}

// BuildTCOOptimizer returns constrained alternatives. Monetary projections
// remain null unless both charging channels and maintenance are supported.
func BuildTCOOptimizer(
	request domain.TCOOptimizerRequest,
	source *domain.TCOEvidence,
	now time.Time,
) domain.TCOOptimizerResponse {
	response := domain.TCOOptimizerResponse{
		VehicleID:   request.VehicleID,
		HorizonS:    request.HorizonS,
		Currency:    strings.ToUpper(request.Currency),
		Strategies:  []domain.TCOStrategy{},
		Evidence:    []domain.Evidence{},
		Limitations: []string{},
		GeneratedAt: now.UTC(),
	}
	mixes := []struct {
		name string
		home float64
	}{
		{name: "constrained_recorded_mix", home: request.HomeChargingPct},
		{name: "home_priority", home: math.Min(100, request.HomeChargingPct+20)},
		{name: "access_priority", home: math.Max(0, request.HomeChargingPct-20)},
	}
	reliabilityPct := 0.0
	hasReliability := source != nil && source.ChargingSampleCount >= 3
	if hasReliability {
		reliabilityPct = float64(source.ChargingSuccessCount) /
			float64(source.ChargingSampleCount) * 100
	}
	hasMoney := source != nil &&
		source.DistanceM != nil && *source.DistanceM > 0 &&
		source.HomeChargeSampleCount >= 2 && source.PublicChargeSampleCount >= 2 &&
		source.HomeEnergyWh != nil && *source.HomeEnergyWh > 0 &&
		source.PublicEnergyWh != nil && *source.PublicEnergyWh > 0 &&
		source.HomeCostMinor != nil && source.PublicCostMinor != nil &&
		source.MaintenanceCostMinor != nil
	var homeRateMinorPerWh, publicRateMinorPerWh, energyWhPerM, maintenanceMinorPerM float64
	if hasMoney {
		homeRateMinorPerWh = float64(*source.HomeCostMinor) / *source.HomeEnergyWh
		publicRateMinorPerWh = float64(*source.PublicCostMinor) / *source.PublicEnergyWh
		energyWhPerM = (*source.HomeEnergyWh + *source.PublicEnergyWh) / *source.DistanceM
		maintenanceMinorPerM = float64(*source.MaintenanceCostMinor) / *source.DistanceM
	}
	horizonYears := float64(request.HorizonS) / float64(365*24*time.Hour/time.Second)
	horizonDistanceM := request.AnnualDistanceM * horizonYears
	for _, mix := range mixes {
		publicPct := 100 - mix.home
		strategy := domain.TCOStrategy{
			Name:                mix.name,
			HomeChargingPct:     mix.home,
			PublicChargingPct:   publicPct,
			ConvenienceScorePct: clamp(40+mix.home*0.5, 0, 100),
			Constraints:         []string{},
		}
		if hasReliability {
			risk := clamp((100-reliabilityPct)*0.7+publicPct*0.15, 0, 100)
			strategy.RiskScorePct = &risk
		} else {
			strategy.Constraints = append(strategy.Constraints,
				"Risk score is null because charging outcome coverage is insufficient.")
		}
		if hasMoney {
			projectedEnergyWh := horizonDistanceM * energyWhPerM
			chargingMinor := projectedEnergyWh *
				(mix.home/100*homeRateMinorPerWh + publicPct/100*publicRateMinorPerWh)
			maintenanceMinor := horizonDistanceM * maintenanceMinorPerM
			projected := int64(math.Round(chargingMinor + maintenanceMinor))
			strategy.ProjectedCostMinor = &projected
			within := projected <= request.BudgetMinor
			strategy.WithinBudget = &within
			if !within {
				strategy.Constraints = append(strategy.Constraints,
					"Projected recorded-cost basis exceeds budget_minor.")
			}
		} else {
			strategy.Constraints = append(strategy.Constraints,
				"Projected cost is null until both charging channels and recorded maintenance costs have sufficient matching-currency evidence.")
		}
		if strategy.RiskScorePct != nil && *strategy.RiskScorePct > request.RiskTolerancePct {
			strategy.Constraints = append(strategy.Constraints,
				"Modeled risk score exceeds risk_tolerance_pct.")
		}
		response.Strategies = append(response.Strategies, strategy)
	}
	markPareto(response.Strategies)
	sort.SliceStable(response.Strategies, func(i, j int) bool {
		left, right := response.Strategies[i], response.Strategies[j]
		if left.ParetoEfficient != right.ParetoEfficient {
			return left.ParetoEfficient
		}
		if left.ProjectedCostMinor != nil && right.ProjectedCostMinor != nil &&
			*left.ProjectedCostMinor != *right.ProjectedCostMinor {
			return *left.ProjectedCostMinor < *right.ProjectedCostMinor
		}
		if left.RiskScorePct == nil {
			return false
		}
		if right.RiskScorePct == nil {
			return true
		}
		return *left.RiskScorePct < *right.RiskScorePct
	})
	status := domain.QualityInsufficient
	samples := 0
	if source != nil {
		samples = source.DriveSampleCount + source.ChargingSampleCount
		response.Evidence = append(response.Evidence,
			evidence("drives_and_charging_sessions", source.ObservedAt,
				intPointer(samples),
				"Recorded distance, energy, session costs, charger types, and outcomes form the operating-cost basis."),
			evidence("fleet_maintenance_work_orders", source.ObservedAt, nil,
				"Completed matching-currency work-order costs form the maintenance basis when available."),
		)
	}
	if hasMoney {
		status = domain.QualityLimited
	} else {
		response.Limitations = append(response.Limitations,
			"No monetary strategy ranking is fabricated from default tariffs or assumed maintenance prices.")
	}
	response.DataQuality = quality(status, samples, nil, nil, sourceObservedAt(source),
		"strategy adjustments are deterministic constrained alternatives over the recorded cost basis")
	response.Limitations = append(response.Limitations,
		"Depreciation, insurance, financing, taxes, and unrecorded fees are unsupported.",
		"Pareto flags compare only projected cost, risk score, and convenience score in this response.",
	)
	return response
}

func sourceObservedAt(source *domain.TCOEvidence) *time.Time {
	if source == nil {
		return nil
	}
	return source.ObservedAt
}

func markPareto(strategies []domain.TCOStrategy) {
	for i := range strategies {
		dominated := false
		for j := range strategies {
			if i == j {
				continue
			}
			if dominates(strategies[j], strategies[i]) {
				dominated = true
				break
			}
		}
		strategies[i].ParetoEfficient = !dominated
	}
}

func dominates(left, right domain.TCOStrategy) bool {
	if (left.ProjectedCostMinor == nil) != (right.ProjectedCostMinor == nil) {
		return false
	}
	if (left.RiskScorePct == nil) != (right.RiskScorePct == nil) {
		return false
	}
	costNoWorse := true
	costBetter := false
	if left.ProjectedCostMinor != nil {
		costNoWorse = *left.ProjectedCostMinor <= *right.ProjectedCostMinor
		costBetter = *left.ProjectedCostMinor < *right.ProjectedCostMinor
	}
	riskNoWorse := true
	riskBetter := false
	if left.RiskScorePct != nil {
		riskNoWorse = *left.RiskScorePct <= *right.RiskScorePct
		riskBetter = *left.RiskScorePct < *right.RiskScorePct
	}
	convenienceNoWorse := left.ConvenienceScorePct >= right.ConvenienceScorePct
	strictlyBetter := costBetter ||
		riskBetter ||
		left.ConvenienceScorePct > right.ConvenienceScorePct
	return costNoWorse && riskNoWorse && convenienceNoWorse && strictlyBetter
}
