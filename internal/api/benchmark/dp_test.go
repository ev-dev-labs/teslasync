package benchmark

import (
	"context"
	"errors"
	"math"
	"reflect"
	"testing"
	"time"

	dbbenchmark "github.com/ev-dev-labs/teslasync/internal/database/benchmark"
	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
)

type sequenceUniform struct {
	values []float64
	index  int
}

func (s *sequenceUniform) Float64() (float64, error) {
	if len(s.values) == 0 {
		return 0, errors.New("empty deterministic sequence")
	}
	value := s.values[s.index%len(s.values)]
	s.index++
	return value, nil
}

func TestLaplaceDeterministicSymmetry(t *testing.T) {
	source := &sequenceUniform{values: []float64{0.25, 0.75}}
	left, err := laplace(source, 4)
	if err != nil {
		t.Fatal(err)
	}
	right, err := laplace(source, 4)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(left+right) > 1e-12 {
		t.Fatalf("inverse-CDF samples are not symmetric: left=%v right=%v", left, right)
	}
	if !(left < 0 && right > 0) {
		t.Fatalf("unexpected signs: left=%v right=%v", left, right)
	}
}

func TestLaplaceRejectsInvalidUniformEndpoints(t *testing.T) {
	for _, value := range []float64{0, 1, -0.1, 1.1, math.NaN()} {
		_, err := laplace(&sequenceUniform{values: []float64{value}}, 1)
		if err == nil {
			t.Fatalf("laplace accepted invalid uniform value %v", value)
		}
	}
}

func TestClipAggregatesAppliesSensitivityBounds(t *testing.T) {
	early, recent := 100_000.0, 1.0
	energy, distance := 1_000_000.0, 1.0
	raw := &dbbenchmark.SourceAggregates{
		CapacitySampleCount:      10,
		EarlyCapacityWh:          &early,
		RecentCapacityWh:         &recent,
		DriveSampleCount:         10,
		DriveEnergyWh:            &energy,
		DriveDistanceM:           &distance,
		ChargingSampleCount:      10,
		ChargingSuccessCount:     15,
		NotificationSampleCount:  3,
		NotificationSuccessCount: 5,
		CommandSampleCount:       3,
		CommandSuccessCount:      5,
	}
	got := clipAggregates(raw)
	if got.DegradationPct == nil || *got.DegradationPct != 30 {
		t.Fatalf("degradation = %v, want clipped 30", got.DegradationPct)
	}
	if got.EfficiencyWhPerKm == nil || *got.EfficiencyWhPerKm != 500 {
		t.Fatalf("efficiency = %v, want clipped 500", got.EfficiencyWhPerKm)
	}
	if got.ChargingReliabilityPct == nil || *got.ChargingReliabilityPct != 100 {
		t.Fatalf("charging reliability = %v, want clipped 100", got.ChargingReliabilityPct)
	}
	if got.OperationReliabilityPct == nil || *got.OperationReliabilityPct != 100 {
		t.Fatalf("operation reliability = %v, want clipped 100", got.OperationReliabilityPct)
	}
}

func TestBuildDPReleaseSuppressesSmallCohortWithoutSpending(t *testing.T) {
	service := &Service{noise: &sequenceUniform{values: []float64{0.5}}}
	contributions := make([]models.PrivacyBenchmarkContribution, MinimumCohortSize-1)
	metrics, bins, epsilon, reason, err := service.buildDPRelease(contributions)
	if err != nil {
		t.Fatal(err)
	}
	if reason == nil || *reason != "insufficient_cohort" {
		t.Fatalf("reason = %v, want insufficient_cohort", reason)
	}
	if epsilon != 0 || len(bins) != 0 {
		t.Fatalf("suppression spent epsilon or emitted bins: epsilon=%v bins=%d", epsilon, len(bins))
	}
	for _, metric := range metrics {
		if !metric.Suppressed || metric.NoisyMean != nil {
			t.Fatalf("metric was released for a small cohort: %+v", metric)
		}
	}
}

