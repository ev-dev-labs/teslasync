package advancedintelligencesvc

import (
	"math"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestBuildTwinLabDeterministicMathAndBounds(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	efficiency := 0.2
	stddev := 0.02
	capacity := 75_000.0
	temp := 20.0
	evidence := &domain.CalibrationEvidence{
		VehicleID: 7, DriveSampleCount: 30, ChargeSampleCount: 6,
		EfficiencyWhPerM: &efficiency, EfficiencyStddevWhPerM: &stddev,
		UsableBatteryWh: &capacity, AmbientTempC: &temp,
	}
	request := domain.TwinLabRequest{
		VehicleID: 7, Confirmed: true,
		Scenarios: []domain.TwinScenarioInput{{
			Name: "cold_highway", HorizonS: 3600, DistanceM: 100_000,
			SpeedMps: 30, OutsideTempC: floatPointer(-10), AuxiliaryLoadW: 2000,
		}},
	}

	first := BuildTwinLab(evidence, request, now)
	second := BuildTwinLab(evidence, request, now)
	if len(first.Scenarios) != 1 || len(second.Scenarios) != 1 {
		t.Fatalf("scenario count = %d, %d", len(first.Scenarios), len(second.Scenarios))
	}
	got, again := first.Scenarios[0], second.Scenarios[0]
	if got.BatteryDeltaWh == nil || again.BatteryDeltaWh == nil ||
		*got.BatteryDeltaWh != *again.BatteryDeltaWh {
		t.Fatalf("deterministic battery delta = %v vs %v", got.BatteryDeltaWh, again.BatteryDeltaWh)
	}
	if got.BatteryLowWh == nil || got.BatteryHighWh == nil ||
		*got.BatteryLowWh > *got.BatteryDeltaWh ||
		*got.BatteryDeltaWh > *got.BatteryHighWh {
		t.Fatalf("battery uncertainty does not contain estimate: %+v", got)
	}
	if got.RangeLowM == nil || got.RangeDeltaM == nil || got.RangeHighM == nil ||
		*got.RangeLowM > *got.RangeDeltaM || *got.RangeDeltaM > *got.RangeHighM {
		t.Fatalf("range uncertainty does not contain estimate: %+v", got)
	}
	if got.WearLowPct == nil || *got.WearLowPct < 0 {
		t.Fatalf("wear lower bound = %v", got.WearLowPct)
	}
}

func TestBuildTwinLabInsufficientDoesNotFabricate(t *testing.T) {
	efficiency := 0.2
	response := BuildTwinLab(
		&domain.CalibrationEvidence{DriveSampleCount: 2, EfficiencyWhPerM: &efficiency},
		domain.TwinLabRequest{
			VehicleID: 2,
			Scenarios: []domain.TwinScenarioInput{{
				Name: "test", HorizonS: 3600, DistanceM: 1000, SpeedMps: 10,
			}},
		},
		time.Now().UTC(),
	)
	if response.DataQuality.Status != domain.QualityInsufficient {
		t.Fatalf("quality = %q", response.DataQuality.Status)
	}
	item := response.Scenarios[0]
	if item.BatteryDeltaWh != nil || item.RangeDeltaM != nil ||
		item.ThermalDeltaC != nil || item.WearDeltaPct != nil {
		t.Fatalf("insufficient projections must be null: %+v", item)
	}
}

func TestBuildFirmwareCanaryMatchedDecision(t *testing.T) {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	version := "2026.24.1"
	before, after := 0.2, 0.23
	peerBefore, peerAfter := 0.2, 0.202
	window := &domain.FirmwareWindowEvidence{
		VehicleID: 4, Version: &version, InstalledAt: &now,
		PreStart: timeTestPointer(now.Add(-14 * 24 * time.Hour)),
		PreEnd:   &now, PostStart: &now, PostEnd: timeTestPointer(now.Add(14 * 24 * time.Hour)),
		PreDriveSampleCount: 20, PostDriveSampleCount: 20,
		PeerPreSampleCount: 50, PeerPostSampleCount: 50,
		PreEfficiencyWhPerM: &before, PostEfficiencyWhPerM: &after,
		PeerPreEfficiencyWhPerM: &peerBefore, PeerPostEfficiencyWhPerM: &peerAfter,
	}
	item := BuildFirmwareCanary(window, now)
	if item.Decision != domain.CanaryHold {
		t.Fatalf("decision = %q, want hold; item=%+v", item.Decision, item)
	}
	if item.MatchedExcessPct == nil || *item.MatchedExcessPct <= 10 {
		t.Fatalf("matched excess = %v", item.MatchedExcessPct)
	}
}

func TestBuildComponentSurvivalRequiresOutcomesAndOrdersHorizons(t *testing.T) {
	exposureS := int64(365 * 24 * time.Hour / time.Second)
	source := &domain.SurvivalEvidence{
		VehicleID: 9, DriveSampleCount: 100, ExposureS: &exposureS,
		TireEventCount: 2,
	}
	items := BuildComponentSurvival(source, time.Now().UTC())
	var tires, battery *domain.ComponentSurvival
	for i := range items {
		switch items[i].Component {
		case "tires":
			tires = &items[i]
		case "hv_battery":
			battery = &items[i]
		}
	}
	if tires == nil || tires.HorizonP10S == nil || tires.HorizonP50S == nil ||
		tires.HorizonP90S == nil ||
		!(*tires.HorizonP10S < *tires.HorizonP50S &&
			*tires.HorizonP50S < *tires.HorizonP90S) {
		t.Fatalf("invalid tire horizons: %+v", tires)
	}
	if battery == nil || battery.HorizonP50S != nil ||
		battery.DataQuality.Status != domain.QualityInsufficient {
		t.Fatalf("zero-outcome battery must remain unsupported: %+v", battery)
	}
}

func TestBuildSentinelFindingsNoInventedAttack(t *testing.T) {
	if findings := BuildSentinelFindings(&domain.SentinelEvidence{
		CommandSampleCount: 4, TelemetrySampleCount: 1,
	}); len(findings) != 0 {
		t.Fatalf("findings = %+v, want none", findings)
	}
	gapS := int64(25 * time.Hour / time.Second)
	findings := BuildSentinelFindings(&domain.SentinelEvidence{
		TelemetrySampleCount: 20, MaxTelemetryGapS: &gapS,
	})
	if len(findings) != 1 || findings[0].FindingType != "telemetry_integrity_gap" {
		t.Fatalf("findings = %+v", findings)
	}
}

func TestBuildJourneyAssuranceUnsupportedStaysNull(t *testing.T) {
	response := BuildJourneyAssurance(
		domain.JourneyAssuranceRequest{
			VehicleID: 1, RouteDistanceM: 10_000, ReserveTargetPct: 20,
		},
		nil,
		nil,
		signal.State{},
		time.Now().UTC(),
	)
	if response.ReadinessScorePct != nil || response.ArrivalSocLowPct != nil ||
		response.EnergyRequiredWh != nil {
		t.Fatalf("unsupported journey values must be null: %+v", response)
	}
}

func TestChargingSiteTwinQueueAndUnstableBounds(t *testing.T) {
	now := time.Now().UTC()
	stable := BuildChargingSiteTwin(domain.ChargingSiteTwinRequest{
		VehicleID: 1, ChargerCount: 4, ChargerPowerW: 10_000,
		PanelLimitW: 40_000, ArrivalRatePerS: 1.0 / 1800,
		MeanServiceS: 1800, ArrivalDistribution: "poisson",
		ServiceDistribution: "exponential",
	}, now)
	if stable.ProjectedUnstable || stable.QueueWaitP50S == nil ||
		stable.QueueWaitP90S == nil || *stable.QueueWaitP50S > *stable.QueueWaitP90S {
		t.Fatalf("stable queue output = %+v", stable)
	}
	unstable := BuildChargingSiteTwin(domain.ChargingSiteTwinRequest{
		VehicleID: 1, ChargerCount: 1, ChargerPowerW: 10_000,
		PanelLimitW: 10_000, ArrivalRatePerS: 1.0 / 300,
		MeanServiceS: 1800, ArrivalDistribution: "poisson",
		ServiceDistribution: "exponential",
	}, now)
	if !unstable.ProjectedUnstable || unstable.QueueWaitP50S != nil ||
		unstable.QueueWaitP90S != nil {
		t.Fatalf("unstable queue must have null wait quantiles: %+v", unstable)
	}
}

func TestBuildResiliencePlanPreservesReserve(t *testing.T) {
	response := BuildResiliencePlan(domain.ResiliencePlanRequest{
		VehicleID: 1, VehicleEnergyWh: 20_000, EvacuationReserveWh: 5_000,
		StationaryStorageWh: 5_000, ExpectedSolarWh: 4_000,
		EssentialLoadW: 2_000, OutageDurationS: 43_200,
	}, signal.State{}, time.Now().UTC())
	want := int64(43_200)
	if response.SurvivalHorizonS != want {
		t.Fatalf("survival_horizon_s = %d, want %d", response.SurvivalHorizonS, want)
	}
}

func TestEstimateCausalResultRequiresConfounderCoverage(t *testing.T) {
	baseValue, treatmentValue := 0.2, 0.18
	coverage, temp := 90.0, 20.0
	state, result := estimateCausalResult(
		domain.CausalDriveEnergyWhPerM,
		&domain.MetricWindowEvidence{
			SampleCount: 10, MetricValue: &baseValue,
			ConfounderCoveragePct: &coverage, AmbientTempC: &temp,
		},
		&domain.MetricWindowEvidence{
			SampleCount: 12, MetricValue: &treatmentValue,
			ConfounderCoveragePct: &coverage, AmbientTempC: &temp,
		},
		time.Now().UTC(),
	)
	if state != "estimated" || result.EffectEnergyWhPerM == nil ||
		math.Abs(*result.EffectEnergyWhPerM+0.02) > 1e-9 {
		t.Fatalf("state/result = %s %+v", state, result)
	}
	lowCoverage := 50.0
	state, result = estimateCausalResult(
		domain.CausalDriveEnergyWhPerM,
		&domain.MetricWindowEvidence{
			SampleCount: 10, MetricValue: &baseValue,
			ConfounderCoveragePct: &lowCoverage, AmbientTempC: &temp,
		},
		&domain.MetricWindowEvidence{
			SampleCount: 12, MetricValue: &treatmentValue,
			ConfounderCoveragePct: &coverage, AmbientTempC: &temp,
		},
		time.Now().UTC(),
	)
	if state != "non_causal" || result.EffectEnergyWhPerM != nil {
		t.Fatalf("insufficient confounders must not produce effect: %s %+v", state, result)
	}
}

func TestBuildTCOOptimizerNullAndSupportedMoney(t *testing.T) {
	request := domain.TCOOptimizerRequest{
		VehicleID: 1, HorizonS: int64(365 * 24 * time.Hour / time.Second),
		AnnualDistanceM: 20_000_000, HomeChargingPct: 70,
		PublicChargingPct: 30, RiskTolerancePct: 50,
		BudgetMinor: 500_000, Currency: "USD",
	}
	unsupported := BuildTCOOptimizer(request, &domain.TCOEvidence{}, time.Now().UTC())
	for _, strategy := range unsupported.Strategies {
		if strategy.ProjectedCostMinor != nil || strategy.WithinBudget != nil {
			t.Fatalf("unsupported strategy fabricated money: %+v", strategy)
		}
	}
	distanceM, homeWh, publicWh := 10_000_000.0, 1_500_000.0, 500_000.0
	homeCost, publicCost, maintenanceCost := int64(15_000), int64(15_000), int64(20_000)
	supported := BuildTCOOptimizer(request, &domain.TCOEvidence{
		DriveSampleCount: 30, DistanceM: &distanceM,
		HomeChargeSampleCount: 4, PublicChargeSampleCount: 4,
		HomeEnergyWh: &homeWh, PublicEnergyWh: &publicWh,
		HomeCostMinor: &homeCost, PublicCostMinor: &publicCost,
		MaintenanceCostMinor: &maintenanceCost,
		ChargingSampleCount:  8, ChargingSuccessCount: 8,
	}, time.Now().UTC())
	if len(supported.Strategies) != 3 {
		t.Fatalf("strategies = %d", len(supported.Strategies))
	}
	for _, strategy := range supported.Strategies {
		if strategy.ProjectedCostMinor == nil {
			t.Fatalf("supported strategy missing projection: %+v", strategy)
		}
	}
}

func floatPointer(value float64) *float64 { return &value }
func timeTestPointer(value time.Time) *time.Time {
	return &value
}
