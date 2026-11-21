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

type ClimateScheduleReviews struct {
	repo port.ClimateScheduleRepository
	log  cabinTimeline
	now  func() time.Time
}

func NewClimateScheduleReviews(repo port.ClimateScheduleRepository, log cabinTimeline, now func() time.Time) *ClimateScheduleReviews {
	if now == nil {
		now = time.Now
	}
	return &ClimateScheduleReviews{repo: repo, log: log, now: now}
}

func (s *ClimateScheduleReviews) Read(ctx context.Context, scope port.ClimateScheduleScope) (domain.ClimateScheduleSettings, error) {
	if scope.VehicleID <= 0 || !validRecallSubject(scope.Subject) {
		return domain.ClimateScheduleSettings{}, port.ErrNotFound
	}
	return s.repo.ReadClimateSchedule(ctx, scope, s.now())
}

func (s *ClimateScheduleReviews) Enable(ctx context.Context, scope port.ClimateScheduleScope, expectedID, automationID int64, revision time.Time) error {
	if scope.VehicleID <= 0 || !validRecallSubject(scope.Subject) {
		return port.ErrNotFound
	}
	if expectedID < 0 || automationID <= 0 || revision.IsZero() {
		return ErrInvalidInput
	}
	return s.repo.ReplaceClimateSchedule(ctx, scope, expectedID, automationID, revision, s.now())
}

func (s *ClimateScheduleReviews) Disable(ctx context.Context, scope port.ClimateScheduleScope, expectedID int64) error {
	if scope.VehicleID <= 0 || !validRecallSubject(scope.Subject) {
		return port.ErrNotFound
	}
	if expectedID <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteClimateSchedule(ctx, scope, expectedID)
}

func (s *ClimateScheduleReviews) List(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]port.ClimateScheduleCandidate, error) {
	if !validRecallSubject(subject) || limit < 1 {
		return nil, nil
	}
	return s.repo.ListClimateScheduleReviews(ctx, subject, vehicleID, now, min(limit, 100))
}

type ClimateScheduleBatch struct {
	Checked   int
	Matched   int
	Quiet     int
	Changed   int
	Published int
}

func (s *ClimateScheduleReviews) ProcessDue(ctx context.Context, limit int) (ClimateScheduleBatch, error) {
	var batch ClimateScheduleBatch
	if s.log == nil || limit < 1 || limit > 20 {
		return batch, ErrInvalidInput
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.ClaimClimateSchedule(ctx, now, now.Add(5*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		batch.Checked++
		review, err := s.evaluate(ctx, *job, now)
		if err != nil {
			return batch, err
		}
		finished, err := s.repo.FinishClimateSchedule(ctx, *job, s.now(), now.Add(6*time.Hour), review)
		if err != nil {
			return batch, err
		}
		switch {
		case !finished.Applied:
			batch.Changed++
		case review != nil:
			batch.Matched++
		default:
			batch.Quiet++
		}
		if finished.Published {
			batch.Published++
		}
	}
	return batch, nil
}

func (s *ClimateScheduleReviews) evaluate(ctx context.Context, job port.DueClimateSchedule, now time.Time) (*domain.ClimateScheduleEvidence, error) {
	loc, err := time.LoadLocation(job.TimeZone)
	if err != nil {
		return nil, nil
	}
	local := now.In(loc)
	y, m, d := local.Date()
	startOfWeek := time.Date(y, m, d, 0, 0, 0, 0, loc).AddDate(0, 0, -((int(local.Weekday()) + 6) % 7))
	runs, err := s.repo.ClimateScheduleRuns(ctx, job, now.Add(-climateScheduleLookback), now.Add(-climateScheduleWatch))
	if err != nil || len(runs) < climateScheduleMinRuns {
		return nil, err
	}
	type slot struct{ day, minute int }
	group := func(t time.Time) slot {
		l := t.In(loc)
		return slot{int(l.Weekday()), l.Hour()*60 + l.Minute()}
	}
	recent := make(map[slot]bool)
	counts := make(map[slot]int)
	for _, run := range runs {
		key := group(run.FiredAt)
		if !run.FiredAt.Add(climateScheduleWatch).Before(startOfWeek) {
			recent[key] = true
		}
		counts[key]++
	}
	fields := make([]signal.FieldMapping, 0, 6)
	for _, name := range []string{cabinGear, cabinHVAC, cabinOverheat, cabinInterior, climateScheduleOdometer, climateScheduleBattery} {
		fields = append(fields, signal.FieldMapping{Signal: name, Field: name})
	}
	observations := make([]domain.ClimateScheduleObservation, 0, len(runs))
	for _, run := range runs {
		key := group(run.FiredAt)
		if !recent[key] || counts[key] < climateScheduleMinRuns || !climateScheduleRunValid(run, now) {
			continue
		}
		rows, err := s.log.Timeline(ctx, job.VehicleID, fields, run.FiredAt.Add(-climateScheduleSampleGap),
			run.FiredAt.Add(climateScheduleWatch),
			signal.TimelineOptions{MaxEvents: 1000, TrackSourceTime: true, IncludeInitialState: true})
		if errors.Is(err, signal.ErrTimelineEventLimit) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read observed scheduled climate runs: %w", err)
		}
		if observation := observedClimateScheduleRun(rows, run, now); observation != nil {
			observations = append(observations, *observation)
		}
	}
	review := summarizeClimateSchedule(observations, now, loc)
	if review == nil {
		return nil, nil
	}
	evidence := &domain.ClimateScheduleEvidence{
		WeekOf: review.WeekOf, ExpiresAt: review.ExpiresAt, ObservedThrough: review.Observations[0].VerifiedTo,
		RunTimes: make([]time.Time, 0, len(review.Observations)),
	}
	for _, observation := range review.Observations {
		evidence.RunTimes = append(evidence.RunTimes, observation.FiredAt)
	}
	return evidence, nil
}
