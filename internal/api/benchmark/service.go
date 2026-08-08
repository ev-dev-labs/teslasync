package benchmark

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	dbbenchmark "github.com/ev-dev-labs/teslasync/internal/database/benchmark"
	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	MinimumCohortSize    = 5
	MechanismVersion     = int16(1)
	DefaultEpsilonBudget = 4.0
	MetricEpsilon        = 0.25
)

var (
	ErrConsentRequired       = errors.New("privacy benchmark consent required")
	ErrConsentNotFound       = errors.New("privacy benchmark consent not found")
	ErrVehicleNotFound       = errors.New("vehicle not found")
	ErrVehicleAlreadyOptedIn = errors.New("vehicle already opted in by another subject")
)

type repository interface {
	GetConsent(context.Context, string, int64) (*models.PrivacyBenchmarkConsent, error)
	UpsertConsent(context.Context, string, int64, time.Time) (*models.PrivacyBenchmarkConsent, error)
	RevokeAndDeleteClippedData(context.Context, string, int64, time.Time) (bool, error)
	EpsilonSpent(context.Context, int64) (float64, error)
	CandidateForSubject(context.Context, string, int64) (*dbbenchmark.Candidate, error)
	ListActiveCandidates(context.Context) ([]dbbenchmark.Candidate, error)
	DeriveSourceAggregates(context.Context, int64, time.Time, time.Time) (*dbbenchmark.SourceAggregates, error)
	GetContribution(context.Context, int64, time.Time, time.Time, int16) (*models.PrivacyBenchmarkContribution, error)
	InsertContribution(context.Context, *models.PrivacyBenchmarkContribution) (*models.PrivacyBenchmarkContribution, error)
	FindRelease(context.Context, dbbenchmark.ReleaseKey) (*models.PrivacyBenchmarkRelease, error)
	CreateRelease(context.Context, dbbenchmark.CreateReleaseInput) (*models.PrivacyBenchmarkRelease, bool, error)
	ListReleases(context.Context, int64, int, int) ([]models.PrivacyBenchmarkRelease, error)
	ReleaseBins(context.Context, int64) ([]models.PrivacyBenchmarkReleaseBin, error)
}

type Service struct {
	repo  repository
	noise UniformSource
	now   func() time.Time
}

func NewService(repo repository) *Service {
	if repo == nil {
		panic("benchmark.NewService: repo must not be nil")
	}
	return &Service{repo: repo, noise: cryptoUniformSource{}, now: time.Now}
}

func (s *Service) Status(ctx context.Context, subject string, vehicleID int64) (*models.PrivacyBenchmarkStatus, error) {
	consent, err := s.repo.GetConsent(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("privacy status: %w", err)
	}
	status := &models.PrivacyBenchmarkStatus{
		VehicleID:         vehicleID,
		EpsilonBudget:     DefaultEpsilonBudget,
		EpsilonRemaining:  DefaultEpsilonBudget,
		MinimumCohortSize: MinimumCohortSize,
		MechanismVersion:  MechanismVersion,
	}
	if consent == nil {
		return status, nil
	}
	spent, err := s.repo.EpsilonSpent(ctx, consent.ID)
	if err != nil {
		return nil, fmt.Errorf("privacy status accounting: %w", err)
	}
	status.OptedIn = consent.Status == "active"
	status.OptedInAt = &consent.OptedInAt
	status.RevokedAt = consent.RevokedAt
	status.EpsilonBudget = consent.EpsilonBudget
	status.EpsilonSpent = round(spent, 4)
	status.EpsilonRemaining = round(math.Max(0, consent.EpsilonBudget-spent), 4)
	return status, nil
}

func (s *Service) Consent(ctx context.Context, subject string, vehicleID int64) (*models.PrivacyBenchmarkStatus, error) {
	_, err := s.repo.UpsertConsent(ctx, subject, vehicleID, s.now().UTC())
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "23503":
				return nil, ErrVehicleNotFound
			case "23505":
				return nil, ErrVehicleAlreadyOptedIn
			}
		}
		return nil, fmt.Errorf("privacy consent: %w", err)
	}
	return s.Status(ctx, subject, vehicleID)
}

