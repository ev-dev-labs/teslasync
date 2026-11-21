package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type monitoredPlaces interface {
	MonitoredPlace(context.Context, int64, time.Time) (func(float64, float64) bool, error)
}

type ParkedUnlocks struct {
	repo   port.ParkedUnlockRepository
	parks  recentParkSource
	places monitoredPlaces
	live   LiveSignals
	now    func() time.Time
}

func NewParkedUnlocks(repo port.ParkedUnlockRepository, parks recentParkSource, places monitoredPlaces, live LiveSignals, now func() time.Time) *ParkedUnlocks {
	if now == nil {
		now = time.Now
	}
	return &ParkedUnlocks{repo: repo, parks: parks, places: places, live: live, now: now}
}

func validParkedUnlockScope(scope port.ParkedUnlockScope) bool {
	return scope.VehicleID > 0 && len(scope.Subject) <= 512 && validRecallSubject(scope.Subject)
}

func (s *ParkedUnlocks) Enable(ctx context.Context, scope port.ParkedUnlockScope, expectedID int64, setup domain.ParkedUnlockSetup) error {
	if !validParkedUnlockScope(scope) {
		return port.ErrNotFound
	}
	if expectedID < 0 || !setup.Confirmed || setup.PlaceID <= 0 || setup.PlaceRevision.IsZero() || setup.DeviceID <= 0 ||
		!validCabinPushCopy(setup.PushTitle) || !validCabinPushCopy(setup.PushBody) {
		return ErrInvalidInput
	}
	contains, err := s.places.MonitoredPlace(ctx, setup.PlaceID, setup.PlaceRevision)
	if err != nil {
		return err
	}
	if contains == nil {
		return port.ErrParkedUnlockChanged
	}
	return s.repo.ReplaceParkedUnlock(ctx, scope, expectedID, setup, s.now().UTC().Truncate(time.Microsecond))
}

func (s *ParkedUnlocks) Hold(ctx context.Context, scope port.ParkedUnlockScope, id int64, snooze bool) error {
	if !validParkedUnlockScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	if !snooze {
		return s.repo.SetParkedUnlockHold(ctx, scope, id, nil)
	}
	until := s.now().UTC().Truncate(time.Microsecond).Add(15 * time.Minute)
	return s.repo.SetParkedUnlockHold(ctx, scope, id, &until)
}

func (s *ParkedUnlocks) Clear(ctx context.Context, scope port.ParkedUnlockScope, id int64) error {
	if !validParkedUnlockScope(scope) {
		return port.ErrNotFound
	}
	if id <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteParkedUnlock(ctx, scope, id)
}

func (s *ParkedUnlocks) Read(ctx context.Context, scope port.ParkedUnlockScope) (*domain.ParkedUnlockPlan, error) {
	if !validParkedUnlockScope(scope) {
		return nil, port.ErrNotFound
	}
	plan, err := s.repo.ReadParkedUnlock(ctx, scope)
	if err != nil || plan == nil {
		return plan, err
	}
	if !plan.PlaceReady {
		plan.Risk, plan.Reason = nil, domain.UnlockPlaceChanged
		return plan, nil
	}
	if plan.Risk == nil {
		return plan, nil
	}
	now := s.now().UTC()
	if !plan.DeviceReady || plan.Paused || !plan.Risk.ActionUntil.After(now) ||
		(plan.SnoozedUntil != nil && plan.SnoozedUntil.After(now)) {
		plan.Risk, plan.Reason = nil, domain.UnlockUnknown
		return plan, nil
	}
	risk, reason, err := s.evaluate(ctx, scope.VehicleID, *plan, now)
	if err != nil {
		return nil, err
	}
	if risk == nil || risk.DriveID != plan.Risk.DriveID || !risk.UnlockedSince.Equal(plan.Risk.UnlockedSince) {
		if reason == domain.UnlockAtRisk {
			reason = domain.UnlockMonitoring
		}
		plan.Risk, plan.Reason = nil, reason
		return plan, nil
	}
	plan.Risk.LastObserved = risk.LastObserved
	plan.Risk.ActionUntil = minTime(plan.Risk.ActionUntil, risk.ActionUntil)
	return plan, nil
}

func (s *ParkedUnlocks) CanDeliver(ctx context.Context, scope port.ParkedUnlockScope, planID, deviceID, parkID int64, unlocked time.Time) (bool, error) {
	plan, err := s.Read(ctx, scope)
	return plan != nil && plan.ID == planID && plan.DeviceReady && plan.DeviceID == deviceID &&
		plan.Risk != nil && plan.Risk.DriveID == parkID && plan.Risk.UnlockedSince.Equal(unlocked), err
}

func (s *ParkedUnlocks) ProcessDue(ctx context.Context, limit int) (map[domain.ParkedUnlockReason]int, error) {
	outcomes := make(map[domain.ParkedUnlockReason]int)
	if limit < 1 || limit > 8 {
		return outcomes, ErrInvalidInput
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimParkedUnlock(ctx, now, now.Add(30*time.Second))
		if err != nil || job == nil {
			return outcomes, err
		}
		risk, reason, err := s.evaluate(ctx, job.Scope.VehicleID, job.Plan, now)
		if err != nil {
			return outcomes, err
		}
		finished := s.now().UTC()
		if risk != nil && !risk.ActionUntil.After(finished) {
			risk, reason = nil, domain.UnlockUnknown
		}
		applied, err := s.repo.FinishParkedUnlock(ctx, *job, reason, risk, finished)
		if err != nil {
			return outcomes, err
		}
		if applied {
			outcomes[reason]++
		}
	}
	return outcomes, nil
}

func (s *ParkedUnlocks) evaluate(ctx context.Context, vehicleID int64, plan domain.ParkedUnlockPlan, now time.Time) (*domain.ParkedUnlockRisk, domain.ParkedUnlockReason, error) {
	if s.live == nil || plan.EvidenceFrom.IsZero() || plan.EvidenceFrom.After(now) {
		return nil, domain.UnlockUnknown, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	contains, err := s.places.MonitoredPlace(ctx, plan.PlaceID, plan.PlaceRevision)
	if err != nil {
		return nil, domain.UnlockUnknown, err
	}
	if contains == nil {
		return nil, domain.UnlockPlaceChanged, nil
	}
	values, err := s.live.GetAll(ctx, vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return nil, domain.UnlockUnknown, fmt.Errorf("read distributed unlock signals: %w", err)
	}
	park, err := s.parks.LatestRecentPark(ctx, vehicleID, now.Add(-parkedUnlockAge), now)
	if err != nil || park == nil {
		return nil, domain.UnlockUnknown, err
	}
	from := maxClosureTime(park.EndedAt, plan.EvidenceFrom)
	if now.Sub(from) < parkedUnlockGrace {
		return nil, domain.UnlockGrace, nil
	}
	rows, err := s.parks.RecentParkObservations(ctx, vehicleID, parkedUnlockFields[:], from, now)
	if errors.Is(err, signal.ErrTimelineEventLimit) {
		return nil, domain.UnlockUnknown, nil
	}
	if err != nil {
		return nil, domain.UnlockUnknown, err
	}
	risk, reason := parkedUnlockRisk(values, rows, park.EndedAt, plan.EvidenceFrom, now, contains)
	if risk != nil {
		risk.DriveID = park.DriveID
	}
	return risk, reason, nil
}