func TestNoisyHistogramReleasedValuesRemainBounded(t *testing.T) {
	service := &Service{noise: &sequenceUniform{values: []float64{
		0.000001, 0.999999, 0.25, 0.75, 0.5,
	}}}
	definition := metricDefinitions[1]
	values := []float64{80, 120, 180, 250, 500}
	metric, bins, err := service.noisyHistogram(definition, values)
	if err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]*float64{
		"mean": metric.NoisyMean,
		"p25":  metric.NoisyP25,
		"p75":  metric.NoisyP75,
	} {
		if value == nil || *value < definition.Lower || *value > definition.Upper {
			t.Fatalf("%s escaped [%v,%v]: %v", name, definition.Lower, definition.Upper, value)
		}
	}
	if len(bins) != histogramBinCount {
		t.Fatalf("bins=%d want %d", len(bins), histogramBinCount)
	}
	for _, bin := range bins {
		if bin.NoisyCount < 0 || math.IsNaN(bin.NoisyCount) || math.IsInf(bin.NoisyCount, 0) {
			t.Fatalf("invalid post-processed bin: %+v", bin)
		}
	}
}

type fakeRepository struct {
	consent       *models.PrivacyBenchmarkConsent
	candidates    []dbbenchmark.Candidate
	aggregates    map[int64]*dbbenchmark.SourceAggregates
	contributions map[int64]*models.PrivacyBenchmarkContribution
	release       *models.PrivacyBenchmarkRelease
	bins          []models.PrivacyBenchmarkReleaseBin
	deriveCalls   int
	createCalls   int
	epsilonSpent  float64
}

func (f *fakeRepository) GetConsent(context.Context, string, int64) (*models.PrivacyBenchmarkConsent, error) {
	return f.consent, nil
}
func (f *fakeRepository) UpsertConsent(context.Context, string, int64, time.Time) (*models.PrivacyBenchmarkConsent, error) {
	return f.consent, nil
}
func (f *fakeRepository) RevokeAndDeleteClippedData(context.Context, string, int64, time.Time) (bool, error) {
	return true, nil
}
func (f *fakeRepository) EpsilonSpent(context.Context, int64) (float64, error) {
	return f.epsilonSpent, nil
}
func (f *fakeRepository) CandidateForSubject(_ context.Context, _ string, vehicleID int64) (*dbbenchmark.Candidate, error) {
	for i := range f.candidates {
		if f.candidates[i].VehicleID == vehicleID {
			candidate := f.candidates[i]
			return &candidate, nil
		}
	}
	return nil, nil
}
func (f *fakeRepository) ListActiveCandidates(context.Context) ([]dbbenchmark.Candidate, error) {
	return append([]dbbenchmark.Candidate(nil), f.candidates...), nil
}
func (f *fakeRepository) DeriveSourceAggregates(_ context.Context, vehicleID int64, _, _ time.Time) (*dbbenchmark.SourceAggregates, error) {
	f.deriveCalls++
	return f.aggregates[vehicleID], nil
}
func (f *fakeRepository) GetContribution(_ context.Context, consentID int64, _, _ time.Time, _ int16) (*models.PrivacyBenchmarkContribution, error) {
	return f.contributions[consentID], nil
}
func (f *fakeRepository) InsertContribution(_ context.Context, c *models.PrivacyBenchmarkContribution) (*models.PrivacyBenchmarkContribution, error) {
	copy := *c
	copy.ID = int64(len(f.contributions) + 1)
	f.contributions[c.ConsentID] = &copy
	return &copy, nil
}
func (f *fakeRepository) FindRelease(_ context.Context, key dbbenchmark.ReleaseKey) (*models.PrivacyBenchmarkRelease, error) {
	if f.release == nil || !reflect.DeepEqual(f.release.SourceVersionHash, key.SourceVersionHash) {
		return nil, nil
	}
	copy := *f.release
	copy.Metrics = append([]models.PrivacyBenchmarkMetric(nil), f.release.Metrics...)
	return &copy, nil
}
func (f *fakeRepository) CreateRelease(_ context.Context, in dbbenchmark.CreateReleaseInput) (*models.PrivacyBenchmarkRelease, bool, error) {
	f.createCalls++
	in.Release.ID = 77
	in.Release.Metrics = append([]models.PrivacyBenchmarkMetric(nil), in.Metrics...)
	f.release = &in.Release
	f.bins = append([]models.PrivacyBenchmarkReleaseBin(nil), in.Bins...)
	for i := range f.bins {
		f.bins[i].ReleaseID = in.Release.ID
	}
	f.epsilonSpent += in.Release.EpsilonSpent
	copy := in.Release
	return &copy, true, nil
}
func (f *fakeRepository) ListReleases(context.Context, int64, int, int) ([]models.PrivacyBenchmarkRelease, error) {
	if f.release == nil {
		return nil, nil
	}
	return []models.PrivacyBenchmarkRelease{*f.release}, nil
}
func (f *fakeRepository) ReleaseBins(context.Context, int64) ([]models.PrivacyBenchmarkReleaseBin, error) {
	return append([]models.PrivacyBenchmarkReleaseBin(nil), f.bins...), nil
}

