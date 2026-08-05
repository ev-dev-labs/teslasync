package advancedintelligencesvc

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
)

func (s *Service) TwinLab(
	ctx context.Context,
	request domain.TwinLabRequest,
) (*domain.TwinLabResponse, error) {
	if err := ValidateTwinRequest(request); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	start := now.Add(-180 * 24 * time.Hour)
	calibration, err := s.source.Calibration(ctx, request.VehicleID, start, now)
	if err != nil {
		return nil, fmt.Errorf("load twin calibration: %w", err)
	}
	response := BuildTwinLab(calibration, request, now)
	return &response, nil
}

func ValidateTwinRequest(request domain.TwinLabRequest) error {
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	if request.VehicleID <= 0 || len(request.Scenarios) == 0 || len(request.Scenarios) > 12 {
		return fmt.Errorf("%w: vehicle_id and 1-12 scenarios are required", ErrInvalidInput)
	}
	names := make(map[string]struct{}, len(request.Scenarios))
	for _, scenario := range request.Scenarios {
		name := cleanToken(scenario.Name, 80)
		if name == "" {
			return fmt.Errorf("%w: scenario name is invalid", ErrInvalidInput)
		}
		if _, exists := names[name]; exists {
			return fmt.Errorf("%w: scenario names must be unique", ErrInvalidInput)
		}
		names[name] = struct{}{}
		if scenario.HorizonS < 60 || scenario.HorizonS > 5*365*24*60*60 ||
			scenario.DistanceM <= 0 || scenario.DistanceM > 2_000_000 ||
			scenario.SpeedMps <= 0 || scenario.SpeedMps > 70 ||
			scenario.AuxiliaryLoadW < 0 || scenario.AuxiliaryLoadW > 50_000 {
			return fmt.Errorf("%w: scenario values are outside allowed SI bounds", ErrInvalidInput)
		}
		if scenario.OutsideTempC != nil &&
			(*scenario.OutsideTempC < -80 || *scenario.OutsideTempC > 80) {
			return fmt.Errorf("%w: outside_temp_c is outside allowed bounds", ErrInvalidInput)
		}
	}
	return nil
}

