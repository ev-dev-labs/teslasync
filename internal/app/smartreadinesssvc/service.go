package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var ErrInvalidInput = errors.New("invalid charging readiness input")

type LiveSignals interface {
	GetAll(context.Context, int64, signal.LiveSignalReadPreference) (map[string]*signal.Value, error)
}

type ChargingSites interface {
	Contains(context.Context, int64, float64, float64) (bool, error)
}

type Service struct {
	repository     port.Repository
	live           LiveSignals
	sites          ChargingSites
	now            func() time.Time
	observe        func(domain.Reason)
	notify         func(context.Context, port.Candidate) error
	sharedOpenMode bool
}

type Option func(*Service)

func WithClock(now func() time.Time) Option {
	if now == nil {
		panic("smartreadinesssvc.WithClock: clock must not be nil")
	}
	return func(service *Service) { service.now = now }
}

func WithDecisionObserver(observe func(domain.Reason)) Option {
	if observe == nil {
		panic("smartreadinesssvc.WithDecisionObserver: observer must not be nil")
	}
	return func(service *Service) { service.observe = observe }
}

func WithCandidateNotifier(notify func(context.Context, port.Candidate) error) Option {
	if notify == nil {
		panic("smartreadinesssvc.WithCandidateNotifier: notifier must not be nil")
	}
	return func(service *Service) { service.notify = notify }
}

func WithSharedOpenMode(shared bool) Option {
	return func(service *Service) { service.sharedOpenMode = shared }
}

