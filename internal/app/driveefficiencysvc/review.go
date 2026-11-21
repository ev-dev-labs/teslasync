package driveefficiencysvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveevidence"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/driveefficiency"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/driveefficiency"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

var (
	ErrInvalid = errors.New("invalid private efficiency review settings")
	ErrParked  = errors.New("private efficiency review requires fresh parked evidence")
)

type TimelineReader interface {
	Timeline(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error)
}

type MotionReader interface {
	GetAll(context.Context, int64, signal.LiveSignalReadPreference) (map[string]*signal.Value, error)
}

type Reviews struct {
	repo  port.Repository
	trace TimelineReader
	live  MotionReader
	now   func() time.Time
}

func (s *Reviews) WithMotion(reader MotionReader) *Reviews {
	s.live = reader
	return s
}

func NewReviews(repo port.Repository, trace TimelineReader, now func() time.Time) *Reviews {
	if now == nil {
		now = time.Now
	}
	return &Reviews{repo: repo, trace: trace, now: now}
}

func validScope(s port.Scope) bool {
	return s.VehicleID > 0 && s.Subject != "" && len(s.Subject) <= 512 &&
		s.Subject != personal.OpenSubject && s.Subject != "open-mode" && s.Subject == strings.TrimSpace(s.Subject)
}

func (s *Reviews) Read(ctx context.Context, scope port.Scope) (port.State, error) {
	if !validScope(scope) {
		return port.State{}, port.ErrNotFound
	}
	state, err := s.repo.Read(ctx, scope, s.now())
	if err == nil {
		state.ReviewAllowedUntil = s.parkedUntil(ctx, scope.VehicleID)
	}
	return state, err
}

func (s *Reviews) parkedUntil(ctx context.Context, vehicleID int64) *time.Time {
	if s.live == nil {
		return nil
	}
	values, err := s.live.GetAll(ctx, vehicleID, signal.LiveSignalReadDistributed)
	now := s.now().UTC()
	fresh := func(value *signal.Value) bool {
		return value != nil && !value.TimestampSynthetic && !value.Timestamp.After(now) &&
			now.Before(value.Timestamp.Add(signal.LiveSignalFreshnessThreshold))
	}
	gear := values["Gear"]
	if err != nil || !fresh(gear) || gear.Raw != enums.GearPark {
		return nil
	}
	if speed := values["VehicleSpeed"]; fresh(speed) {
		if value, ok := signal.Float64(speed.Raw); ok && value > 0 {
			return nil
		}
	}
	until := gear.Timestamp.UTC().Add(signal.LiveSignalFreshnessThreshold)
	return &until
}

func (s *Reviews) requireParked(ctx context.Context, scope port.Scope) error {
	if _, err := s.repo.Read(ctx, scope, s.now()); err != nil {
		return err
	}
	if s.parkedUntil(ctx, scope.VehicleID) == nil {
		return ErrParked
	}
	return nil
}

func (s *Reviews) Save(ctx context.Context, scope port.Scope, p domain.Settings) error {
	if !validScope(scope) || p.Revision < 0 || p.Paused && p.Revision == 0 {
		return ErrInvalid
	}
	p.NextCheckAt = nil
	if !p.Paused {
		if p.TimeZone == "" || p.TimeZone == "Local" || len(p.TimeZone) > 80 {
			return ErrInvalid
		}
		loc, err := time.LoadLocation(p.TimeZone)
		if err != nil {
			return ErrInvalid
		}
		if err := s.requireParked(ctx, scope); err != nil {
			return err
		}
		now := s.now().In(loc)
		week := domain.Week(now)
		first := week.Release
		if !now.Before(first) {
			first = week.NextRelease
		}
		p.NextCheckAt = &first
	}
	return s.repo.Replace(ctx, scope, p)
}

func (s *Reviews) Clear(ctx context.Context, scope port.Scope, revision int64) error {
	if !validScope(scope) || revision <= 0 {
		return ErrInvalid
	}
	return s.repo.Delete(ctx, scope, revision)
}

