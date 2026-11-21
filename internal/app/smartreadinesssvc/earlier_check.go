package smartreadinesssvc

import (
	"context"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func (s *Service) AdvanceCheck(
	ctx context.Context, key domain.StopPlanKey, version int64, previous, proposed, previewExpiry time.Time,
) error {
	if err := validateScope(key.Subject, key.VehicleID); err != nil || key.PlanID <= 0 ||
		version <= 0 || previous.IsZero() || proposed.IsZero() || previewExpiry.IsZero() {
		return ErrInvalidInput
	}
	scoped, err := s.repository.ReadEarlierCheckPlan(ctx, key)
	if err != nil {
		return err
	}
	plan := scoped.Plan
	now := s.now().UTC()
	if plan.Version != version || !plan.NotifyAt.Equal(previous) || !now.Before(previewExpiry) ||
		!now.Before(proposed) || !proposed.Before(previous) || !plan.Enabled ||
		(plan.SnoozedUntil != nil && now.Before(*plan.SnoozedUntil)) {
		return port.ErrEarlierCheck
	}
	values, err := s.live.GetAll(ctx, key.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return fmt.Errorf("read earlier charging check signals: %w", err)
	}
	estimate, err := s.estimateLatestStart(ctx, plan, values)
	if err != nil {
		return err
	}
	now = s.now().UTC()
	checkAt := earlierCheckAt(plan, estimate, now)
	if !proposed.Equal(checkAt) || !now.Before(previewExpiry) {
		return port.ErrEarlierCheck
	}
	expiry := *estimate.ExpiresAt
	if previewExpiry.Before(expiry) {
		expiry = previewExpiry
	}
	ctx, cancel := context.WithTimeout(ctx, min(expiry.Sub(now), proposed.Sub(now)))
	defer cancel()
	return s.repository.AdvanceCheck(ctx, scoped, proposed.UTC(), now, expiry)
}

func earlierCheckAt(plan domain.Plan, estimate domain.LatestStart, now time.Time) time.Time {
	if estimate.Status != domain.LatestStartEstimate || estimate.EarliestSafeStartAt == nil ||
		estimate.ExpiresAt == nil || !now.Before(*estimate.ExpiresAt) {
		return time.Time{}
	}
	checkAt := estimate.EarliestSafeStartAt.Add(-15 * time.Minute)
	cutoff := plan.DepartureAt.Add(-minimumRemedyTime - time.Minute)
	if cutoff.Before(checkAt) {
		checkAt = cutoff
	}
	checkAt = checkAt.UTC().Truncate(time.Minute)
	if !now.Before(checkAt) || !checkAt.Before(plan.NotifyAt) {
		return time.Time{}
	}
	return checkAt
}
