package smartcommutesvc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
)

var ErrInvalidInput = errors.New("invalid smart commute input")

type Service struct {
	repository         port.Repository
	traceReader        trafficTraceReader
	trafficConfigured  bool
	traffic            trafficEvaluation
	navigation         *navigation
	navigationObserver func(domain.NavigationOutcome)
	now                func() time.Time
}

type Option func(*Service)

func WithClock(now func() time.Time) Option {
	if now == nil {
		panic("smartcommutesvc.WithClock: clock must not be nil")
	}
	return func(service *Service) { service.now = now }
}

func New(repository port.Repository, options ...Option) *Service {
	if repository == nil {
		panic("smartcommutesvc.New: repository must not be nil")
	}
	service := &Service{repository: repository, now: func() time.Time { return time.Now().UTC() }}
	for _, option := range options {
		option(service)
	}
	return service
}

func (s *Service) Get(ctx context.Context, subject string, vehicleID int64) (*domain.Snapshot, error) {
	if err := validateScope(subject, vehicleID); err != nil {
		return nil, err
	}
	now := s.now()
	result, err := s.repository.Read(ctx, subject, vehicleID, now)
	if err != nil {
		return nil, err
	}
	result.TrafficAvailable = s.trafficConfigured
	result.TrafficDecisions = make([]domain.TrafficDecision, 0)
	if s.trafficConfigured && result.Settings.Enabled && result.Settings.LocalAnalysisEnabled && !result.Settings.Paused {
		result.TrafficDecisions, err = s.ListTrafficDecisions(ctx, subject, &vehicleID, now, 10)
		if err == nil && len(result.TrafficDecisions) > 0 {
			result.NavigationAvailable = s.navigationAvailable(ctx, subject)
		}
	}
	return result, err
}

func (s *Service) SaveSettings(ctx context.Context, subject string, settings domain.Settings) error {
	if err := validateScope(subject, settings.VehicleID); err != nil {
		return err
	}
	if (!settings.Enabled && (settings.LocalAnalysisEnabled || settings.Paused)) ||
		(settings.Enabled && !validTimeZone(settings.TimeZone)) {
		return fmt.Errorf("%w: select a valid time zone and compatible settings", ErrInvalidInput)
	}
	return s.repository.SaveSettings(ctx, subject, settings, s.now(), analyze)
}

func (s *Service) Analyze(ctx context.Context, subject string, vehicleID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	return s.repository.Analyze(ctx, subject, vehicleID, s.now(), analyze)
}

func (s *Service) CreateRoutine(ctx context.Context, subject string, input domain.RoutineInput) (*domain.Routine, error) {
	if err := validateRoutine(subject, &input); err != nil {
		return nil, err
	}
	return s.repository.CreateRoutine(ctx, subject, input, s.now())
}

func (s *Service) ConfirmRoutine(ctx context.Context, subject string, routineID int64, input domain.RoutineInput) (*domain.Routine, error) {
	if err := validateRoutine(subject, &input); err != nil {
		return nil, err
	}
	if routineID <= 0 {
		return nil, fmt.Errorf("%w: routine ID is required", ErrInvalidInput)
	}
	return s.repository.ConfirmRoutine(ctx, subject, routineID, input, s.now())
}

func (s *Service) DeclineRoutine(ctx context.Context, subject string, vehicleID, routineID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if routineID <= 0 {
		return fmt.Errorf("%w: routine ID is required", ErrInvalidInput)
	}
	return s.repository.DeclineRoutine(ctx, subject, vehicleID, routineID, s.now())
}

func (s *Service) SnoozeRoutine(ctx context.Context, subject string, vehicleID, routineID, durationS int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if routineID <= 0 || durationS < 0 || durationS > 30*24*60*60 {
		return fmt.Errorf("%w: invalid suggestion or snooze duration", ErrInvalidInput)
	}
	now := s.now()
	var until *time.Time
	if durationS > 0 {
		value := now.Add(time.Duration(durationS) * time.Second)
		until = &value
	}
	return s.repository.SnoozeRoutine(ctx, subject, vehicleID, routineID, until, now)
}

func (s *Service) DeleteRoutine(ctx context.Context, subject string, vehicleID, routineID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if routineID <= 0 {
		return fmt.Errorf("%w: routine ID is required", ErrInvalidInput)
	}
	return s.repository.DeleteRoutine(ctx, subject, vehicleID, routineID)
}

func (s *Service) DeleteAll(ctx context.Context, subject string, vehicleID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	return s.repository.DeleteAll(ctx, subject, vehicleID)
}

func (s *Service) ListSuggestions(
	ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int,
) ([]domain.SuggestedRoutine, error) {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 || (vehicleID != nil && *vehicleID <= 0) {
		return nil, fmt.Errorf("%w: invalid subject or vehicle", ErrInvalidInput)
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repository.ListSuggestions(ctx, subject, vehicleID, now, limit)
}

func validateScope(subject string, vehicleID int64) error {
	if strings.TrimSpace(subject) == "" || len(subject) > 512 || vehicleID <= 0 {
		return fmt.Errorf("%w: a subject and vehicle are required", ErrInvalidInput)
	}
	return nil
}

func validateRoutine(subject string, input *domain.RoutineInput) error {
	if err := validateScope(subject, input.VehicleID); err != nil {
		return err
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || len([]rune(input.Name)) > 120 ||
		input.Weekday < time.Sunday || input.Weekday > time.Saturday ||
		input.DepartureS < 0 || input.DepartureS >= 24*60*60 ||
		!validTimeZone(input.TimeZone) || !validPoint(input.Origin) || !validPoint(input.Destination) {
		return fmt.Errorf("%w: provide a name, weekday, local time, time zone and valid endpoints", ErrInvalidInput)
	}
	return nil
}

func validTimeZone(value string) bool {
	if value == "" || value == "Local" || len(value) > 128 {
		return false
	}
	_, err := time.LoadLocation(value)
	return err == nil
}

func analyze(
	observations []domain.DriveObservation,
	existing []domain.Routine,
	now time.Time,
	loc *time.Location,
) port.Analysis {
	result := port.Analysis{}
	for _, learned := range Learn(observations, now, loc) {
		var suggestedID int64
		suppressed := false
		for _, routine := range existing {
			if routine.TimeZone != loc.String() || routine.Weekday != learned.Weekday ||
				abs(routine.DepartureS-learned.DepartureS) > learningWindowS ||
				!near(routine.Origin, learned.Origin) || !near(routine.Destination, learned.Destination) {
				continue
			}
			if routine.Status == domain.RoutineDeclined || routine.Status == domain.RoutineConfirmed {
				suppressed = true
				break
			}
			if routine.Status == domain.RoutineSuggested {
				suggestedID = routine.ID
			}
		}
		if suppressed {
			continue
		}
		if suggestedID != 0 {
			result.Refreshed = append(result.Refreshed, port.RefreshedSuggestion{ID: suggestedID, Learned: learned})
		} else {
			result.New = append(result.New, learned)
		}
	}
	return result
}

func abs(value int) int {
	if value < 0 {
		return -value
	}
	return value
}
