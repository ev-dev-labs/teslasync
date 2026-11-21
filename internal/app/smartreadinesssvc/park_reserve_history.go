package smartreadinesssvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	parkReserveBoundary = 45 * time.Minute
	parkReserveStateAge = 6 * time.Hour
	parkSentry          = "SentryMode"
	parkChargeState     = "DetailedChargeState"
	parkChargeLatch     = "ChargePortLatch"
	parkBattery         = "BatteryLevel"
	parkAmbient         = "OutsideTemp"
	parkGear            = "Gear"
)

type ParkReserveHistory struct {
	windows port.ParkReserveWindows
	log     cabinTimeline
}

func NewParkReserveHistory(windows port.ParkReserveWindows, log cabinTimeline) *ParkReserveHistory {
	return &ParkReserveHistory{windows: windows, log: log}
}

func (s *ParkReserveHistory) Episodes(ctx context.Context, vehicleID int64, now time.Time, stay time.Duration) ([]domain.ParkReserveEpisode, error) {
	if vehicleID <= 0 || stay < parkReserveMinRemaining || stay > parkReserveMaxStay {
		return nil, ErrInvalidInput
	}
	windows, err := s.windows.ParkReserveWindows(ctx, vehicleID, now.Add(-parkReserveLookback), now, stay)
	if err != nil {
		return nil, err
	}
	fields := make([]signal.FieldMapping, 0, 6)
	for _, field := range []string{parkGear, parkAmbient, parkBattery, parkSentry, parkChargeState, parkChargeLatch} {
		fields = append(fields, signal.FieldMapping{Signal: field, Field: field})
	}
	episodes := make([]domain.ParkReserveEpisode, 0, len(windows))
	for _, window := range windows {
		rows, err := s.log.Timeline(ctx, vehicleID, fields, window.Start.Add(-parkReserveStateAge), window.End,
			signal.TimelineOptions{MaxEvents: 2500, TrackSourceTime: true})
		if errors.Is(err, signal.ErrTimelineEventLimit) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read measured park endpoints: %w", err)
		}
		if episode := observedParkReserveEpisode(rows, window); episode != nil {
			episodes = append(episodes, *episode)
		}
	}
	return episodes, nil
}

func sourceObservedAt(row signal.TimelineRow, field string) time.Time {
	at := row.SourceTime[field]
	if !at.Equal(row.ObservedAt[field]) {
		return time.Time{}
	}
	return at
}

func observedParkReserveEpisode(rows []signal.TimelineRow, window port.ParkReserveWindow) *domain.ParkReserveEpisode {
	first, last := -1, -1
	for i, row := range rows {
		if row.Timestamp.Before(window.Start) || !row.Timestamp.Before(window.End) ||
			!row.Timestamp.Equal(sourceObservedAt(row, parkBattery)) || row.Fields[parkGear] != enums.GearPark || !parkUnplugged(row.Fields) ||
			sourceObservedAt(row, parkGear).IsZero() || sourceObservedAt(row, parkSentry).IsZero() ||
			sourceObservedAt(row, parkChargeState).IsZero() || sourceObservedAt(row, parkChargeLatch).IsZero() {
			continue
		}
		battery, hasBattery := signal.Float64(row.Fields[parkBattery])
		outside, hasAmbient := signal.Float64(row.Fields[parkAmbient])
		ambientAt := sourceObservedAt(row, parkAmbient)
		if !hasBattery || !finiteBetween(battery, 0, 100) || !hasAmbient ||
			!finiteBetween(outside, -45, 60) || ambientAt.IsZero() || row.Timestamp.Sub(ambientAt) > parkReserveBoundary {
			continue
		}
		if first < 0 && !row.Timestamp.After(window.Start.Add(parkReserveBoundary)) &&
			!sourceObservedAt(row, parkGear).Before(window.Start.Add(-5*time.Minute)) {
			first = i
		}
		if !row.Timestamp.Before(window.End.Add(-parkReserveBoundary)) && !ambientAt.Before(window.End.Add(-parkReserveBoundary)) {
			last = i
		}
	}
	if first < 0 || last <= first {
		return nil
	}
	start, end := rows[first], rows[last]
	mode, _ := start.Fields[parkSentry].(string)
	if mode != enums.SentryOff && mode != enums.SentryArmed {
		return nil
	}
	for _, row := range rows[first : last+1] {
		if row.Fields[parkGear] != enums.GearPark || !parkUnplugged(row.Fields) || row.Fields[parkSentry] != mode {
			return nil
		}
	}
	for _, row := range rows {
		if row.Timestamp.Before(window.Start) || !row.Timestamp.Before(window.End) {
			continue
		}
		for _, field := range []string{parkGear, parkChargeState, parkChargeLatch, parkSentry} {
			if row.Timestamp.Equal(row.ObservedAt[field]) && row.Fields[field] != start.Fields[field] {
				return nil
			}
		}
	}
	startBattery, _ := signal.Float64(start.Fields[parkBattery])
	endBattery, _ := signal.Float64(end.Fields[parkBattery])
	if endBattery > startBattery {
		return nil
	}
	startC, _ := signal.Float64(start.Fields[parkAmbient])
	endC, _ := signal.Float64(end.Fields[parkAmbient])
	return &domain.ParkReserveEpisode{
		StartObservedAt: start.Timestamp, EndObservedAt: end.Timestamp,
		StartBatteryPct: startBattery, EndBatteryPct: endBattery, StartOutsideC: startC, EndOutsideC: endC, SentryMode: mode,
	}
}

func parkUnplugged(fields signal.State) bool {
	return fields[parkChargeState] == "Disconnected" && fields[parkChargeLatch] == "Disengaged"
}
