package smartreadinesssvc

import (
	"cmp"
	"context"
	"maps"
	"regexp"
	"slices"
	"strings"
	"time"

	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/integrations/nhtsa"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const (
	recallFreshness = 48 * time.Hour
	recallLookback  = 90 * 24 * time.Hour
	recallCheckGap  = 24 * time.Hour
	recallRetryGap  = time.Hour
	maxRecallCards  = 5
)

var nhtsaCampaign = regexp.MustCompile(`^[0-9]{2}V[0-9]{6}$`)

type recallCatalog interface {
	Recalls(context.Context, nhtsa.VehicleQuery, nhtsa.FetchOptions) (nhtsa.RecallResult, error)
}

type RecallWatch struct {
	repo    port.RecallWatchRepository
	catalog recallCatalog
	now     func() time.Time
}

type RecallWatchBatch struct {
	Outcomes  map[domain.RecallWatchOutcome]int
	Published int
}

func NewRecallWatch(repo port.RecallWatchRepository, catalog recallCatalog, now func() time.Time) *RecallWatch {
	if now == nil {
		now = time.Now
	}
	return &RecallWatch{repo: repo, catalog: catalog, now: now}
}

func recallScopeValid(scope port.RecallWatchScope) bool {
	return scope.VehicleID > 0 && validRecallSubject(scope.Subject)
}

func validRecallSubject(subject string) bool {
	return subject != personaldomain.OpenSubject && subject != "open-mode" && strings.TrimSpace(subject) != ""
}

func (s *RecallWatch) Read(ctx context.Context, scope port.RecallWatchScope) (domain.RecallWatch, error) {
	if !recallScopeValid(scope) {
		return domain.RecallWatch{}, port.ErrNotFound
	}
	return s.repo.ReadRecallWatch(ctx, scope, s.now().UTC())
}

func (s *RecallWatch) Enable(ctx context.Context, scope port.RecallWatchScope, expectedID int64, setup domain.RecallWatchSetup) error {
	if !recallScopeValid(scope) {
		return port.ErrNotFound
	}
	now := s.now().UTC()
	if !validRecallModel(setup, now) || expectedID < 0 {
		return ErrInvalidInput
	}
	return s.repo.ReplaceRecallWatch(ctx, scope, expectedID, setup, now)
}

func (s *RecallWatch) Disable(ctx context.Context, scope port.RecallWatchScope, expectedID int64) error {
	if !recallScopeValid(scope) {
		return port.ErrNotFound
	}
	if expectedID <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteRecallWatch(ctx, scope, expectedID)
}

func (s *RecallWatch) List(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]port.RecallWatchCandidate, error) {
	if !validRecallSubject(subject) || limit <= 0 {
		return nil, nil
	}
	return s.repo.ListRecallWatchMatches(ctx, subject, vehicleID, now, min(limit, 100))
}