func (s *Service) Revoke(ctx context.Context, subject string, vehicleID int64) error {
	found, err := s.repo.RevokeAndDeleteClippedData(ctx, subject, vehicleID, s.now().UTC())
	if err != nil {
		return fmt.Errorf("privacy revoke: %w", err)
	}
	if !found {
		return ErrConsentNotFound
	}
	return nil
}

func (s *Service) CreateRelease(
	ctx context.Context,
	subject string,
	vehicleID int64,
	periodEnd time.Time,
) (*models.PrivacyBenchmarkRelease, error) {
	target, err := s.repo.CandidateForSubject(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("benchmark target: %w", err)
	}
	if target == nil {
		return nil, ErrConsentRequired
	}
	targetCohort := cohortFor(*target)
	periodEnd = monthStart(periodEnd)
	periodStart := periodEnd.AddDate(0, -3, 0)

	all, err := s.repo.ListActiveCandidates(ctx)
	if err != nil {
		return nil, fmt.Errorf("benchmark cohort: %w", err)
	}
	cohort := make([]dbbenchmark.Candidate, 0, len(all))
	for _, c := range all {
		if cohortFor(c) == targetCohort {
			cohort = append(cohort, c)
		}
	}
	sort.Slice(cohort, func(i, j int) bool { return cohort[i].ConsentID < cohort[j].ConsentID })
	sourceHash := cohortVersionHash(cohort)
	key := dbbenchmark.ReleaseKey{
		PeriodStart:       periodStart,
		PeriodEnd:         periodEnd,
		ModelFamily:       targetCohort.ModelFamily,
		ModelYearBucket:   targetCohort.ModelYearBucket,
		SourceVersionHash: sourceHash,
		MechanismVersion:  MechanismVersion,
	}

	existing, err := s.repo.FindRelease(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("benchmark stable release lookup: %w", err)
	}
	if existing != nil {
		targetContribution, err := s.ensureContribution(ctx, *target, targetCohort, periodStart, periodEnd)
		if err != nil {
			return nil, err
		}
		return s.personalize(ctx, existing, targetContribution)
	}

	contributions := make([]models.PrivacyBenchmarkContribution, 0, len(cohort))
	consentIDs := make([]int64, 0, len(cohort))
	for _, candidate := range cohort {
		contribution, err := s.ensureContribution(ctx, candidate, targetCohort, periodStart, periodEnd)
		if err != nil {
			return nil, err
		}
		contributions = append(contributions, *contribution)
		consentIDs = append(consentIDs, candidate.ConsentID)
	}

	metrics, bins, epsilon, reason, err := s.buildDPRelease(contributions)
	if err != nil {
		return nil, fmt.Errorf("build private release: %w", err)
	}
	suppressed := reason != nil
	release := models.PrivacyBenchmarkRelease{
		PeriodStart:       periodStart,
		PeriodEnd:         periodEnd,
		ModelFamily:       targetCohort.ModelFamily,
		ModelYearBucket:   targetCohort.ModelYearBucket,
		SourceVersionHash: sourceHash,
		MechanismVersion:  MechanismVersion,
		MinimumCohortSize: MinimumCohortSize,
		EpsilonSpent:      epsilon,
		Suppressed:        suppressed,
		SuppressionReason: reason,
	}
	created, _, err := s.persistRelease(ctx, release, metrics, bins, consentIDs)
	if errors.Is(err, dbbenchmark.ErrPrivacyBudgetExhausted) {
		reason = stringPtr("privacy_budget_exhausted")
		metrics = suppressedMetrics()
		release.EpsilonSpent = 0
		release.Suppressed = true
		release.SuppressionReason = reason
		created, _, err = s.persistRelease(ctx, release, metrics, nil, consentIDs)
	}
	if err != nil {
		return nil, fmt.Errorf("persist private release: %w", err)
	}
	targetContribution := contributionForConsent(contributions, target.ConsentID)
	if targetContribution == nil {
		return nil, errors.New("private release: target contribution missing")
	}
	return s.personalize(ctx, created, targetContribution)
}

