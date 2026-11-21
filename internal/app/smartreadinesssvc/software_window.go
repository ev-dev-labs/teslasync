package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

const (
	softwareReviewMargin   = 30 * time.Minute
	softwareIdleMinimum    = time.Minute
	softwareParkLookback   = 30 * time.Minute
	softwareDepartureLimit = 24 * time.Hour
	softwareCheckLifetime  = 5 * time.Minute
)

var softwareIdleFields = []string{"Gear", "ServiceMode", "DriverSeatOccupied", "DetailedChargeState"}
var softwareUpdateFields = []string{"SoftwareUpdateInProgress", "SoftwareUpdateScheduledStartTime",
	"SoftwareUpdateAvailable", "SoftwareUpdateVersion", "SoftwareUpdateDownloadPercentComplete"}
var softwareWindowFields = slices.Concat(softwareIdleFields, softwareUpdateFields)
var softwareVersion = regexp.MustCompile(`^[0-9]{4}\.[0-9]{1,3}\.[0-9]{1,4}(\.[0-9]{1,4}){0,3}$`)

type SoftwareWindows struct {
	repo  port.SoftwareWindowRepository
	parks recentParkSource
	live  LiveSignals
	now   func() time.Time
}

func NewSoftwareWindows(repo port.SoftwareWindowRepository, parks recentParkSource, live LiveSignals, now func() time.Time) *SoftwareWindows {
	if now == nil {
		now = time.Now
	}
	return &SoftwareWindows{repo: repo, parks: parks, live: live, now: now}
}

func (s *SoftwareWindows) Available() bool { return s.live != nil }

func validSoftwareWindowScope(scope port.SoftwareWindowScope) bool {
	return scope.VehicleID > 0 && len(scope.Subject) <= 512 && validRecallSubject(scope.Subject)
}

