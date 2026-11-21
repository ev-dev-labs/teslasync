package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	overnightEndpointMargin = 45 * time.Minute
	overnightHistoryLimit   = 28
	overnightStateLookback  = 2 * time.Hour
	overnightHVAC           = "HvacPower"
)

type overnightActivity interface {
	ParkReserveActivity(context.Context, int64, time.Time, time.Time) (bool, error)
	OvernightWakeRequest(context.Context, int64, time.Time, time.Time) (*time.Time, error)
}

type OvernightDrainHistory struct {
	activity overnightActivity
	log      cabinTimeline
}

func NewOvernightDrainHistory(activity overnightActivity, log cabinTimeline) *OvernightDrainHistory {
	return &OvernightDrainHistory{activity: activity, log: log}
}

func overnightWindow(morning time.Time) (time.Time, time.Time) {
	location := morning.Location()
	end := time.Date(morning.Year(), morning.Month(), morning.Day(), 6, 0, 0, 0, location)
	prior := end.AddDate(0, 0, -1)
	return time.Date(prior.Year(), prior.Month(), prior.Day(), 22, 0, 0, 0, location), end
}

func overnightReviewExpires(morning time.Time) time.Time {
	return time.Date(morning.Year(), morning.Month(), morning.Day(), 12, 0, 0, 0, morning.Location())
}

func (s *OvernightDrainHistory) Review(ctx context.Context, vehicleID int64, morning, now time.Time) (*domain.OvernightDrainReview, domain.OvernightDrainReason, error) {
	start, end := overnightWindow(morning)
	if end.After(now) || !now.Before(overnightReviewExpires(morning)) {
		return nil, domain.OvernightMissingEvidence, nil
	}
	night, err := s.current(ctx, vehicleID, start, end)
	if err != nil || night == nil {
		return nil, domain.OvernightMissingEvidence, err
	}
	if len(night.Factors) == 0 {
		return nil, domain.OvernightNoObservedFactors, nil
	}
	history := make([]domain.OvernightDrainObservation, 0, overnightHistoryLimit)
	for day := 1; day <= overnightHistoryLimit; day++ {
		start, end := overnightWindow(morning.AddDate(0, 0, -day))
		sample, err := s.observation(ctx, vehicleID, start, end)
		if err != nil {
			return nil, "", err
		}
		if sample != nil {
			history = append(history, *sample)
		}
	}
	review, reason := EvaluateOvernightDrain(*night, history, now)
	if review == nil {
		return nil, reason, nil
	}
	observations := make(map[int64]domain.OvernightDrainObservation, len(history))
	for _, sample := range history {
		observations[sample.EndAt.UnixMicro()] = normalizedOvernightEvidence(sample, false)
	}
	evidence := []domain.OvernightDrainObservation{normalizedOvernightEvidence(*night, true)}
	for _, end := range review.BaselineEnds {
		evidence = append(evidence, observations[end.UnixMicro()])
	}
	review.EvidenceFingerprint, err = batteryEvidenceFingerprint(evidence)
	return review, reason, err
}

func normalizedOvernightEvidence(sample domain.OvernightDrainObservation, includeFactors bool) domain.OvernightDrainObservation {
	sample.StartAt, sample.EndAt = sample.StartAt.UTC(), sample.EndAt.UTC()
	if includeFactors {
		sample.Factors = observedOvernightFactors(sample)
	} else {
		sample.Factors = nil
	}
	return sample
}

func (s *OvernightDrainHistory) fingerprint(ctx context.Context, vehicleID int64, review *domain.OvernightDrainReview, loc *time.Location) ([]byte, error) {
	if count := len(review.BaselineEnds); count < overnightMinNights || count > overnightMaxNights || count != len(review.BaselineStarts) {
		return nil, nil
	}
	start, end := overnightWindow(review.MorningAt.In(loc))
	night, err := s.current(ctx, vehicleID, start, end)
	if err != nil || night == nil || !night.StartAt.Equal(review.StartAt) || !night.EndAt.Equal(review.EndAt) {
		return nil, err
	}
	evidence := []domain.OvernightDrainObservation{normalizedOvernightEvidence(*night, true)}
	for i, measuredEnd := range review.BaselineEnds {
		start, end := overnightWindow(measuredEnd.In(loc))
		sample, err := s.observation(ctx, vehicleID, start, end)
		if err != nil || sample == nil || !sample.StartAt.Equal(review.BaselineStarts[i]) || !sample.EndAt.Equal(measuredEnd) {
			return nil, err
		}
		evidence = append(evidence, normalizedOvernightEvidence(*sample, false))
	}
	return batteryEvidenceFingerprint(evidence)
}

func (s *OvernightDrainHistory) current(ctx context.Context, vehicleID int64, start, end time.Time) (*domain.OvernightDrainObservation, error) {
	night, err := s.observation(ctx, vehicleID, start, end)
	if err != nil || night == nil {
		return night, err
	}
	wake, err := s.activity.OvernightWakeRequest(ctx, vehicleID, night.StartAt, night.EndAt)
	if err != nil {
		return nil, err
	}
	if wake != nil {
		night.Factors = append(night.Factors, domain.OvernightFactorObservation{Kind: domain.OvernightWakeRequested, ObservedAt: *wake})
	}
	return night, nil
}