// BuildTwinLab is pure and deterministic for a calibration, request, and clock.
func BuildTwinLab(
	calibration *domain.CalibrationEvidence,
	request domain.TwinLabRequest,
	now time.Time,
) domain.TwinLabResponse {
	response := domain.TwinLabResponse{
		VehicleID:   request.VehicleID,
		ModelName:   "calibrated_energy_counterfactual_v1",
		Scenarios:   make([]domain.TwinScenarioOutput, 0, len(request.Scenarios)),
		Evidence:    []domain.Evidence{},
		Limitations: []string{},
		GeneratedAt: now.UTC(),
	}
	if calibration == nil {
		response.DataQuality = quality(
			domain.QualityInsufficient, 0, nil, nil, nil,
			"no persisted calibration evidence was available",
		)
		for _, scenario := range request.Scenarios {
			response.Scenarios = append(response.Scenarios, domain.TwinScenarioOutput{
				Name: scenario.Name, HorizonS: scenario.HorizonS,
				SensitivityDrivers: []domain.SensitivityDriver{},
			})
		}
		response.Limitations = append(response.Limitations,
			"Counterfactual outputs are null until persisted drive evidence can calibrate the model.")
		return response
	}

	response.Baseline = domain.TwinBaseline{
		EfficiencyWhPerM:       calibration.EfficiencyWhPerM,
		UsableBatteryWh:        calibration.UsableBatteryWh,
		AmbientTempC:           calibration.AmbientTempC,
		CalibrationSampleCount: calibration.DriveSampleCount,
	}
	response.Evidence = append(response.Evidence,
		evidence(
			"drives",
			calibration.LastObservedAt,
			intPointer(calibration.DriveSampleCount),
			"Completed drive aggregates calibrate energy per distance and observed variance.",
		),
		evidence(
			"charging_sessions",
			calibration.LastObservedAt,
			intPointer(calibration.ChargeSampleCount),
			"Completed sessions with a material SoC change calibrate usable battery energy.",
		),
	)

	if calibration.DriveSampleCount < 5 || calibration.EfficiencyWhPerM == nil ||
		*calibration.EfficiencyWhPerM <= 0 {
		response.DataQuality = quality(
			domain.QualityInsufficient,
			calibration.DriveSampleCount,
			nil,
			calibration.FirstObservedAt,
			calibration.LastObservedAt,
			"at least five valid completed drives are required",
		)
		for _, scenario := range request.Scenarios {
			response.Scenarios = append(response.Scenarios, domain.TwinScenarioOutput{
				Name: scenario.Name, HorizonS: scenario.HorizonS,
				SensitivityDrivers: []domain.SensitivityDriver{},
			})
		}
		response.Limitations = append(response.Limitations,
			"No fleet or nominal vehicle defaults replace missing per-vehicle evidence.")
		return response
	}

	status := domain.QualitySufficient
	reasons := []string{}
	var coefficientOfVariation *float64
	if calibration.EfficiencyStddevWhPerM != nil &&
		*calibration.EfficiencyStddevWhPerM >= 0 {
		cv := *calibration.EfficiencyStddevWhPerM / *calibration.EfficiencyWhPerM
		cv = clamp(cv, 0, 1)
		coefficientOfVariation = &cv
	} else {
		status = domain.QualityLimited
		reasons = append(reasons, "observed efficiency variance is unavailable; uncertainty bands are null")
	}
	if calibration.UsableBatteryWh == nil || *calibration.UsableBatteryWh <= 0 {
		status = domain.QualityLimited
		reasons = append(reasons, "usable battery calibration is unavailable; range and wear projections are null")
	}
	response.DataQuality = quality(
		status,
		calibration.DriveSampleCount,
		nil,
		calibration.FirstObservedAt,
		calibration.LastObservedAt,
		reasons...,
	)

	for _, scenario := range request.Scenarios {
		response.Scenarios = append(
			response.Scenarios,
			buildTwinScenario(calibration, scenario, coefficientOfVariation),
		)
	}
	response.Limitations = append(response.Limitations,
		"Weather, speed, and auxiliary-load responses are transparent first-order counterfactual assumptions, not a physical battery controller.",
		"Results do not execute commands and do not predict component failure.",
	)
	return response
}

