package benchmark

import (
	"crypto/rand"
	"encoding/binary"
	"errors"
	"math"

	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
)

const histogramBinCount = 10

type UniformSource interface {
	Float64() (float64, error)
}

type cryptoUniformSource struct{}

// Float64 uses 53 cryptographically-random bits and maps them strictly inside
// (0,1), avoiding inverse-CDF infinities without biased endpoint retries.
func (cryptoUniformSource) Float64() (float64, error) {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return 0, err
	}
	const mask = uint64(1<<53) - 1
	n := binary.BigEndian.Uint64(raw[:]) & mask
	return (float64(n) + 0.5) / float64(uint64(1)<<53), nil
}

func laplace(source UniformSource, scale float64) (float64, error) {
	if source == nil || scale <= 0 || math.IsNaN(scale) || math.IsInf(scale, 0) {
		return 0, errors.New("invalid Laplace source or scale")
	}
	u, err := source.Float64()
	if err != nil {
		return 0, err
	}
	if u <= 0 || u >= 1 || math.IsNaN(u) {
		return 0, errors.New("uniform source returned value outside (0,1)")
	}
	if u < 0.5 {
		return scale * math.Log(2*u), nil
	}
	return -scale * math.Log(2*(1-u)), nil
}

type metricDefinition struct {
	Name           models.PrivacyBenchmarkMetricName
	Unit           string
	Lower          float64
	Upper          float64
	HigherIsBetter bool
	Value          func(models.PrivacyBenchmarkContribution) *float64
}

var metricDefinitions = []metricDefinition{
	{
		Name: models.PrivacyBenchmarkDegradation, Unit: "pct",
		Lower: 0, Upper: 30, HigherIsBetter: false,
		Value: func(c models.PrivacyBenchmarkContribution) *float64 { return c.DegradationPct },
	},
	{
		Name: models.PrivacyBenchmarkEfficiency, Unit: "wh_per_km",
		Lower: 80, Upper: 500, HigherIsBetter: false,
		Value: func(c models.PrivacyBenchmarkContribution) *float64 { return c.EfficiencyWhPerKm },
	},
	{
		Name: models.PrivacyBenchmarkChargingReliability, Unit: "pct",
		Lower: 0, Upper: 100, HigherIsBetter: true,
		Value: func(c models.PrivacyBenchmarkContribution) *float64 { return c.ChargingReliabilityPct },
	},
	{
		Name: models.PrivacyBenchmarkOperationReliability, Unit: "pct",
		Lower: 0, Upper: 100, HigherIsBetter: true,
		Value: func(c models.PrivacyBenchmarkContribution) *float64 { return c.OperationReliabilityPct },
	},
}

func (s *Service) buildDPRelease(
	contributions []models.PrivacyBenchmarkContribution,
) ([]models.PrivacyBenchmarkMetric, []models.PrivacyBenchmarkReleaseBin, float64, *string, error) {
	if len(contributions) < MinimumCohortSize {
		reason := "insufficient_cohort"
		return suppressedMetrics(), nil, 0, &reason, nil
	}

	metrics := make([]models.PrivacyBenchmarkMetric, 0, len(metricDefinitions))
	bins := make([]models.PrivacyBenchmarkReleaseBin, 0, len(metricDefinitions)*histogramBinCount)
	totalEpsilon := 0.0
	for _, definition := range metricDefinitions {
		values := make([]float64, 0, len(contributions))
		for _, contribution := range contributions {
			if value := definition.Value(contribution); value != nil {
				values = append(values, clip(*value, definition.Lower, definition.Upper))
			}
		}
		if len(values) < MinimumCohortSize {
			metrics = append(metrics, suppressedMetric(definition))
			continue
		}
		metric, metricBins, err := s.noisyHistogram(definition, values)
		if err != nil {
			return nil, nil, 0, nil, err
		}
		metrics = append(metrics, metric)
		bins = append(bins, metricBins...)
		totalEpsilon += MetricEpsilon
	}
	if totalEpsilon == 0 {
		reason := "insufficient_metric_data"
		return metrics, nil, 0, &reason, nil
	}
	return metrics, bins, round(totalEpsilon, 4), nil, nil
}