func TestCreateReleaseReusesStableReleaseWithoutNewNoiseOrSpend(t *testing.T) {
	model := "Model Y"
	candidates := make([]dbbenchmark.Candidate, 6)
	aggregates := make(map[int64]*dbbenchmark.SourceAggregates)
	for i := range candidates {
		id := int64(i + 1)
		candidates[i] = dbbenchmark.Candidate{
			ConsentID: id, VehicleID: id, EpsilonBudget: 4,
			Model: &model, VIN: "5YJYGDEE0P" + string(rune('0'+i)),
		}
		early := 75_000.0
		recent := 72_000.0 + float64(i*100)
		energy := 25_000.0 + float64(i*500)
		distance := 150_000.0
		aggregates[id] = &dbbenchmark.SourceAggregates{
			CapacitySampleCount: 10, EarlyCapacityWh: &early, RecentCapacityWh: &recent,
			DriveSampleCount: 10, DriveEnergyWh: &energy, DriveDistanceM: &distance,
			ChargingSampleCount: 10, ChargingSuccessCount: 9,
			NotificationSampleCount: 5, NotificationSuccessCount: 4,
			CommandSampleCount: 5, CommandSuccessCount: 5,
		}
	}

	repo := &fakeRepository{
		candidates: candidates, aggregates: aggregates,
		contributions: make(map[int64]*models.PrivacyBenchmarkContribution),
	}
	service := NewService(repo)
	service.noise = &sequenceUniform{values: []float64{0.5}}
	periodEnd := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)

	first, err := service.CreateRelease(context.Background(), "opaque-user", 1, periodEnd)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CreateRelease(context.Background(), "opaque-user", 1, periodEnd)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || first.ID != 77 {
		t.Fatalf("release IDs changed on refresh: first=%d second=%d", first.ID, second.ID)
	}
	if repo.createCalls != 1 {
		t.Fatalf("CreateRelease calls=%d want 1", repo.createCalls)
	}
	if repo.deriveCalls != len(candidates) {
		t.Fatalf("source derivations=%d want %d", repo.deriveCalls, len(candidates))
	}
	if repo.epsilonSpent != 1 {
		t.Fatalf("epsilon spent=%v want 1.0 once", repo.epsilonSpent)
	}
	if len(first.Metrics) != 4 || first.Metrics[0].Percentile == nil {
		t.Fatalf("release was not personalized: %+v", first.Metrics)
	}
}

func TestStatusReportsSequentiallyComposedLedgerSpend(t *testing.T) {
	now := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	repo := &fakeRepository{
		consent: &models.PrivacyBenchmarkConsent{
			ID: 9, VehicleID: 7, Status: "active",
			EpsilonBudget: 4, OptedInAt: now,
		},
		epsilonSpent: 1.75,
	}
	service := NewService(repo)
	status, err := service.Status(context.Background(), "opaque-user", 7)
	if err != nil {
		t.Fatal(err)
	}
	if !status.OptedIn || status.EpsilonSpent != 1.75 || status.EpsilonRemaining != 2.25 {
		t.Fatalf("unexpected composed status: %+v", status)
	}
}