func (s *Reviews) Dismiss(ctx context.Context, scope port.Scope, revision int64, until time.Time) error {
	if !validScope(scope) || revision <= 0 || until.IsZero() {
		return ErrInvalid
	}
	if err := s.requireParked(ctx, scope); err != nil {
		return err
	}
	return s.repo.Dismiss(ctx, scope, revision, until, s.now())
}

type Batch struct {
	Outcomes  map[domain.Reason]int
	Published int
}

func (s *Reviews) ProcessDue(ctx context.Context, limit int) (Batch, error) {
	batch := Batch{Outcomes: make(map[domain.Reason]int)}
	if s.trace == nil || limit < 1 || limit > 8 {
		return batch, ErrInvalid
	}
	for range limit {
		now := s.now().UTC().Truncate(time.Microsecond)
		job, err := s.repo.Claim(ctx, now, now.Add(5*time.Minute))
		if err != nil || job == nil {
			return batch, err
		}
		loc, err := time.LoadLocation(job.TimeZone)
		if err != nil {
			return batch, fmt.Errorf("load recorded efficiency review zone: %w", err)
		}
		week := domain.Week(now.In(loc))
		next, reason := week.NextRelease, domain.StaleWeek
		cycle := week.RecentUntil.Format(time.DateOnly)
		var digest *domain.Digest
		switch {
		case now.Before(week.Release):
			next, cycle = week.Release, ""
		case cycle <= job.LastWeek || !now.Before(week.Release.AddDate(0, 0, 1)):
			// An expired or already reviewed week needs no history read.
		default:
			digest, reason, err = s.review(ctx, *job, week, now)
			if err != nil {
				return batch, err
			}
		}
		batch.Outcomes[reason]++
		published, err := s.repo.Finish(ctx, *job, s.now(), next, cycle, digest)
		if err != nil {
			return batch, err
		}
		if published {
			batch.Published++
		}
	}
	return batch, nil
}

func (s *Reviews) review(ctx context.Context, j port.Job, w domain.Window, now time.Time) (*domain.Digest, domain.Reason, error) {
	if !validScope(j.Scope) {
		return nil, domain.Revoked, nil
	}
	drives, err := s.repo.Drives(ctx, j, w, now, maxDriveObservations+1)
	if err != nil {
		return nil, "", err
	}
	if len(drives) < 8 || len(drives) > maxDriveObservations {
		return nil, domain.Insufficient, nil
	}
	reports := make([]observation, 0, len(drives))
	for _, d := range drives {
		current, err := s.repo.Current(ctx, j, s.now())
		if err != nil {
			return nil, "", err
		}
		if !current {
			return nil, domain.Revoked, nil
		}
		rows, err := s.trace.Timeline(ctx, j.VehicleID, []signal.FieldMapping{
			{Signal: "LocationLatitude", Field: "latitude"}, {Signal: "LocationLongitude", Field: "longitude"},
			{Signal: "OutsideTemp", Field: "outside_c"}, {Signal: "PackVoltage", Field: "voltage"},
			{Signal: "PackCurrent", Field: "current"},
		}, d.StartedAt.Add(-driveevidence.PackObservationFreshness), d.EndedAt, signal.TimelineOptions{MaxEvents: 20_000})
		if errors.Is(err, signal.ErrTimelineEventLimit) {
			continue
		}
		if err != nil {
			return nil, "", fmt.Errorf("read measured efficiency observations: %w", err)
		}
		path, pathOK := driveevidence.RecordedPath(rows, d.StartedAt, d.EndedAt)
		outside, temperatureOK := driveevidence.OutsideTemperature(rows, d.StartedAt, d.EndedAt)
		if !pathOK || !temperatureOK {
			continue
		}
		pack := driveevidence.IntegratePackEnergy(rows, d.StartedAt, d.EndedAt)
		reports = append(reports, observation{
			id: d.ID, start: d.StartedAt, end: d.EndedAt, distanceM: d.DistanceM, ambientC: outside,
			progressMps: d.DistanceM / d.EndedAt.Sub(d.StartedAt).Seconds(),
			netWh:       pack.DrawWh - pack.RegenWh, coveredS: pack.CoveredS, path: path,
		})
	}
	digest, reason := evaluate(w, reports)
	return digest, reason, nil
}