func New(repository port.Repository, live LiveSignals, sites ChargingSites, options ...Option) *Service {
	if repository == nil || live == nil || sites == nil {
		panic("smartreadinesssvc.New: dependencies must not be nil")
	}
	service := &Service{
		repository: repository, live: live, sites: sites,
		now: func() time.Time { return time.Now().UTC() },
	}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) ListPlans(
	ctx context.Context, subject string, vehicleID int64, limit, offset int,
) ([]domain.Plan, error) {
	if err := validateScope(subject, vehicleID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repository.ListPlans(ctx, subject, vehicleID, limit, offset)
}

func (s *Service) LatestStarts(ctx context.Context, subject string, vehicleID int64) ([]domain.LatestStart, error) {
	if err := validateScope(subject, vehicleID); err != nil {
		return nil, err
	}
	now := s.now().UTC()
	plans, err := s.repository.ListLatestStartPlans(ctx, subject, vehicleID, now, 100)
	if err != nil {
		return nil, fmt.Errorf("list latest-start charging plans: %w", err)
	}
	if len(plans) == 0 {
		return []domain.LatestStart{}, nil
	}
	values, err := s.live.GetAll(ctx, vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return nil, fmt.Errorf("read latest charging start signals: %w", err)
	}
	estimates := make([]domain.LatestStart, 0, len(plans))
	for _, plan := range plans {
		var siteErr error
		estimate := EstimateLatestStart(plan, values, s.now().UTC(), func(lat, lon float64) bool {
			if plan.ChargingPlaceID == nil {
				return false
			}
			var contains bool
			contains, siteErr = s.sites.Contains(ctx, *plan.ChargingPlaceID, lat, lon)
			return contains
		})
		if siteErr != nil {
			return nil, fmt.Errorf("check latest charging start place: %w", siteErr)
		}
		estimates = append(estimates, estimate)
	}
	if err := s.addSiteRateComparisons(ctx, plans, values, estimates); err != nil {
		return nil, err
	}
	current, err := s.repository.ListLatestStartPlans(ctx, subject, vehicleID, s.now().UTC(), 100)
	if err != nil {
		return nil, fmt.Errorf("recheck latest charging start consent: %w", err)
	}
	verifiedAt := s.now().UTC()
	currentVersions := make(map[int64]int64, len(current))
	for _, plan := range current {
		currentVersions[plan.ID] = plan.Version
	}
	result := estimates[:0]
	for i, estimate := range estimates {
		plan := plans[i]
		if version, ok := currentVersions[plan.ID]; !ok || version != plan.Version ||
			!verifiedAt.Before(plan.DepartureAt.Add(-minimumRemedyTime)) {
			continue
		}
		if estimate.ExpiresAt != nil && !verifiedAt.Before(*estimate.ExpiresAt) {
			estimate = domain.LatestStart{
				PlanID: plan.ID, PlanVersion: plan.Version, VehicleID: plan.VehicleID, Status: domain.LatestStartUnavailable,
				Reason: domain.LatestStartReasonUnknownState,
			}
		} else if estimate.Status == domain.LatestStartEstimate && estimate.EarliestSafeStartAt != nil &&
			!verifiedAt.Before(*estimate.EarliestSafeStartAt) {
			estimate.Status = domain.LatestStartOverdue
		}
		result = append(result, estimate)
	}
	return result, nil
}

func (s *Service) SavePlan(ctx context.Context, subject string, plan domain.Plan) (*domain.Plan, error) {
	if err := validateScope(subject, plan.VehicleID); err != nil {
		return nil, err
	}
	if !validTripLegs(plan.TripLegs) {
		return nil, fmt.Errorf("%w: valid outbound and return estimates are required", ErrInvalidInput)
	}
	setTripUseFromLegs(&plan)
	now := s.now().UTC()
	needsUsablePlace := plan.ID == 0 || plan.Enabled
	if plan.ID < 0 || (needsUsablePlace && (plan.ChargingPlaceID == nil || *plan.ChargingPlaceID <= 0)) ||
		!validPlan(plan) || ((plan.ID == 0 || plan.Enabled) && !now.Before(plan.DepartureAt.Add(-minimumRemedyTime))) ||
		plan.DepartureAt.After(now.AddDate(1, 0, 0)) {
		return nil, fmt.Errorf("%w: a future departure, charging place and valid percentage range are required", ErrInvalidInput)
	}
	plan.NotifyAt = plan.NotifyAt.UTC()
	plan.DepartureAt = plan.DepartureAt.UTC()
	if start := plan.ScheduledStart; start != nil {
		if !validScheduledStart(start, plan) {
			return nil, fmt.Errorf("%w: invalid dated charging start or time zone", ErrInvalidInput)
		}
		plan.ScheduledStart = &domain.ScheduledStart{At: start.At.UTC(), TimeZone: start.TimeZone}
	}
	return s.repository.SavePlan(ctx, subject, plan, now)
}

func (s *Service) DeletePlan(ctx context.Context, subject string, vehicleID, planID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if planID <= 0 {
		return fmt.Errorf("%w: plan ID is required", ErrInvalidInput)
	}
	return s.repository.DeletePlan(ctx, subject, vehicleID, planID)
}

func (s *Service) SnoozePlan(ctx context.Context, subject string, vehicleID, planID, durationS int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if planID <= 0 || durationS < 0 || durationS > int64((30*24*time.Hour)/time.Second) {
		return fmt.Errorf("%w: invalid snooze duration", ErrInvalidInput)
	}
	now := s.now().UTC()
	var until *time.Time
	if durationS > 0 {
		value := now.Add(time.Duration(durationS) * time.Second)
		until = &value
	}
	return s.repository.SnoozePlan(ctx, subject, vehicleID, planID, until, now)
}

// ProcessDue evaluates only claimed plans; absent plans never trigger live reads.
func (s *Service) ProcessDue(ctx context.Context, limit int) (int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	processed := 0
	for processed < limit {
		claim, err := s.repository.ClaimDue(ctx, s.now().UTC(), s.sharedOpenMode)
		if err != nil {
			return processed, fmt.Errorf("claim charging readiness work: %w", err)
		}
		if claim == nil {
			return processed, nil
		}
		decision, err := s.evaluate(ctx, claim.Plan)
		if err != nil {
			return processed, err
		}
		if err := s.repository.FinishClaim(ctx, *claim, decision, s.now().UTC()); err != nil {
			if errors.Is(err, port.ErrClaimLost) {
				processed++
				continue
			}
			return processed, fmt.Errorf("finish charging readiness work: %w", err)
		}
		if s.observe != nil {
			s.observe(decision.Reason)
		}
		processed++
		if decision.Reason == domain.ReasonEligible && s.notify != nil {
			candidate, candidateErr := s.FindCandidate(ctx, claim.Plan.Subject, claim.Plan.VehicleID, claim.Plan.ID)
			if candidateErr != nil {
				return processed, candidateErr
			}
			if candidate != nil {
				if err := s.notify(ctx, *candidate); err != nil {
					return processed, fmt.Errorf("notify charging readiness candidate: %w", err)
				}
			}
		}
	}
	return processed, nil
}

func (s *Service) FindCandidate(
	ctx context.Context, subject string, vehicleID, planID int64,
) (*port.Candidate, error) {
	if err := validateScope(subject, vehicleID); err != nil || planID <= 0 {
		return nil, ErrInvalidInput
	}
	now := s.now().UTC()
	candidate, err := s.repository.FindCandidate(ctx, subject, vehicleID, planID, now)
	if err != nil {
		return nil, fmt.Errorf("find charging readiness candidate: %w", err)
	}
	if candidate == nil {
		return nil, nil
	}
	decision, err := s.evaluate(ctx, candidate.Plan)
	if err != nil {
		return nil, err
	}
	if decision.Reason != domain.ReasonEligible || decision.Kind != candidate.Decision.Kind {
		return nil, nil
	}
	current, err := s.repository.FindCandidate(ctx, subject, vehicleID, planID, s.now().UTC())
	if err != nil {
		return nil, fmt.Errorf("recheck charging readiness candidate: %w", err)
	}
	if current == nil || current.Plan.Version != candidate.Plan.Version ||
		current.Decision.Kind != decision.Kind || !current.PlaceUpdatedAt.Equal(candidate.PlaceUpdatedAt) ||
		!s.now().UTC().Before(decision.ExpiresAt) {
		return nil, nil
	}
	candidate.Decision = decision
	return candidate, nil
}

// ListCandidates rechecks live evidence and plan ownership before exposing a
// persisted decision; a once-valid finding is not proof that it is still true.
func (s *Service) ListCandidates(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]port.Candidate, error) {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 || (vehicleID != nil && *vehicleID <= 0) {
		return nil, fmt.Errorf("%w: invalid subject or vehicle", ErrInvalidInput)
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if current := s.now().UTC(); current.After(now) {
		now = current
	}
	rows, err := s.repository.ListCandidates(ctx, subject, vehicleID, now, limit)
	if err != nil {
		return nil, fmt.Errorf("list charging readiness work: %w", err)
	}
	eligible := make([]port.Candidate, 0, len(rows))
	for _, row := range rows {
		decision, evalErr := s.evaluate(ctx, row.Plan)
		if evalErr != nil {
			return nil, evalErr
		}
		if decision.Reason == domain.ReasonEligible && decision.Kind == row.Decision.Kind {
			row.Decision = decision
			eligible = append(eligible, row)
		}
	}
	if len(eligible) == 0 {
		return eligible, nil
	}
	recheckAt := s.now().UTC()
	if recheckAt.Before(now) {
		recheckAt = now
	}
	current, err := s.repository.ListCandidates(ctx, subject, vehicleID, recheckAt, limit)
	if err != nil {
		return nil, fmt.Errorf("recheck charging readiness consent: %w", err)
	}
	verifiedAt := s.now().UTC()
	if verifiedAt.Before(recheckAt) {
		verifiedAt = recheckAt
	}
	versions := make(map[int64]port.Candidate, len(current))
	for _, row := range current {
		versions[row.Plan.ID] = row
	}
	result := eligible[:0]
	for _, row := range eligible {
		if latest, ok := versions[row.Plan.ID]; ok && latest.Plan.Version == row.Plan.Version &&
			latest.Decision.Kind == row.Decision.Kind &&
			latest.PlaceUpdatedAt.Equal(row.PlaceUpdatedAt) && verifiedAt.Before(row.Decision.ExpiresAt) {
			result = append(result, row)
		}
	}
	return result, nil
}

func (s *Service) evaluate(ctx context.Context, plan domain.Plan) (domain.Decision, error) {
	decision := Evaluate(plan, nil, s.now().UTC(), nil)
	if decision.Reason != domain.ReasonUnknownState {
		return decision, nil
	}
	values, err := s.live.GetAll(ctx, plan.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return domain.Decision{}, fmt.Errorf("read charging readiness signals: %w", err)
	}
	var siteErr error
	decision = Evaluate(plan, values, s.now().UTC(), func(lat, lon float64) bool {
		if plan.ChargingPlaceID == nil {
			return false
		}
		var contains bool
		contains, siteErr = s.sites.Contains(ctx, *plan.ChargingPlaceID, lat, lon)
		return contains
	})
	if siteErr != nil {
		return domain.Decision{}, fmt.Errorf("check charging readiness place: %w", siteErr)
	}
	if decision.Reason == domain.ReasonEligible && !s.now().UTC().Before(decision.ExpiresAt) {
		return domain.Decision{Reason: domain.ReasonUnknownState}, nil
	}
	return decision, nil
}

func validateScope(subject string, vehicleID int64) error {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 || vehicleID <= 0 {
		return fmt.Errorf("%w: a subject and vehicle are required", ErrInvalidInput)
	}
	return nil
}