func (s *Service) persistRelease(
	ctx context.Context,
	release models.PrivacyBenchmarkRelease,
	metrics []models.PrivacyBenchmarkMetric,
	bins []models.PrivacyBenchmarkReleaseBin,
	consentIDs []int64,
) (*models.PrivacyBenchmarkRelease, bool, error) {
	return s.repo.CreateRelease(ctx, dbbenchmark.CreateReleaseInput{
		Release: release, Metrics: metrics, Bins: bins, ConsentIDs: consentIDs,
	})
}

func (s *Service) ListReleases(
	ctx context.Context,
	subject string,
	vehicleID int64,
	limit, offset int,
) (*models.PrivacyBenchmarkReleasePage, error) {
	target, err := s.repo.CandidateForSubject(ctx, subject, vehicleID)
	if err != nil {
		return nil, fmt.Errorf("benchmark list target: %w", err)
	}
	if target == nil {
		return nil, ErrConsentRequired
	}
	items, err := s.repo.ListReleases(ctx, target.ConsentID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("benchmark list: %w", err)
	}
	for i := range items {
		contribution, err := s.repo.GetContribution(
			ctx, target.ConsentID, items[i].PeriodStart, items[i].PeriodEnd, items[i].MechanismVersion,
		)
		if err != nil {
			return nil, fmt.Errorf("benchmark list contribution: %w", err)
		}
		if contribution == nil {
			continue
		}
		personalized, err := s.personalize(ctx, &items[i], contribution)
		if err != nil {
			return nil, err
		}
		items[i] = *personalized
	}
	if items == nil {
		items = []models.PrivacyBenchmarkRelease{}
	}
	return &models.PrivacyBenchmarkReleasePage{Items: items, Limit: limit, Offset: offset}, nil
}

type cohortKey struct {
	ModelFamily     string
	ModelYearBucket int16
}

func cohortFor(candidate dbbenchmark.Candidate) cohortKey {
	model := ""
	if candidate.Model != nil {
		model = strings.ToLower(strings.TrimSpace(*candidate.Model))
	}
	family := "other"
	switch {
	case strings.Contains(model, "model s") || model == "s":
		family = "model_s"
	case strings.Contains(model, "model 3") || model == "3":
		family = "model_3"
	case strings.Contains(model, "model x") || model == "x":
		family = "model_x"
	case strings.Contains(model, "model y") || model == "y":
		family = "model_y"
	case strings.Contains(model, "cyber"):
		family = "cybertruck"
	case model == "":
		family = "unknown"
	}
	year := vinModelYear(candidate.VIN)
	bucket := int16(0)
	if year >= 2000 {
		bucket = int16((year / 5) * 5)
	}
	return cohortKey{ModelFamily: family, ModelYearBucket: bucket}
}

func vinModelYear(vin string) int {
	if len(vin) < 10 {
		return 0
	}
	const codes = "ABCDEFGHJKLMNPRSTVWXY"
	code := strings.ToUpper(vin[9:10])
	if idx := strings.Index(codes, code); idx >= 0 {
		return 2010 + idx
	}
	if code[0] >= '1' && code[0] <= '9' {
		return 2000 + int(code[0]-'0')
	}
	return 0
}

func cohortVersionHash(cohort []dbbenchmark.Candidate) []byte {
	h := sha256.New()
	for _, candidate := range cohort {
		_, _ = fmt.Fprintf(h, "%d\n", candidate.ConsentID)
	}
	return h.Sum(nil)
}

func monthStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

func defaultCompletedPeriodEnd(now time.Time) time.Time {
	return monthStart(now)
}

func contributionForConsent(items []models.PrivacyBenchmarkContribution, consentID int64) *models.PrivacyBenchmarkContribution {
	for i := range items {
		if items[i].ConsentID == consentID {
			return &items[i]
		}
	}
	return nil
}

func stringPtr(v string) *string { return &v }

func round(v float64, places int) float64 {
	p := math.Pow10(places)
	return math.Round(v*p) / p
}
