package advancedintelligencesvc

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func (s *Service) JourneyAssurance(
	ctx context.Context,
	request domain.JourneyAssuranceRequest,
) (*domain.JourneyAssuranceResponse, error) {
	now := s.now().UTC()
	if err := ValidateJourneyRequest(request, now); err != nil {
		return nil, err
	}
	calibration, err := s.source.Calibration(
		ctx, request.VehicleID, now.Add(-180*24*time.Hour), now,
	)
	if err != nil {
		return nil, fmt.Errorf("load journey calibration: %w", err)
	}
	readiness, err := s.source.Readiness(
		ctx, request.VehicleID, now.Add(-90*24*time.Hour), now,
	)
	if err != nil {
		return nil, fmt.Errorf("load journey readiness evidence: %w", err)
	}
	current, err := s.state.State(ctx, request.VehicleID, now)
	if err != nil {
		return nil, fmt.Errorf("load journey current state: %w", err)
	}
	response := BuildJourneyAssurance(request, calibration, readiness, current, now)
	return &response, nil
}

func ValidateJourneyRequest(request domain.JourneyAssuranceRequest, now time.Time) error {
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	if request.VehicleID <= 0 ||
		request.RouteDistanceM < 100 || request.RouteDistanceM > 5_000_000 ||
		request.ReserveTargetPct < 0 || request.ReserveTargetPct > 80 ||
		request.DepartureAt.Before(now.Add(-5*time.Minute)) ||
		request.DepartureAt.After(now.Add(365*24*time.Hour)) {
		return fmt.Errorf("%w: journey values are outside allowed bounds", ErrInvalidInput)
	}
	if request.OutsideTempC != nil &&
		(*request.OutsideTempC < -80 || *request.OutsideTempC > 80) {
		return fmt.Errorf("%w: outside_temp_c is outside allowed bounds", ErrInvalidInput)
	}
	if request.AverageSpeedMps != nil &&
		(*request.AverageSpeedMps <= 0 || *request.AverageSpeedMps > 70) {
		return fmt.Errorf("%w: average_speed_mps is outside allowed bounds", ErrInvalidInput)
	}
	if request.AuxiliaryLoadW != nil &&
		(*request.AuxiliaryLoadW < 0 || *request.AuxiliaryLoadW > 50_000) {
		return fmt.Errorf("%w: auxiliary_load_w is outside allowed bounds", ErrInvalidInput)
	}
	if request.AuxiliaryLoadW != nil && *request.AuxiliaryLoadW > 0 &&
		request.AverageSpeedMps == nil {
		return fmt.Errorf("%w: average_speed_mps is required with auxiliary_load_w", ErrInvalidInput)
	}
	return nil
}

