package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

type recentParkSource interface {
	LatestRecentPark(context.Context, int64, time.Time, time.Time) (*domain.RecentPark, error)
	RecentParkObservations(context.Context, int64, []string, time.Time, time.Time) ([]signal.TimelineRow, error)
}

type ParkedClosureHistory struct {
	parks recentParkSource
	live  LiveSignals
}

func NewParkedClosureHistory(parks recentParkSource, live LiveSignals) *ParkedClosureHistory {
	return &ParkedClosureHistory{parks: parks, live: live}
}

func (s *ParkedClosureHistory) Evaluate(
	ctx context.Context, vehicleID int64, after, now time.Time, grace time.Duration,
) (*domain.ParkedClosureRisk, domain.ParkedClosureReason, error) {
	if vehicleID <= 0 || after.IsZero() || after.After(now) ||
		grace < minClosureGrace || grace > maxClosureGrace || s.live == nil {
		return nil, domain.ClosureUnknown, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	values, err := s.live.GetAll(ctx, vehicleID, signal.LiveSignalReadDistributed)
	if err != nil {
		return nil, domain.ClosureUnknown, fmt.Errorf("read distributed closure signals: %w", err)
	}
	sample, _, reason := currentClosureSample(values, now)
	if reason != "" {
		return nil, reason, nil
	}
	park, err := s.parks.LatestRecentPark(ctx, vehicleID, now.Add(-closureParkAge), now)
	if err != nil {
		return nil, domain.ClosureUnknown, err
	}
	if park == nil || park.DriveID <= 0 || park.EndedAt.IsZero() || park.EndedAt.After(now) {
		return nil, domain.ClosureUnknown, nil
	}
	from := maxClosureTime(park.EndedAt, after)
	if sample.at.Sub(from) < grace {
		return nil, domain.ClosureGrace, nil
	}
	fields := []string{"Gear"}
	fields = append(fields, closureActivityFields[:]...)
	for _, closure := range closurePositions {
		fields = append(fields, closure.field)
	}
	rows, err := s.parks.RecentParkObservations(ctx, vehicleID, fields, from, now)
	if errors.Is(err, signal.ErrTimelineEventLimit) {
		return nil, domain.ClosureUnknown, nil
	}
	if err != nil {
		return nil, domain.ClosureUnknown, fmt.Errorf("read recent closure timeline: %w", err)
	}
	risk, reason := parkedClosureRisk(values, rows, park.EndedAt, after, now, grace)
	if risk != nil {
		risk.DriveID = park.DriveID
	}
	return risk, reason, nil
}
