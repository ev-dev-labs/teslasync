package benchmark

import (
	"context"
	"fmt"
	"math"

	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
)

func (s *Service) personalize(
	ctx context.Context,
	release *models.PrivacyBenchmarkRelease,
	target *models.PrivacyBenchmarkContribution,
) (*models.PrivacyBenchmarkRelease, error) {
	if release == nil || target == nil {
		return nil, fmt.Errorf("personalize benchmark: missing release or contribution")
	}
	bins, err := s.repo.ReleaseBins(ctx, release.ID)
	if err != nil {
		return nil, fmt.Errorf("personalize benchmark bins: %w", err)
	}
	byMetric := make(map[models.PrivacyBenchmarkMetricName][]float64, len(metricDefinitions))
	for _, bin := range bins {
		counts := byMetric[bin.MetricName]
		for len(counts) <= int(bin.BinIndex) {
			counts = append(counts, 0)
		}
		counts[bin.BinIndex] = bin.NoisyCount
		byMetric[bin.MetricName] = counts
	}

	for i := range release.Metrics {
		metric := &release.Metrics[i]
		definition, ok := definitionFor(metric.Name)
		if !ok {
			continue
		}
		metric.HigherIsBetter = definition.HigherIsBetter
		value := definition.Value(*target)
		metric.TargetValue = value
		if metric.Suppressed || value == nil {
			metric.Percentile = nil
			continue
		}
		counts := byMetric[metric.Name]
		if len(counts) != histogramBinCount {
			metric.Percentile = nil
			continue
		}
		rank := noisyPerformancePercentile(counts, *value, definition)
		metric.Percentile = &rank
	}
	return release, nil
}

func definitionFor(name models.PrivacyBenchmarkMetricName) (metricDefinition, bool) {
	for _, definition := range metricDefinitions {
		if definition.Name == name {
			return definition, true
		}
	}
	return metricDefinition{}, false
}

// noisyPerformancePercentile is post-processing of the one stable released
// histogram. 100 means a better metric value than most of the cohort,
// regardless of whether the physical metric is higher- or lower-is-better.
func noisyPerformancePercentile(counts []float64, value float64, definition metricDefinition) float64 {
	total := 0.0
	for _, count := range counts {
		total += math.Max(0, count)
	}
	if total <= 0 {
		return 50
	}
	index := binIndex(value, definition.Lower, definition.Upper)
	below := 0.0
	for i := 0; i < index; i++ {
		below += math.Max(0, counts[i])
	}
	below += math.Max(0, counts[index]) / 2
	percentile := below / total * 100
	if !definition.HigherIsBetter {
		percentile = 100 - percentile
	}
	return round(clip(percentile, 0, 100), 1)
}