func (s *Service) noisyHistogram(
	definition metricDefinition,
	values []float64,
) (models.PrivacyBenchmarkMetric, []models.PrivacyBenchmarkReleaseBin, error) {
	counts := make([]float64, histogramBinCount)
	for _, value := range values {
		counts[binIndex(value, definition.Lower, definition.Upper)]++
	}
	scale := 1.0 / MetricEpsilon
	noisy := make([]float64, histogramBinCount)
	bins := make([]models.PrivacyBenchmarkReleaseBin, 0, histogramBinCount)
	for i, count := range counts {
		noise, err := laplace(s.noise, scale)
		if err != nil {
			return models.PrivacyBenchmarkMetric{}, nil, err
		}
		noisy[i] = math.Max(0, count+noise)
		bins = append(bins, models.PrivacyBenchmarkReleaseBin{
			MetricName: definition.Name,
			BinIndex:   int16(i),
			NoisyCount: round(noisy[i], 6),
		})
	}
	total := 0.0
	weighted := 0.0
	width := (definition.Upper - definition.Lower) / histogramBinCount
	for i, count := range noisy {
		total += count
		weighted += count * (definition.Lower + (float64(i)+0.5)*width)
	}
	if total < 1 {
		total = 1
	}
	mean := clip(weighted/total, definition.Lower, definition.Upper)
	p25 := histogramQuantile(noisy, definition.Lower, definition.Upper, 0.25)
	p75 := histogramQuantile(noisy, definition.Lower, definition.Upper, 0.75)
	noisySize := int(math.Round(total))
	quality := qualityForNoisySize(noisySize)
	return models.PrivacyBenchmarkMetric{
		Name:            definition.Name,
		Unit:            definition.Unit,
		LowerBound:      definition.Lower,
		UpperBound:      definition.Upper,
		EpsilonSpent:    MetricEpsilon,
		NoisyCohortSize: &noisySize,
		NoisyMean:       floatPtr(round(mean, 4)),
		NoisyP25:        floatPtr(round(p25, 4)),
		NoisyP75:        floatPtr(round(p75, 4)),
		NoiseScale:      floatPtr(scale),
		Suppressed:      false,
		Quality:         quality,
		HigherIsBetter:  definition.HigherIsBetter,
	}, bins, nil
}

func binIndex(value, lower, upper float64) int {
	if value >= upper {
		return histogramBinCount - 1
	}
	index := int(math.Floor((value - lower) / (upper - lower) * histogramBinCount))
	if index < 0 {
		return 0
	}
	if index >= histogramBinCount {
		return histogramBinCount - 1
	}
	return index
}

func histogramQuantile(counts []float64, lower, upper, quantile float64) float64 {
	total := 0.0
	for _, count := range counts {
		total += math.Max(0, count)
	}
	if total <= 0 {
		return (lower + upper) / 2
	}
	target := total * clip(quantile, 0, 1)
	cumulative := 0.0
	width := (upper - lower) / float64(len(counts))
	for i, count := range counts {
		cumulative += math.Max(0, count)
		if cumulative >= target {
			return clip(lower+(float64(i)+0.5)*width, lower, upper)
		}
	}
	return upper
}

func qualityForNoisySize(size int) string {
	switch {
	case size >= 25:
		return "strong"
	case size >= 10:
		return "moderate"
	default:
		return "limited"
	}
}

func suppressedMetric(definition metricDefinition) models.PrivacyBenchmarkMetric {
	return models.PrivacyBenchmarkMetric{
		Name: definition.Name, Unit: definition.Unit,
		LowerBound: definition.Lower, UpperBound: definition.Upper,
		Suppressed: true, Quality: "suppressed",
		HigherIsBetter: definition.HigherIsBetter,
	}
}

func suppressedMetrics() []models.PrivacyBenchmarkMetric {
	out := make([]models.PrivacyBenchmarkMetric, 0, len(metricDefinitions))
	for _, definition := range metricDefinitions {
		out = append(out, suppressedMetric(definition))
	}
	return out
}

func floatPtr(value float64) *float64 { return &value }