// BuildJourneyAssurance combines only supported factors. Unsupported factors
// remain visible with null scores and do not silently receive a passing score.
func BuildJourneyAssurance(
	request domain.JourneyAssuranceRequest,
	calibration *domain.CalibrationEvidence,
	readiness *domain.ReadinessEvidence,
	current signal.State,
	now time.Time,
) domain.JourneyAssuranceResponse {
	response := domain.JourneyAssuranceResponse{
		VehicleID: request.VehicleID,
		Factors:   []domain.ReadinessFactor{},
		Evidence:  []domain.Evidence{},
		Limitations: []string{
			"Arrival estimates do not include an authoritative route elevation, traffic, or charging-stop plan.",
			"Manufacturer communications are not treated as recalls; recall readiness remains unsupported without a vehicle-matched recall source.",
			"This endpoint provides readiness advice and never executes vehicle or charging commands.",
		},
		GeneratedAt: now.UTC(),
	}

	var energyScore *float64
	if calibration != nil && calibration.DriveSampleCount >= 5 &&
		calibration.EfficiencyWhPerM != nil && *calibration.EfficiencyWhPerM > 0 {
		efficiency := *calibration.EfficiencyWhPerM
		if request.OutsideTempC != nil {
			efficiency *= 1 + math.Abs(*request.OutsideTempC-20)*0.006
		}
		if request.AverageSpeedMps != nil && *request.AverageSpeedMps > 22 {
			efficiency *= 1 + (*request.AverageSpeedMps-22)/22*0.15
		}
		requiredWh := request.RouteDistanceM * efficiency
		if request.AuxiliaryLoadW != nil && request.AverageSpeedMps != nil {
			durationS := request.RouteDistanceM / *request.AverageSpeedMps
			requiredWh += *request.AuxiliaryLoadW * durationS / 3600
		}
		response.EnergyRequiredWh = pointer(requiredWh)
		batteryPct, hasBatteryPct := signal.Float64(current["BatteryLevel"])
		if hasBatteryPct && calibration.UsableBatteryWh != nil &&
			*calibration.UsableBatteryWh > 0 {
			arrivalPct := batteryPct - requiredWh / *calibration.UsableBatteryWh * 100
			uncertaintyPct := 0.0
			if calibration.EfficiencyStddevWhPerM != nil {
				uncertaintyPct = request.RouteDistanceM *
					*calibration.EfficiencyStddevWhPerM /
					*calibration.UsableBatteryWh * 100
			}
			low := clamp(arrivalPct-uncertaintyPct, 0, 100)
			high := clamp(arrivalPct+uncertaintyPct, 0, 100)
			response.ArrivalSocLowPct = &low
			response.ArrivalSocHighPct = &high
			score := clamp(50+(low-request.ReserveTargetPct)*4, 0, 100)
			energyScore = &score
		}
		response.Evidence = append(response.Evidence,
			evidence("drives", calibration.LastObservedAt,
				intPointer(calibration.DriveSampleCount),
				"Per-vehicle completed drives calibrate route energy."),
			evidence("signal_state_reader", timePointer(now), nil,
				"Current battery state is forward-folded through the canonical state reader."),
		)
	}
	energyStatus := "unsupported"
	energyExplanation := "Calibration, current SoC, or usable battery evidence is insufficient."
	if energyScore != nil {
		energyStatus = "supported"
		energyExplanation = "Arrival reserve is compared with the requested reserve target."
	}
	response.Factors = append(response.Factors, domain.ReadinessFactor{
		Factor: "energy_sufficiency", Status: energyStatus,
		ScorePct: energyScore, Explanation: energyExplanation,
	})

	var chargingScore *float64
	if readiness != nil && readiness.ChargingSampleCount >= 3 {
		value := float64(readiness.ChargingSuccessCount) /
			float64(readiness.ChargingSampleCount) * 100
		chargingScore = &value
		response.Evidence = append(response.Evidence,
			evidence("charging_sessions", readiness.ChargingLatestAt,
				intPointer(readiness.ChargingSampleCount),
				"Recent completed-session outcomes support charging reliability."),
		)
	}
	response.Factors = append(response.Factors, domain.ReadinessFactor{
		Factor:   "charging_reliability",
		Status:   supportedStatus(chargingScore),
		ScorePct: chargingScore,
		Explanation: nullableExplanation(
			chargingScore,
			"Recent charging-session completion rate is included.",
			"At least three charging sessions are required.",
		),
	})

	var maintenanceScore *float64
	if readiness != nil && readiness.MaintenanceSampleCount > 0 {
		value := 100.0
		if readiness.CriticalMaintenanceCount > 0 {
			value = 20
		} else if readiness.ActiveMaintenanceCount > 0 {
			value = 60
		}
		maintenanceScore = &value
		response.Evidence = append(response.Evidence,
			evidence("fleet_maintenance_work_orders", readiness.MaintenanceLatestAt,
				intPointer(readiness.MaintenanceSampleCount),
				"Only active recorded work orders affect maintenance readiness."),
		)
	}
	response.Factors = append(response.Factors, domain.ReadinessFactor{
		Factor:   "maintenance",
		Status:   supportedStatus(maintenanceScore),
		ScorePct: maintenanceScore,
		Explanation: nullableExplanation(
			maintenanceScore,
			"Active work-order severity is included.",
			"Maintenance evidence is unavailable.",
		),
	})

	var tireScore *float64
	tireSeen := false
	tireWarning := false
	for _, key := range []string{
		"TpmsHardWarningsFrontLeft",
		"TpmsHardWarningsFrontRight",
		"TpmsHardWarningsRearLeft",
		"TpmsHardWarningsRearRight",
		"TpmsSoftWarningsFrontLeft",
		"TpmsSoftWarningsFrontRight",
		"TpmsSoftWarningsRearLeft",
		"TpmsSoftWarningsRearRight",
	} {
		value, ok := current[key]
		if !ok {
			continue
		}
		tireSeen = true
		if active, valid := value.(bool); valid && active {
			tireWarning = true
		}
	}
	if tireSeen {
		value := 100.0
		if tireWarning {
			value = 20
		}
		tireScore = &value
	}
	response.Factors = append(response.Factors, domain.ReadinessFactor{
		Factor:   "tire_evidence",
		Status:   supportedStatus(tireScore),
		ScorePct: tireScore,
		Explanation: nullableExplanation(
			tireScore,
			"Current TPMS warning state is included.",
			"No current TPMS warning evidence is available.",
		),
	})

	var telemetryScore *float64
	if readiness != nil && readiness.LatestTelemetryAt != nil {
		age := now.Sub(*readiness.LatestTelemetryAt)
		value := 20.0
		if age <= 10*time.Minute {
			value = 100
		} else if age <= 2*time.Hour {
			value = 60
		}
		telemetryScore = &value
	}
	response.Factors = append(response.Factors, domain.ReadinessFactor{
		Factor:   "telemetry_freshness",
		Status:   supportedStatus(telemetryScore),
		ScorePct: telemetryScore,
		Explanation: nullableExplanation(
			telemetryScore,
			"Latest durable change-feed timestamp is included.",
			"No telemetry timestamp is available.",
		),
	})
	response.Factors = append(response.Factors, domain.ReadinessFactor{
		Factor:      "recall_evidence",
		Status:      "unsupported",
		ScorePct:    nil,
		Explanation: "No authoritative vehicle-matched recall record is available; no passing score is substituted.",
	})

	scores := []*float64{energyScore, chargingScore, maintenanceScore, tireScore, telemetryScore}
	sum := 0.0
	count := 0
	for _, score := range scores {
		if score != nil {
			sum += *score
			count++
		}
	}
	if count >= 3 && energyScore != nil {
		value := sum / float64(count)
		response.ReadinessScorePct = &value
	}
	status := domain.QualityLimited
	reasons := []string{"unsupported factors are visible and excluded from the readiness mean"}
	if response.ReadinessScorePct == nil {
		status = domain.QualityInsufficient
		reasons = []string{"energy evidence and at least two additional supported factors are required"}
	}
	samples := 0
	if calibration != nil {
		samples += calibration.DriveSampleCount
	}
	if readiness != nil {
		samples += readiness.ChargingSampleCount
	}
	response.DataQuality = quality(status, samples, nil, nil, timePointer(now), reasons...)
	return response
}

