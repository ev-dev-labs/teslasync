package smartreadinesssvc

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

type ParkedClosures struct {
	repo    port.ParkedClosureRepository
	history *ParkedClosureHistory
	now     func() time.Time
}

func NewParkedClosures(repo port.ParkedClosureRepository, history *ParkedClosureHistory, now func() time.Time) *ParkedClosures {
	if now == nil {
		now = time.Now
	}
	return &ParkedClosures{repo: repo, history: history, now: now}
}

func validParkedClosureScope(scope port.ParkedClosureScope) bool {
	return scope.VehicleID > 0 && len(scope.Subject) <= 512 && validRecallSubject(scope.Subject)
}

func (s *ParkedClosures) Enable(ctx context.Context, scope port.ParkedClosureScope, expectedID int64, setup domain.ParkedClosureSetup) error {
	if !validParkedClosureScope(scope) {
		return port.ErrNotFound
	}
	if expectedID < 0 || !setup.Confirmed || setup.DeviceID <= 0 ||
		setup.GraceS < int(minClosureGrace/time.Second) || setup.GraceS > int(maxClosureGrace/time.Second) || setup.GraceS%300 != 0 ||
		!validCabinPushCopy(setup.PushTitle) || !validCabinPushCopy(setup.PushBody) {
		return ErrInvalidInput
	}
	return s.repo.ReplaceParkedClosure(ctx, scope, expectedID, setup, s.now().UTC().Truncate(time.Microsecond))
}

func (s *ParkedClosures) Hold(ctx context.Context, scope port.ParkedClosureScope, id int64, snooze bool) error {
	if !validParkedClosureScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	if snooze {
		until := s.now().UTC().Truncate(time.Microsecond).Add(15 * time.Minute)
		return s.repo.SetParkedClosureHold(ctx, scope, id, &until)
	}
	return s.repo.SetParkedClosureHold(ctx, scope, id, nil)
}

func (s *ParkedClosures) Clear(ctx context.Context, scope port.ParkedClosureScope, id int64) error {
	if !validParkedClosureScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteParkedClosure(ctx, scope, id)
}

func (s *ParkedClosures) Read(ctx context.Context, scope port.ParkedClosureScope) (*domain.ParkedClosurePlan, error) {
	if !validParkedClosureScope(scope) {
		return nil, port.ErrNotFound
	}
	plan, err := s.repo.ReadParkedClosure(ctx, scope)
	if err != nil || plan == nil || plan.Risk == nil {
		return plan, err
	}
	now := s.now().UTC()
	if !plan.DeviceReady || plan.Paused || !plan.Risk.ActionUntil.After(now) ||
		(plan.SnoozedUntil != nil && plan.SnoozedUntil.After(now)) {
		plan.Risk, plan.Reason = nil, domain.ClosureUnknown
		return plan, nil
	}
	risk, reason, err := s.evaluate(ctx, scope, *plan, now)
	if err != nil {
		return nil, err
	}
	if risk == nil || risk.DriveID != plan.Risk.DriveID || risk.Position != plan.Risk.Position || !risk.OpenSince.Equal(plan.Risk.OpenSince) {
		if reason == domain.ClosureAtRisk {
			reason = domain.ClosureMonitoring
		}
		plan.Risk, plan.Reason = nil, reason
		return plan, nil
	}
	plan.Risk.LastObserved = risk.LastObserved
	plan.Risk.ActionUntil = minTime(plan.Risk.ActionUntil, risk.ActionUntil)
	return plan, nil
}

func (s *ParkedClosures) CanDeliver(ctx context.Context, scope port.ParkedClosureScope, planID, deviceID, parkID int64, opened time.Time) (bool, error) {
	plan, err := s.Read(ctx, scope)
	return plan != nil && plan.ID == planID && plan.DeviceReady && plan.DeviceID == deviceID &&
		plan.Risk != nil && plan.Risk.DriveID == parkID && plan.Risk.OpenSince.Equal(opened), err
}

func (s *ParkedClosures) ProcessDue(ctx context.Context, limit int) (map[domain.ParkedClosureReason]int, error) {
	outcomes := make(map[domain.ParkedClosureReason]int)
	if limit < 1 || limit > 8 {
		return outcomes, ErrInvalidInput
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimParkedClosure(ctx, now, now.Add(30*time.Second))
		if err != nil || job == nil {
			return outcomes, err
		}
		risk, reason, err := s.evaluate(ctx, job.Scope, job.Plan, now)
		if err != nil {
			return outcomes, err
		}
		finished := s.now().UTC()
		if risk != nil && !risk.ActionUntil.After(finished) {
			risk, reason = nil, domain.ClosureUnknown
		}
		applied, err := s.repo.FinishParkedClosure(ctx, *job, reason, risk, finished)
		if err != nil {
			return outcomes, err
		}
		if applied {
			outcomes[reason]++
		}
	}
	return outcomes, nil
}

func (s *ParkedClosures) evaluate(ctx context.Context, scope port.ParkedClosureScope, plan domain.ParkedClosurePlan, now time.Time) (*domain.ParkedClosureRisk, domain.ParkedClosureReason, error) {
	if s.history == nil {
		return nil, domain.ClosureUnknown, nil
	}
	return s.history.Evaluate(ctx, scope.VehicleID, plan.EvidenceFrom, now, time.Duration(plan.GraceS)*time.Second)
}