func buildTwinScenario(
	calibration *domain.CalibrationEvidence,
	scenario domain.TwinScenarioInput,
	coefficientOfVariation *float64,
) domain.TwinScenarioOutput {
	baseEfficiency := *calibration.EfficiencyWhPerM
	speedPenalty := math.Max(0, scenario.SpeedMps-22) / 22 * 0.15
	tempPenalty := 0.0
	outsideTempC := calibration.AmbientTempC
	if scenario.OutsideTempC != nil {
		outsideTempC = scenario.OutsideTempC
		tempPenalty = math.Abs(*scenario.OutsideTempC-20) * 0.006
	}
	auxiliaryEnergyWh := scenario.AuxiliaryLoadW * float64(scenario.HorizonS) / 3600
	baseEnergyWh := scenario.DistanceM * baseEfficiency
	scenarioEfficiency := baseEfficiency * (1 + speedPenalty + tempPenalty)
	scenarioEnergyWh := scenario.DistanceM*scenarioEfficiency + auxiliaryEnergyWh
	batteryDeltaWh := scenarioEnergyWh - baseEnergyWh

	output := domain.TwinScenarioOutput{
		Name:           scenario.Name,
		HorizonS:       scenario.HorizonS,
		BatteryDeltaWh: pointer(batteryDeltaWh),
		SensitivityDrivers: sensitivityDrivers(
			speedPenalty,
			tempPenalty,
			auxiliaryEnergyWh/math.Max(scenarioEnergyWh, 1),
		),
	}
	if coefficientOfVariation != nil {
		uncertaintyWh := math.Abs(scenarioEnergyWh * *coefficientOfVariation)
		output.BatteryLowWh = pointer(batteryDeltaWh - uncertaintyWh)
		output.BatteryHighWh = pointer(batteryDeltaWh + uncertaintyWh)
	}

	thermalDeltaC := scenario.AuxiliaryLoadW / 10_000
	if outsideTempC != nil && calibration.AmbientTempC != nil {
		thermalDeltaC += (*outsideTempC - *calibration.AmbientTempC) * 0.1
		output.ThermalDeltaC = pointer(thermalDeltaC)
		if coefficientOfVariation != nil {
			uncertaintyC := math.Abs(thermalDeltaC * *coefficientOfVariation)
			output.ThermalLowC = pointer(thermalDeltaC - uncertaintyC)
			output.ThermalHighC = pointer(thermalDeltaC + uncertaintyC)
		}
	}

	if calibration.UsableBatteryWh != nil && *calibration.UsableBatteryWh > 0 {
		baseRangeM := *calibration.UsableBatteryWh / baseEfficiency
		scenarioRangeM := *calibration.UsableBatteryWh /
			math.Max(scenarioEnergyWh/scenario.DistanceM, 0.000001)
		rangeDeltaM := scenarioRangeM - baseRangeM
		output.RangeDeltaM = pointer(rangeDeltaM)
		wearDeltaPct := math.Max(0, batteryDeltaWh) / *calibration.UsableBatteryWh * 100
		output.WearDeltaPct = pointer(wearDeltaPct)
		if coefficientOfVariation != nil {
			rangeUncertaintyM := math.Abs(rangeDeltaM * *coefficientOfVariation)
			output.RangeLowM = pointer(rangeDeltaM - rangeUncertaintyM)
			output.RangeHighM = pointer(rangeDeltaM + rangeUncertaintyM)
			wearUncertaintyPct := math.Abs(wearDeltaPct * *coefficientOfVariation)
			output.WearLowPct = pointer(math.Max(0, wearDeltaPct-wearUncertaintyPct))
			output.WearHighPct = pointer(wearDeltaPct + wearUncertaintyPct)
		}
	}
	return output
}

func sensitivityDrivers(speed, temperature, auxiliary float64) []domain.SensitivityDriver {
	total := speed + temperature + auxiliary
	if total <= 0 {
		return []domain.SensitivityDriver{}
	}
	items := []domain.SensitivityDriver{
		{Driver: "speed_mps", EffectPct: speed / total * 100},
		{Driver: "outside_temp_c", EffectPct: temperature / total * 100},
		{Driver: "auxiliary_load_w", EffectPct: auxiliary / total * 100},
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].EffectPct > items[j].EffectPct })
	return items
}

func (s *Service) FirmwareCanary(
	ctx context.Context,
	vehicleID int64,
	limit, offset int,
) (*domain.Page[domain.FirmwareCanary], error) {
	limit, offset = normalizePage(limit, offset)
	now := s.now().UTC()
	window, err := s.source.FirmwareWindow(ctx, vehicleID, now)
	if err != nil {
		return nil, fmt.Errorf("load firmware canary evidence: %w", err)
	}
	items := []domain.FirmwareCanary{}
	if window != nil {
		items = append(items, BuildFirmwareCanary(window, now))
	}
	pageItems, total := pageSlice(items, limit, offset)
	return &domain.Page[domain.FirmwareCanary]{
		Items: pageItems, Total: total, Limit: limit, Offset: offset,
	}, nil
}