func supportedStatus(value *float64) string {
	if value == nil {
		return "unsupported"
	}
	return "supported"
}

func nullableExplanation(value *float64, supported, unsupported string) string {
	if value == nil {
		return unsupported
	}
	return supported
}

func (s *Service) ChargingSiteTwin(
	_ context.Context,
	request domain.ChargingSiteTwinRequest,
) (*domain.ChargingSiteTwinResponse, error) {
	if err := ValidateChargingSiteRequest(request); err != nil {
		return nil, err
	}
	response := BuildChargingSiteTwin(request, s.now().UTC())
	return &response, nil
}

func ValidateChargingSiteRequest(request domain.ChargingSiteTwinRequest) error {
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	if request.VehicleID <= 0 || request.ChargerCount < 1 || request.ChargerCount > 1000 ||
		request.ChargerPowerW < 500 || request.ChargerPowerW > 2_000_000 ||
		request.PanelLimitW < 500 || request.PanelLimitW > 1_000_000_000 ||
		request.ArrivalRatePerS <= 0 || request.ArrivalRatePerS > 1 ||
		request.MeanServiceS < 60 || request.MeanServiceS > 7*24*60*60 ||
		request.FleetGrowthPct < -90 || request.FleetGrowthPct > 1000 {
		return fmt.Errorf("%w: charging-site values are outside allowed SI bounds", ErrInvalidInput)
	}
	if request.ArrivalDistribution != "poisson" && request.ArrivalDistribution != "fixed" {
		return fmt.Errorf("%w: arrival_distribution must be poisson or fixed", ErrInvalidInput)
	}
	if request.ServiceDistribution != "exponential" && request.ServiceDistribution != "deterministic" {
		return fmt.Errorf("%w: service_distribution must be exponential or deterministic", ErrInvalidInput)
	}
	if request.SolarPowerW != nil && (*request.SolarPowerW < 0 || *request.SolarPowerW > 1_000_000_000) {
		return fmt.Errorf("%w: solar_power_w is outside allowed bounds", ErrInvalidInput)
	}
	if request.StorageEnergyWh != nil &&
		(*request.StorageEnergyWh < 0 || *request.StorageEnergyWh > 10_000_000_000) {
		return fmt.Errorf("%w: storage_energy_wh is outside allowed bounds", ErrInvalidInput)
	}
	return nil
}