func (s *RecallWatch) ProcessDue(ctx context.Context, limit int) (RecallWatchBatch, error) {
	batch := RecallWatchBatch{Outcomes: make(map[domain.RecallWatchOutcome]int)}
	if s.catalog == nil || limit < 1 || limit > 20 {
		return batch, ErrInvalidInput
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimRecallWatch(ctx, now, now.Add(2*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		outcome, published, err := s.check(ctx, *job)
		if err != nil {
			return batch, err
		}
		batch.Outcomes[outcome]++
		batch.Published += published
	}
	return batch, nil
}

func (s *RecallWatch) check(ctx context.Context, job port.DueRecallWatch) (domain.RecallWatchOutcome, int, error) {
	current, err := s.repo.RecallWatchStillCurrent(ctx, job)
	if err != nil || !current {
		return domain.RecallWatchChanged, 0, err
	}
	checkCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	result, fetchErr := s.catalog.Recalls(checkCtx, nhtsa.VehicleQuery{
		Make: "Tesla", Model: job.Setup.Model, ModelYear: job.Setup.ModelYear,
	}, nhtsa.FetchOptions{})
	cancel()
	now := s.now().UTC()
	checked := port.CheckedRecallWatch{CheckedAt: now, NextCheck: now.Add(recallCheckGap)}
	outcome := domain.RecallWatchNoMatch
	if fetchErr != nil || !currentRecallSource(result.Source, now) {
		checked.Failed, checked.NextCheck = true, now.Add(recallRetryGap)
		outcome = domain.RecallWatchUnavailable
	} else {
		checked.Matches = recallMatches(job.Setup, result, now)
		if len(checked.Matches) > 0 {
			outcome = domain.RecallWatchMatched
		}
	}
	saved, created, err := s.repo.FinishRecallWatch(ctx, job, checked)
	if !saved {
		outcome = domain.RecallWatchChanged
	}
	return outcome, created, err
}

func validRecallModel(setup domain.RecallWatchSetup, now time.Time) bool {
	firstYear := 0
	switch setup.Model {
	case "Roadster":
		firstYear = 2008
	case "Model S":
		firstYear = 2012
	case "Model X":
		firstYear = 2016
	case "Model 3":
		firstYear = 2017
	case "Model Y":
		firstYear = 2020
	case "Cybertruck":
		firstYear = 2024
	}
	return firstYear > 0 && setup.ModelYear >= firstYear && setup.ModelYear <= now.Year()+1
}

func currentRecallSource(source nhtsa.SourceMetadata, now time.Time) bool {
	return source.ID == nhtsa.SourceIDRecalls && source.Status == nhtsa.SourceStatusAvailable &&
		source.CheckedAt.After(now.Add(-recallFreshness)) && !source.CheckedAt.After(now) &&
		(!source.FromCache || (source.ExpiresAt != nil && source.ExpiresAt.After(now)))
}

func recallMatches(setup domain.RecallWatchSetup, result nhtsa.RecallResult, now time.Time) []domain.RecallCampaignMatch {
	unique := make(map[string]domain.RecallCampaignMatch)
	for _, row := range result.Recalls {
		evidence, ok := recallMatch(setup, row, result.Source.CheckedAt, now)
		if !ok {
			continue
		}
		if existing, duplicate := unique[evidence.Campaign]; !duplicate || evidence.ReportedAt.After(existing.ReportedAt) {
			unique[evidence.Campaign] = evidence
		}
	}
	items := slices.Collect(maps.Values(unique))
	slices.SortFunc(items, func(a, b domain.RecallCampaignMatch) int {
		if date := b.ReportedAt.Compare(a.ReportedAt); date != 0 {
			return date
		}
		return cmp.Compare(a.Campaign, b.Campaign)
	})
	return items[:min(len(items), maxRecallCards)]
}

func recallMatch(setup domain.RecallWatchSetup, row nhtsa.Recall, checkedAt, now time.Time) (domain.RecallCampaignMatch, bool) {
	if !strings.EqualFold(row.Make, "Tesla") || !strings.EqualFold(row.Model, setup.Model) ||
		row.ModelYear != setup.ModelYear || !nhtsaCampaign.MatchString(row.CampaignNumber) ||
		row.ReportReceivedAt == nil || row.ReportReceivedAt.After(checkedAt) ||
		!row.ReportReceivedAt.After(now.Add(-recallLookback)) ||
		strings.TrimSpace(row.Remedy) == "" || strings.TrimSpace(row.Component) == "" ||
		len(row.Remedy) > 4000 || len(row.Component) > 200 {
		return domain.RecallCampaignMatch{}, false
	}
	return domain.RecallCampaignMatch{
		Campaign: row.CampaignNumber, Component: row.Component, Remedy: row.Remedy,
		SourceURL: domain.RecallSourceURL(row.CampaignNumber),
		Model:     setup.Model, ModelYear: setup.ModelYear, ReportedAt: *row.ReportReceivedAt,
		CheckedAt: checkedAt, FreshUntil: minRecallExpiry(checkedAt.Add(recallFreshness), row.ReportReceivedAt.Add(recallLookback)),
		VerifyVINURL: domain.RecallVerificationURL,
	}, true
}

func minRecallExpiry(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
