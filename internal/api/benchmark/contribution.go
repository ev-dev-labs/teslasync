package benchmark

import (
	"context"
	"fmt"
	"math"
	"time"

	dbbenchmark "github.com/ev-dev-labs/teslasync/internal/database/benchmark"
	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
)

const (
	minDegradationSamples = 4
	minEfficiencySamples  = 5
	minChargingSamples    = 3
	minOperationSamples   = 5
)

func (s *Service) ensureContribution(
	ctx context.Context,
	candidate dbbenchmark.Candidate,
	cohort cohortKey,
	start, end time.Time,
) (*models.PrivacyBenchmarkContribution, error) {
	existing, err := s.repo.GetContribution(ctx, candidate.ConsentID, start, end, MechanismVersion)
	if err != nil {
		return nil, fmt.Errorf("get clipped contribution: %w", err)
	}
	if existing != nil {
		return existing, nil
	}

	raw, err := s.repo.DeriveSourceAggregates(ctx, candidate.VehicleID, start, end)
	if err != nil {
		return nil, fmt.Errorf("derive bounded contribution: %w", err)
	}
	contribution := clipAggregates(raw)
	contribution.ConsentID = candidate.ConsentID
	contribution.PeriodStart = start
	contribution.PeriodEnd = end
	contribution.ModelFamily = cohort.ModelFamily
	contribution.ModelYearBucket = cohort.ModelYearBucket
	contribution.MechanismVersion = MechanismVersion
	persisted, err := s.repo.InsertContribution(ctx, &contribution)
	if err != nil {
		return nil, fmt.Errorf("persist clipped contribution: %w", err)
	}
	return persisted, nil
}

func clipAggregates(raw *dbbenchmark.SourceAggregates) models.PrivacyBenchmarkContribution {
	var c models.PrivacyBenchmarkContribution
	if raw == nil {
		return c
	}
	c.DegradationSampleCount = clipCount(raw.CapacitySampleCount)
	c.EfficiencySampleCount = clipCount(raw.DriveSampleCount)
	c.ChargingSampleCount = clipCount(raw.ChargingSampleCount)
	c.OperationSampleCount = clipCount(raw.NotificationSampleCount + raw.CommandSampleCount)

	if raw.CapacitySampleCount >= minDegradationSamples &&
		raw.EarlyCapacityWh != nil && raw.RecentCapacityWh != nil &&
		*raw.EarlyCapacityWh > 0 && *raw.RecentCapacityWh > 0 {
		value := ((*raw.EarlyCapacityWh - *raw.RecentCapacityWh) / *raw.EarlyCapacityWh) * 100
		value = clip(value, 0, 30)
		c.DegradationPct = &value
	}
	if raw.DriveSampleCount >= minEfficiencySamples &&
		raw.DriveEnergyWh != nil && raw.DriveDistanceM != nil &&
		*raw.DriveEnergyWh >= 0 && *raw.DriveDistanceM > 0 {
		value := (*raw.DriveEnergyWh * 1000) / *raw.DriveDistanceM
		value = clip(value, 80, 500)
		c.EfficiencyWhPerKm = &value
	}
	if raw.ChargingSampleCount >= minChargingSamples {
		value := float64(raw.ChargingSuccessCount) / float64(raw.ChargingSampleCount) * 100
		value = clip(value, 0, 100)
		c.ChargingReliabilityPct = &value
	}
	operationSamples := raw.NotificationSampleCount + raw.CommandSampleCount
	if operationSamples >= minOperationSamples {
		successes := raw.NotificationSuccessCount + raw.CommandSuccessCount
		value := float64(successes) / float64(operationSamples) * 100
		value = clip(value, 0, 100)
		c.OperationReliabilityPct = &value
	}
	return c
}

func clip(value, lower, upper float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return lower
	}
	return math.Max(lower, math.Min(upper, value))
}

func clipCount(value int) int {
	if value < 0 {
		return 0
	}
	if value > 1000 {
		return 1000
	}
	return value
}