// BuildChargingSiteTwin applies a documented M/M/c or adjusted M/D/c queue
// approximation. It is deterministic and does not claim operational control.
func BuildChargingSiteTwin(
	request domain.ChargingSiteTwinRequest,
	now time.Time,
) domain.ChargingSiteTwinResponse {
	arrivalRate := request.ArrivalRatePerS * (1 + request.FleetGrowthPct/100)
	netPanelW := request.PanelLimitW
	if request.SolarPowerW != nil {
		netPanelW += *request.SolarPowerW
	}
	powerBoundCount := int(math.Floor(netPanelW / request.ChargerPowerW))
	serverCount := request.ChargerCount
	if powerBoundCount < serverCount {
		serverCount = powerBoundCount
	}
	if serverCount < 1 {
		serverCount = 1
	}
	offeredLoad := arrivalRate * request.MeanServiceS
	utilization := offeredLoad / float64(serverCount)
	peakDemandW := float64(request.ChargerCount) * request.ChargerPowerW
	if request.SolarPowerW != nil {
		peakDemandW = math.Max(0, peakDemandW-*request.SolarPowerW)
	}
	constraintPct := math.Max(0, peakDemandW-request.PanelLimitW) /
		request.PanelLimitW * 100
	response := domain.ChargingSiteTwinResponse{
		VehicleID:          request.VehicleID,
		UtilizationPct:     utilization * 100,
		PeakDemandW:        peakDemandW,
		PanelConstraintPct: constraintPct,
		ProjectedUnstable:  utilization >= 1,
		Mitigations:        []domain.RankedMitigation{},
		Assumptions: []string{
			"Arrival and service distributions are stationary over the modeled horizon.",
			"Each active vehicle occupies one charger for mean_service_s.",
			"Panel-constrained concurrent charger count is floor((panel_limit_w + solar_power_w) / charger_power_w).",
		},
		DataQuality: quality(
			domain.QualityLimited,
			0,
			pointer(100),
			nil,
			timePointer(now),
			"projections are scenario-model outputs rather than observed site measurements",
		),
		Evidence: []domain.Evidence{
			evidence(
				"confirmed_site_scenario",
				timePointer(now),
				nil,
				"All queue and power projections derive from the validated scenario inputs.",
			),
		},
		Limitations: []string{
			"Storage energy is reported as an available mitigation but no discharge power is assumed from energy capacity alone.",
			"Queue projections do not include charger faults, reservation priority, or time-varying tariffs.",
			"The simulation never controls site equipment.",
		},
		GeneratedAt: now.UTC(),
	}
	if utilization < 1 {
		pWait := erlangC(offeredLoad, serverCount)
		meanWaitS := pWait / (float64(serverCount)/request.MeanServiceS - arrivalRate)
		if request.ServiceDistribution == "deterministic" {
			meanWaitS *= 0.5
		}
		if request.ArrivalDistribution == "fixed" {
			meanWaitS *= 0.5
		}
		p50 := int64(math.Ceil(meanWaitS * math.Log(2)))
		p90 := int64(math.Ceil(meanWaitS * math.Log(10)))
		response.QueueWaitP50S = &p50
		response.QueueWaitP90S = &p90
	}
	addChargerQueueDelta := -100 / float64(request.ChargerCount+1)
	demandShiftDelta := -math.Min(30, utilization*20)
	response.Mitigations = append(response.Mitigations,
		domain.RankedMitigation{
			Mitigation: "shape_arrivals", QueueDeltaPct: demandShiftDelta,
			PeakDeltaW: 0,
			Assumption: "A confirmed schedule reduces coincident arrivals by 20 percent.",
		},
		domain.RankedMitigation{
			Mitigation: "add_panel_backed_charger", QueueDeltaPct: addChargerQueueDelta,
			PeakDeltaW: request.ChargerPowerW,
			Assumption: "One charger and matching panel capacity are added.",
		},
	)
	if request.StorageEnergyWh != nil && *request.StorageEnergyWh > 0 {
		response.Mitigations = append(response.Mitigations, domain.RankedMitigation{
			Mitigation: "evaluate_storage_dispatch", QueueDeltaPct: 0, PeakDeltaW: 0,
			Assumption: "A power-rated storage design is required before peak reduction can be quantified.",
		})
	}
	sort.SliceStable(response.Mitigations, func(i, j int) bool {
		return response.Mitigations[i].QueueDeltaPct < response.Mitigations[j].QueueDeltaPct
	})
	for i := range response.Mitigations {
		response.Mitigations[i].Rank = i + 1
	}
	return response
}