func (s *SoftwareWindows) Enable(ctx context.Context, scope port.SoftwareWindowScope, expectedID int64, setup domain.SoftwareWindowSetup) error {
	if !validSoftwareWindowScope(scope) {
		return port.ErrNotFound
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	setup.DepartureAt = setup.DepartureAt.UTC().Truncate(time.Microsecond)
	if expectedID < 0 || !setup.CheckedReadyUnscheduled || !softwareVersion.MatchString(setup.Version) ||
		setup.EstimatedDurationS < 60 || setup.EstimatedDurationS > 43200 ||
		!setup.DepartureAt.After(now.Add(softwareReviewMargin)) || setup.DepartureAt.After(now.Add(softwareDepartureLimit)) {
		return ErrInvalidInput
	}
	return s.repo.ReplaceSoftwareWindow(ctx, scope, expectedID, setup, now)
}

func (s *SoftwareWindows) Hold(ctx context.Context, scope port.SoftwareWindowScope, expectedID int64, snooze bool) error {
	if !validSoftwareWindowScope(scope) {
		return port.ErrNotFound
	}
	if expectedID <= 0 {
		return ErrInvalidInput
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	if !snooze {
		return s.repo.HoldSoftwareWindow(ctx, scope, expectedID, nil, now)
	}
	until := now.Add(2 * time.Minute)
	return s.repo.HoldSoftwareWindow(ctx, scope, expectedID, &until, now)
}

func (s *SoftwareWindows) Clear(ctx context.Context, scope port.SoftwareWindowScope, expectedID int64) error {
	if !validSoftwareWindowScope(scope) {
		return port.ErrNotFound
	}
	if expectedID <= 0 {
		return ErrInvalidInput
	}
	return s.repo.DeleteSoftwareWindow(ctx, scope, expectedID)
}

func (s *SoftwareWindows) Read(ctx context.Context, scope port.SoftwareWindowScope) (*domain.SoftwareWindowPlan, error) {
	if !validSoftwareWindowScope(scope) {
		return nil, port.ErrNotFound
	}
	plan, err := s.repo.ReadSoftwareWindow(ctx, scope)
	if err != nil || plan == nil {
		return plan, err
	}
	now := s.now().UTC()
	switch {
	case !plan.DepartureAt.After(now):
		plan.Reason = domain.SoftwareWindowExpired
	case plan.Paused || (plan.SnoozedUntil != nil && plan.SnoozedUntil.After(now)):
		plan.Reason = domain.SoftwareWindowHeld
	case s.live == nil || !plan.ConfirmedAt.Add(softwareCheckLifetime).After(now):
		plan.Reason = domain.SoftwareWindowNoEvidence
	default:
		ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := s.evaluate(ctx, plan, now); err != nil {
			return nil, err
		}
	}
	if plan.Review != nil {
		checkAt := s.now().UTC()
		ok, err := s.repo.CheckSoftwareWindow(ctx, scope, plan.ID, plan.Review.ParkedAt, checkAt)
		if err != nil {
			return nil, err
		}
		if !ok {
			current, err := s.repo.ReadSoftwareWindow(ctx, scope)
			if current != nil {
				current.Reason = domain.SoftwareWindowNoEvidence
			}
			return current, err
		}
		if !plan.Review.ActionUntil.After(checkAt) {
			plan.Reason, plan.Review = domain.SoftwareWindowTooShort, nil
		}
	}
	return plan, nil
}

func (s *SoftwareWindows) evaluate(ctx context.Context, plan *domain.SoftwareWindowPlan, now time.Time) error {
	values, err := s.live.GetAll(ctx, plan.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return fmt.Errorf("read distributed software window state: %w", err)
	}
	if liveSoftwareConflict(values, *plan, now) {
		plan.Reason = domain.SoftwareWindowNotReady
		return nil
	}
	duration := time.Duration(plan.EstimatedDurationS) * time.Second
	latestStart := plan.DepartureAt.Add(-duration - softwareReviewMargin)
	if !latestStart.After(now) {
		plan.Reason = domain.SoftwareWindowTooShort
		return nil
	}
	plan.Reason = domain.SoftwareWindowNotIdle
	park, err := s.parks.LatestRecentPark(ctx, plan.VehicleID, now.Add(-softwareParkLookback), now)
	if err != nil || park == nil || park.DriveID <= 0 {
		return err
	}
	rows, err := s.parks.RecentParkObservations(ctx, plan.VehicleID, softwareWindowFields, minTime(park.EndedAt, plan.ConfirmedAt), now)
	if errors.Is(err, signal.ErrTimelineEventLimit) {
		return nil
	}
	if err != nil {
		return err
	}
	if recordedSoftwareConflict(rows, *plan) {
		plan.Reason = domain.SoftwareWindowNotReady
		return nil
	}
	latest, err := s.live.GetAll(ctx, plan.VehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return fmt.Errorf("recheck distributed software window state: %w", err)
	}
	if liveSoftwareConflict(latest, *plan, s.now().UTC()) {
		plan.Reason = domain.SoftwareWindowNotReady
		return nil
	}
	from, last, expires, ok := observedSoftwareIdle(latest, rows, park.EndedAt, now)
	if !ok {
		return nil
	}
	plan.Reason = domain.SoftwareWindowFits
	plan.Review = &domain.SoftwareWindowReview{
		MarginS:  int(softwareReviewMargin / time.Second),
		ParkedAt: park.EndedAt, IdleObservedFrom: from, LastIdleObservedAt: last, UpdateObservedAt: plan.ConfirmedAt,
		ActionUntil: minTime(latestStart, minTime(expires, plan.ConfirmedAt.Add(softwareCheckLifetime))),
	}
	return nil
}

func liveSoftwareConflict(values map[string]*signal.Value, plan domain.SoftwareWindowPlan, now time.Time) bool {
	for _, field := range softwareUpdateFields {
		value := values[field]
		if value == nil || value.TimestampSynthetic || value.Timestamp.IsZero() || value.Timestamp.After(now) {
			continue
		}
		if value.Timestamp.Before(plan.ConfirmedAt) &&
			((field != "SoftwareUpdateInProgress" && field != "SoftwareUpdateScheduledStartTime") || !freshObservation(value, now)) {
			continue
		}
		if softwareFieldConflicts(field, value.Raw, plan.Version) {
			return true
		}
	}
	return false
}

func recordedSoftwareConflict(rows []signal.TimelineRow, plan domain.SoftwareWindowPlan) bool {
	active := make(map[string]bool, len(softwareUpdateFields))
	for _, row := range rows {
		if row.Timestamp.Before(plan.ConfirmedAt) {
			continue
		}
		for _, field := range softwareUpdateFields {
			// A missing group receipt vetoes joint idle evidence, not individually attested conflicts.
			if value, attested := row.Fields[field]; attested && row.ObservedAt[field].Equal(row.Timestamp) {
				active[field] = softwareFieldConflicts(field, value, plan.Version)
			}
		}
	}
	return slices.ContainsFunc(softwareUpdateFields, func(field string) bool { return active[field] })
}

func softwareFieldConflicts(field string, raw signal.SignalValue, version string) bool {
	switch field {
	case "SoftwareUpdateInProgress":
		return raw != false
	case "SoftwareUpdateScheduledStartTime":
		return raw != ""
	case "SoftwareUpdateAvailable":
		return raw != true
	case "SoftwareUpdateVersion":
		return raw != version
	default:
		percent, ok := signal.Float64(raw)
		return !ok || percent != 100
	}
}

func softwareIdleField(field string, raw any) bool {
	switch field {
	case "Gear":
		return raw == enums.GearPark
	case "DetailedChargeState":
		s, _ := raw.(string)
		state, err := protomodel.ParseDetailedChargeStateValue(s)
		return err == nil && state == protomodel.DetailedChargeStateValue_DetailedChargeStateDisconnected
	default:
		return raw == false
	}
}

func observedSoftwareIdle(values map[string]*signal.Value, rows []signal.TimelineRow, parked, now time.Time) (from, last, expires time.Time, ok bool) {
	oldest := now
	for _, field := range softwareIdleFields {
		value := values[field]
		if !freshObservation(value, now) || value.Timestamp.Before(parked) || !softwareIdleField(field, value.Raw) {
			return time.Time{}, time.Time{}, time.Time{}, false
		}
		oldest = minTime(oldest, value.Timestamp)
		last = lastOr(last, value.Timestamp)
	}
	attested := make(map[string]time.Time, len(softwareIdleFields))
	for _, row := range rows {
		if row.Timestamp.Before(parked) || row.Timestamp.After(now) {
			continue
		}
		for _, field := range softwareIdleFields {
			if !row.ObservedAt[field].Equal(row.Timestamp) {
				continue
			}
			if row.ReceivedAt == nil || !softwareIdleField(field, row.Fields[field]) {
				delete(attested, field)
				continue
			}
			attested[field] = row.Timestamp
		}
	}
	for _, field := range softwareIdleFields {
		if !attested[field].Equal(values[field].Timestamp) {
			return time.Time{}, time.Time{}, time.Time{}, false
		}
		from = lastOr(from, attested[field])
	}
	return from, last, oldest.Add(signal.LiveSignalFreshnessThreshold), now.Sub(from) >= softwareIdleMinimum
}

func lastOr(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
