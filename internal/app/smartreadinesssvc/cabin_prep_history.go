package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	cabinGear         = "Gear"
	cabinHVAC         = "HvacPower"
	cabinInterior     = "InsideTemp"
	cabinAmbient      = "OutsideTemp"
	cabinDriverTarget = "HvacLeftTemperatureRequest"
	cabinOtherTarget  = "HvacRightTemperatureRequest"
	cabinOverheat     = "CabinOverheatProtectionMode"
)

type cabinTimeline interface {
	Timeline(context.Context, int64, []signal.FieldMapping, time.Time, time.Time, signal.TimelineOptions) ([]signal.TimelineRow, error)
}

type CabinHistory struct {
	departures port.CabinDepartureHistory
	log        cabinTimeline
}

func NewCabinHistory(departures port.CabinDepartureHistory, log cabinTimeline) *CabinHistory {
	return &CabinHistory{departures: departures, log: log}
}

func (s *CabinHistory) Episodes(ctx context.Context, id int64, now, departure time.Time, loc *time.Location) ([]domain.CabinPrepEpisode, error) {
	departures, err := s.departures.CabinDepartures(ctx, id, now, departure, loc)
	if err != nil {
		return nil, err
	}
	fields := make([]signal.FieldMapping, 0, 7)
	for _, field := range []string{cabinGear, cabinHVAC, cabinInterior, cabinAmbient, cabinDriverTarget, cabinOtherTarget, cabinOverheat} {
		fields = append(fields, signal.FieldMapping{Signal: field, Field: field})
	}
	episodes := make([]domain.CabinPrepEpisode, 0, len(departures))
	for _, at := range departures {
		rows, err := s.log.Timeline(ctx, id, fields, at.Add(-40*time.Minute), at,
			signal.TimelineOptions{MaxEvents: 600, TrackSourceTime: true})
		if errors.Is(err, signal.ErrTimelineEventLimit) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read observed cabin transitions: %w", err)
		}
		if episode := cabinEpisodeFromTimeline(rows, at); episode != nil {
			episodes = append(episodes, *episode)
		}
	}
	return episodes, nil
}

func cabinEpisodeFromTimeline(rows []signal.TimelineRow, departure time.Time) *domain.CabinPrepEpisode {
	var offAt time.Time
	var episode *domain.CabinPrepEpisode
	for i, row := range rows {
		if !row.Timestamp.Before(departure) {
			break
		}
		if !row.Timestamp.Equal(row.ObservedAt[cabinHVAC]) {
			continue
		}
		powered, known := row.Fields[cabinHVAC].(bool)
		if known && !powered && row.Timestamp.Equal(sourceObservedAt(row, cabinHVAC)) {
			offAt = row.Timestamp
			continue
		}
		priorOff := offAt
		offAt = time.Time{}
		if !known || !powered || !row.Timestamp.Equal(sourceObservedAt(row, cabinHVAC)) || !recentCabinObservation(priorOff, row.Timestamp) ||
			!row.Timestamp.After(priorOff) || !cabinParked(row.Fields[cabinGear]) || !cabinOverheatOff(row) {
			continue
		}
		if candidate := cabinEpisodeEnd(rows[i:], departure, priorOff); candidate != nil {
			if episode != nil {
				return nil
			}
			episode = candidate
		}
	}
	return episode
}

func cabinEpisodeEnd(rows []signal.TimelineRow, departure, offAt time.Time) *domain.CabinPrepEpisode {
	start := rows[0]
	inside, cabinKnown := recentCabinTemperature(start, cabinInterior, -45, 80)
	outside, ambientKnown := recentCabinTemperature(start, cabinAmbient, -45, 60)
	driver, driverKnown := signal.Float64(start.Fields[cabinDriverTarget])
	passenger, passengerKnown := signal.Float64(start.Fields[cabinOtherTarget])
	if !cabinKnown || !ambientKnown || !driverKnown || !passengerKnown ||
		!finiteBetween(driver, 16, 29) || !finiteBetween(passenger, 16, 29) || math.Abs(driver-passenger) > 1 {
		return nil
	}
	target := (driver + passenger) / 2
	delta := inside - target
	if math.Abs(delta) < 2 {
		return nil
	}
	previous := sourceObservedAt(start, cabinInterior)
	for _, row := range rows[1:] {
		if !row.Timestamp.Before(departure) || row.Timestamp.Sub(offAt) > cabinMaxEpisode ||
			!cabinParked(row.Fields[cabinGear]) || !cabinOverheatOff(row) || !cabinInvariantSetpoint(row, cabinDriverTarget, driver) ||
			!cabinInvariantSetpoint(row, cabinOtherTarget, passenger) {
			return nil
		}
		powered, known := row.Fields[cabinHVAC].(bool)
		if !known || !powered {
			return nil
		}
		if !row.Timestamp.Equal(sourceObservedAt(row, cabinInterior)) {
			continue
		}
		current, numeric := signal.Float64(row.Fields[cabinInterior])
		if !numeric || !finiteBetween(current, -45, 80) || !row.Timestamp.After(previous) ||
			row.Timestamp.Sub(previous) > cabinTransitionGap {
			return nil
		}
		diff := current - target
		if math.Abs(diff) <= 1 {
			if previous.Sub(start.Timestamp) < 2*time.Minute {
				return nil
			}
			return &domain.CabinPrepEpisode{LastOffAt: offAt, FirstOnAt: start.Timestamp,
				LastOutOfBandAt: previous, FirstInBandAt: row.Timestamp, InitialCabinC: inside,
				OutsideC: outside, TargetC: target}
		}
		if delta*diff < 0 {
			return nil
		}
		previous = row.Timestamp
	}
	return nil
}

func recentCabinObservation(observed, at time.Time) bool {
	return !observed.IsZero() && !observed.After(at) && at.Sub(observed) <= cabinTransitionGap
}

func recentCabinTemperature(row signal.TimelineRow, field string, low, high float64) (float64, bool) {
	value, numeric := signal.Float64(row.Fields[field])
	return value, numeric && finiteBetween(value, low, high) && recentCabinObservation(sourceObservedAt(row, field), row.Timestamp)
}

func cabinInvariantSetpoint(row signal.TimelineRow, field string, initial float64) bool {
	value, numeric := signal.Float64(row.Fields[field])
	return numeric && finiteBetween(value, 16, 29) && math.Abs(value-initial) <= 0.5
}

func cabinParked(value signal.SignalValue) bool {
	gear, ok := value.(string)
	return ok && gear == enums.GearPark
}

func cabinOverheatOff(row signal.TimelineRow) bool {
	// HvacPower is canonical boolean telemetry, including overheat-protection operation.
	mode, known := row.Fields[cabinOverheat].(string)
	return known && mode == "Off"
}