func erlangC(offeredLoad float64, serverCount int) float64 {
	if offeredLoad <= 0 {
		return 0
	}
	if serverCount <= 0 || offeredLoad >= float64(serverCount) {
		return 1
	}
	sum := 0.0
	term := 1.0
	for n := 0; n < serverCount; n++ {
		if n > 0 {
			term *= offeredLoad / float64(n)
		}
		sum += term
	}
	last := term * offeredLoad / float64(serverCount)
	tail := last / (1 - offeredLoad/float64(serverCount))
	return tail / (sum + tail)
}

func (s *Service) ResiliencePlan(
	ctx context.Context,
	request domain.ResiliencePlanRequest,
) (*domain.ResiliencePlanResponse, error) {
	if err := ValidateResilienceRequest(request); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	current, err := s.state.State(ctx, request.VehicleID, now)
	if err != nil {
		return nil, fmt.Errorf("load resilience current state: %w", err)
	}
	response := BuildResiliencePlan(request, current, now)
	return &response, nil
}

func ValidateResilienceRequest(request domain.ResiliencePlanRequest) error {
	if !request.Confirmed {
		return ErrNotConfirmed
	}
	if request.VehicleID <= 0 ||
		request.VehicleEnergyWh < 0 || request.VehicleEnergyWh > 2_000_000 ||
		request.StationaryStorageWh < 0 || request.StationaryStorageWh > 100_000_000 ||
		request.ExpectedSolarWh < 0 || request.ExpectedSolarWh > 100_000_000 ||
		request.EssentialLoadW <= 0 || request.EssentialLoadW > 10_000_000 ||
		request.OutageDurationS < 60 || request.OutageDurationS > 365*24*60*60 ||
		request.EvacuationReserveWh < 0 ||
		request.EvacuationReserveWh > request.VehicleEnergyWh ||
		request.RestorationUncertaintyPct < 0 || request.RestorationUncertaintyPct > 200 {
		return fmt.Errorf("%w: resilience values are outside allowed SI bounds", ErrInvalidInput)
	}
	return nil
}