// BuildFirmwareCanary produces the same decision for the same matched windows.
func BuildFirmwareCanary(
	window *domain.FirmwareWindowEvidence,
	now time.Time,
) domain.FirmwareCanary {
	item := domain.FirmwareCanary{
		Decision:    domain.CanaryInsufficient,
		Evidence:    []domain.Evidence{},
		Limitations: []string{},
		GeneratedAt: now.UTC(),
	}
	if window == nil {
		item.WindowQuality = quality(
			domain.QualityInsufficient, 0, nil, nil, nil,
			"no firmware installation evidence was recorded",
		)
		return item
	}
	item.VehicleID = window.VehicleID
	item.Version = window.Version
	item.Evidence = append(item.Evidence,
		evidence(
			"software_updates",
			window.InstalledAt,
			nil,
			"The installation timestamp anchors non-overlapping pre/post windows.",
		),
		evidence(
			"drives",
			window.PostEnd,
			intPointer(window.PreDriveSampleCount+window.PostDriveSampleCount),
			"Completed-drive energy per distance is compared within the target vehicle.",
		),
	)
	if window.Version == nil || window.InstalledAt == nil ||
		window.PreEfficiencyWhPerM == nil || window.PostEfficiencyWhPerM == nil ||
		window.PreDriveSampleCount < 5 || window.PostDriveSampleCount < 5 ||
		*window.PreEfficiencyWhPerM <= 0 {
		item.WindowQuality = quality(
			domain.QualityInsufficient,
			window.PreDriveSampleCount+window.PostDriveSampleCount,
			nil,
			window.PreStart,
			window.PostEnd,
			"at least five valid target drives are required in each window",
		)
		item.Limitations = append(item.Limitations,
			"No rollout finding is inferred from an incomplete target window.")
		return item
	}

	vehicleRegression := (*window.PostEfficiencyWhPerM / *window.PreEfficiencyWhPerM - 1) * 100
	item.VehicleRegressionPct = pointer(vehicleRegression)
	hasPeers := window.PeerPreSampleCount >= 10 && window.PeerPostSampleCount >= 10 &&
		window.PeerPreEfficiencyWhPerM != nil && window.PeerPostEfficiencyWhPerM != nil &&
		*window.PeerPreEfficiencyWhPerM > 0
	if hasPeers {
		peerRegression := (*window.PeerPostEfficiencyWhPerM / *window.PeerPreEfficiencyWhPerM - 1) * 100
		excess := vehicleRegression - peerRegression
		item.PeerRegressionPct = pointer(peerRegression)
		item.MatchedExcessPct = pointer(excess)
		item.Evidence = append(item.Evidence,
			evidence(
				"drives_matched_model_cohort",
				window.PostEnd,
				intPointer(window.PeerPreSampleCount+window.PeerPostSampleCount),
				"Same-model peer windows provide a contemporaneous comparison.",
			),
		)
		item.WindowQuality = quality(
			domain.QualitySufficient,
			window.PreDriveSampleCount+window.PostDriveSampleCount+
				window.PeerPreSampleCount+window.PeerPostSampleCount,
			pointer(100),
			window.PreStart,
			window.PostEnd,
		)
		switch {
		case excess > 10:
			item.Decision = domain.CanaryHold
		case excess > 5:
			item.Decision = domain.CanaryInvestigate
		case excess <= 3:
			item.Decision = domain.CanaryRollout
		default:
			item.Decision = domain.CanaryInvestigate
		}
	} else {
		item.WindowQuality = quality(
			domain.QualityLimited,
			window.PreDriveSampleCount+window.PostDriveSampleCount,
			nil,
			window.PreStart,
			window.PostEnd,
			"matched peer coverage is below ten drives per window",
		)
		if vehicleRegression > 5 {
			item.Decision = domain.CanaryInvestigate
		} else {
			item.Decision = domain.CanaryInsufficient
		}
		item.Limitations = append(item.Limitations,
			"A target-only before/after change cannot support rollout or hold without a contemporaneous matched cohort.")
	}
	item.Limitations = append(item.Limitations,
		"Observed association is not proof that firmware caused the efficiency change.",
		"Matching uses persisted vehicle model and time windows; route and driver matching are unavailable.",
	)
	return item
}