func (s *OvernightDrainHistory) observation(ctx context.Context, vehicleID int64, start, end time.Time) (*domain.OvernightDrainObservation, error) {
	activity, err := s.activity.ParkReserveActivity(ctx, vehicleID, start, end)
	if err != nil || activity {
		return nil, err
	}
	fields := make([]signal.FieldMapping, 0, 7)
	for _, field := range []string{parkGear, parkAmbient, parkBattery, parkSentry, parkChargeState, parkChargeLatch, overnightHVAC} {
		fields = append(fields, signal.FieldMapping{Signal: field, Field: field})
	}
	rows, err := s.log.Timeline(ctx, vehicleID, fields, start.Add(-overnightStateLookback), end,
		signal.TimelineOptions{MaxEvents: 2500, TrackSourceTime: true})
	if errors.Is(err, signal.ErrTimelineEventLimit) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read measured overnight drain: %w", err)
	}
	return measuredOvernightDrain(rows, start, end), nil
}

func measuredOvernightDrain(rows []signal.TimelineRow, start, end time.Time) *domain.OvernightDrainObservation {
	first, last := -1, -1
	for i, row := range rows {
		if row.Timestamp.Before(start) || row.Timestamp.After(end) {
			continue
		}
		if overnightActivityObserved(row) {
			return nil
		}
		if !row.Timestamp.Equal(sourceObservedAt(row, parkBattery)) || row.Fields[parkGear] != enums.GearPark ||
			!parkUnplugged(row.Fields) || !overnightParkSeedKnown(row, start) {
			continue
		}
		ambientAt := sourceObservedAt(row, parkAmbient)
		if ambientAt.IsZero() || ambientAt.After(row.Timestamp) || row.Timestamp.Sub(ambientAt) > overnightEndpointMargin {
			continue
		}
		if first < 0 && !row.Timestamp.After(start.Add(overnightEndpointMargin)) {
			first = i
		}
		if !row.Timestamp.Before(end.Add(-overnightEndpointMargin)) {
			last = i
		}
	}
	if first < 0 || last <= first {
		return nil
	}
	begin, finish := rows[first], rows[last]
	observation := domain.OvernightDrainObservation{StartAt: begin.Timestamp, EndAt: finish.Timestamp}
	var b1, b2, c1, c2 bool
	observation.StartBatteryPct, b1 = signal.Float64(begin.Fields[parkBattery])
	observation.EndBatteryPct, b2 = signal.Float64(finish.Fields[parkBattery])
	observation.StartOutsideC, c1 = signal.Float64(begin.Fields[parkAmbient])
	observation.EndOutsideC, c2 = signal.Float64(finish.Fields[parkAmbient])
	if !b1 || !b2 || !c1 || !c2 || !overnightObservationValid(observation) {
		return nil
	}
	var seenSentry, seenClimate bool
	for _, row := range rows[first : last+1] {
		if row.Fields[parkGear] != enums.GearPark || !parkUnplugged(row.Fields) {
			return nil
		}
		if !seenSentry && row.Timestamp.Equal(sourceObservedAt(row, parkSentry)) {
			mode, _ := row.Fields[parkSentry].(string)
			if mode == enums.SentryArmed || mode == enums.SentryAware || mode == enums.SentryPanic {
				observation.Factors = append(observation.Factors, domain.OvernightFactorObservation{Kind: domain.OvernightSentry, ObservedAt: row.Timestamp})
				seenSentry = true
			}
		}
		if !seenClimate && row.Timestamp.Equal(sourceObservedAt(row, overnightHVAC)) && row.Fields[overnightHVAC] == true {
			observation.Factors = append(observation.Factors, domain.OvernightFactorObservation{Kind: domain.OvernightClimate, ObservedAt: row.Timestamp})
			seenClimate = true
		}
	}
	return &observation
}

func overnightParkSeedKnown(row signal.TimelineRow, start time.Time) bool {
	oldest := start.Add(-overnightStateLookback)
	for _, field := range []string{parkGear, parkChargeState, parkChargeLatch} {
		at := sourceObservedAt(row, field)
		if at.Before(oldest) || at.After(row.Timestamp) {
			return false
		}
	}
	return true
}

func overnightActivityObserved(row signal.TimelineRow) bool {
	return (row.Timestamp.Equal(row.ObservedAt[parkGear]) && row.Fields[parkGear] != enums.GearPark) ||
		(row.Timestamp.Equal(row.ObservedAt[parkChargeState]) && row.Fields[parkChargeState] != "Disconnected") ||
		(row.Timestamp.Equal(row.ObservedAt[parkChargeLatch]) && row.Fields[parkChargeLatch] != "Disengaged")
}