// BuildResiliencePlan treats the vehicle reserve as unavailable to household
// loads and produces advice only.
func BuildResiliencePlan(
	request domain.ResiliencePlanRequest,
	current signal.State,
	now time.Time,
) domain.ResiliencePlanResponse {
	usableVehicleWh := math.Max(0, request.VehicleEnergyWh-request.EvacuationReserveWh)
	totalWh := usableVehicleWh + request.StationaryStorageWh + request.ExpectedSolarWh
	survivalS := int64(totalWh / request.EssentialLoadW * 3600)
	times := []int64{0, request.OutageDurationS / 2, request.OutageDurationS}
	timeline := make([]domain.ResilienceTimelinePoint, 0, len(times))
	for _, elapsedS := range times {
		remainingWh := math.Max(0, totalWh-request.EssentialLoadW*float64(elapsedS)/3600)
		risk := "low"
		if remainingWh <= totalWh*0.2 {
			risk = "critical"
		} else if remainingWh <= totalWh*0.5 {
			risk = "elevated"
		}
		timeline = append(timeline, domain.ResilienceTimelinePoint{
			TimeS: elapsedS, RemainingEnergyWh: remainingWh, Risk: risk,
		})
	}
	evidenceItems := []domain.Evidence{
		evidence("confirmed_scenario_input", timePointer(now), nil,
			"Energy, load, reserve, solar, and outage values are supplied by the confirmed scenario."),
	}
	limitations := []string{
		"Expected solar energy is treated as available over the outage; weather timing and inverter constraints are not modeled.",
		"Vehicle-to-home capability, transfer-switch limits, and storage discharge power must be verified by qualified installers.",
		"This plan never executes vehicle, charging, or energy commands.",
	}
	if batteryPct, ok := signal.Float64(current["BatteryLevel"]); ok {
		evidenceItems = append(evidenceItems,
			evidence("signal_state_reader", timePointer(now), nil,
				fmt.Sprintf("Current vehicle SoC evidence is %.1f percent; the confirmed energy input remains authoritative.", batteryPct)),
		)
	} else {
		limitations = append(limitations,
			"Current vehicle SoC evidence is unavailable; vehicle_energy_wh is not independently verified.")
	}
	recommendations := []string{
		"Preserve evacuation_reserve_wh and do not allocate it to essential loads.",
		"Prioritize life-safety, communications, refrigeration, and medical loads.",
		"Have a qualified electrician verify isolation and transfer equipment before an outage.",
	}
	uncertainOutageS := float64(request.OutageDurationS) *
		(1 + request.RestorationUncertaintyPct/100)
	if float64(survivalS) < uncertainOutageS {
		recommendations = append(recommendations,
			"Reduce nonessential load because the uncertainty-adjusted outage exceeds modeled survival.")
	}
	return domain.ResiliencePlanResponse{
		VehicleID:        request.VehicleID,
		SurvivalHorizonS: survivalS,
		RiskTimeline:     timeline,
		LoadPriorities: []domain.LoadPriority{
			{Priority: 1, Load: "life_safety", Action: "preserve"},
			{Priority: 2, Load: "communications_and_medical", Action: "preserve"},
			{Priority: 3, Load: "refrigeration", Action: "cycle_if_safe"},
			{Priority: 4, Load: "comfort_and_optional", Action: "shed_first"},
		},
		Recommendations: recommendations,
		DataQuality: quality(
			domain.QualityLimited,
			0,
			pointer(100),
			nil,
			timePointer(now),
			"plan is derived from confirmed scenario energy and load inputs",
		),
		Evidence:    evidenceItems,
		Limitations: limitations,
		GeneratedAt: now.UTC(),
	}
}
