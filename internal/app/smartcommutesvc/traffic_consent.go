package smartcommutesvc

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type trafficTraceReader interface {
	Timeline(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error)
}

func WithTrafficTraceReader(reader trafficTraceReader) Option {
	return func(s *Service) { s.traceReader = reader }
}

func WithTrafficConnector(available bool) Option {
	return func(s *Service) { s.trafficConfigured = available }
}

func (s *Service) PreviewTrafficTrace(ctx context.Context, subject string, vehicleID, routineID, driveID int64) (*domain.TrafficPreview, error) {
	preview, _, err := s.previewTrafficTrace(ctx, subject, vehicleID, routineID, driveID, s.now())
	return preview, err
}

func (s *Service) SaveTrafficConsent(ctx context.Context, subject string, input domain.TrafficConsentInput) error {
	if !input.ShareWithHERE || len(input.Fingerprint) != sha256.Size*2 ||
		input.LeadS < minTrafficLeadS || input.LeadS > maxTrafficLeadS ||
		input.MinSavingsS < minTrafficSavingsS || input.MinSavingsS > maxTrafficSavingsS {
		return ErrInvalidInput
	}
	now := s.now()
	preview, drive, err := s.previewTrafficTrace(ctx, subject, input.VehicleID, input.RoutineID, input.DriveID, now)
	if err != nil {
		return err
	}
	if preview.Fingerprint != input.Fingerprint {
		return port.ErrTrafficPreviewChanged
	}
	if input.ArrivalDeadlineS != nil {
		if _, ok := deadlineOffset(drive.Routine.DepartureS, *input.ArrivalDeadlineS); !ok {
			return ErrInvalidInput
		}
	}
	window, ok := nextTrafficWindow(drive.Settings, drive.Routine, input.LeadS, now)
	if !ok {
		return port.ErrDisabled
	}
	return s.repository.SaveTrafficConsent(ctx, subject, drive.Routine, domain.TrafficConsent{
		Trace: preview.Trace, LeadS: input.LeadS, MinSavingsS: input.MinSavingsS, ArrivalDeadlineS: input.ArrivalDeadlineS,
		CompareRouteEnergy: input.CompareRouteEnergy, CheckAt: window.checkAt, DepartureAt: window.departureAt,
	}, now)
}

func (s *Service) DeleteTrafficConsent(ctx context.Context, subject string, vehicleID, routineID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if routineID <= 0 {
		return ErrInvalidInput
	}
	return s.repository.DeleteTrafficConsent(ctx, subject, vehicleID, routineID)
}

func (s *Service) SkipTrafficToday(ctx context.Context, subject string, vehicleID, routineID int64) error {
	if err := validateScope(subject, vehicleID); err != nil {
		return err
	}
	if routineID <= 0 {
		return ErrInvalidInput
	}
	return s.repository.SkipTrafficToday(ctx, subject, vehicleID, routineID, s.now())
}

func (s *Service) previewTrafficTrace(ctx context.Context, subject string, vehicleID, routineID, driveID int64, now time.Time) (
	*domain.TrafficPreview, *port.TrafficDrive, error,
) {
	if err := validateScope(subject, vehicleID); err != nil {
		return nil, nil, err
	}
	if routineID <= 0 || driveID <= 0 {
		return nil, nil, ErrInvalidInput
	}
	if !s.trafficConfigured || s.traceReader == nil {
		return nil, nil, port.ErrTrafficTraceUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	drive, err := s.repository.FindTrafficDrive(ctx, subject, vehicleID, routineID, driveID, now)
	if err != nil {
		return nil, nil, err
	}
	if !drive.EndedAt.After(drive.StartedAt) || drive.EndedAt.Sub(drive.StartedAt) > maxTrafficDriveDuration {
		return nil, nil, port.ErrTrafficTraceUnavailable
	}
	rows, err := s.traceReader.Timeline(ctx, vehicleID, []signal.FieldMapping{
		{Signal: "LocationLatitude", Field: "latitude"}, {Signal: "LocationLongitude", Field: "longitude"},
	}, drive.StartedAt.Add(-time.Microsecond), drive.EndedAt, signal.TimelineOptions{MaxEvents: maxTrafficTraceRows})
	if errors.Is(err, signal.ErrTimelineEventLimit) {
		return nil, nil, port.ErrTrafficTraceUnavailable
	}
	if err != nil {
		return nil, nil, fmt.Errorf("read bounded representative drive: %w", err)
	}
	points, ok := prepareTrafficTrace(rows, drive.StartedAt, drive.EndedAt, drive.Routine)
	if !ok {
		return nil, nil, port.ErrTrafficTraceUnavailable
	}
	data, err := json.Marshal(struct {
		Subject string
		Routine domain.Routine
		DriveID int64
		Trace   []domain.Point
	}{subject, drive.Routine, driveID, points})
	if err != nil {
		return nil, nil, fmt.Errorf("fingerprint representative trace: %w", err)
	}
	hash := sha256.Sum256(data)
	return &domain.TrafficPreview{DriveID: driveID, Trace: points, Fingerprint: hex.EncodeToString(hash[:])}, drive, nil
}
