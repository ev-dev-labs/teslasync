package smartreadinesssvc

import (
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const windowRainLookahead = 90 * time.Minute

var windowPositions = [...]struct {
	field    string
	position domain.WindowPosition
}{
	{"FdWindow", domain.WindowFrontDriver},
	{"FpWindow", domain.WindowFrontPassenger},
	{"RdWindow", domain.WindowRearDriver},
	{"RpWindow", domain.WindowRearPassenger},
}

func observeOpenParkedWindow(values map[string]*signal.Value, now time.Time) *domain.OpenWindowObservation {
	gear := values["Gear"]
	if !freshObservation(gear, now) || gear.Raw != enums.GearPark {
		return nil
	}
	var newest *domain.OpenWindowObservation
	for _, window := range windowPositions {
		value := values[window.field]
		if freshOpenWindow(value, now) &&
			(newest == nil || value.Timestamp.After(newest.ObservedAt)) {
			newest = &domain.OpenWindowObservation{Position: window.position, ObservedAt: value.Timestamp}
		}
	}
	return newest
}

func openWindowAt(values map[string]*signal.Value, position domain.WindowPosition, now time.Time) bool {
	for _, window := range windowPositions {
		if window.position == position {
			return freshOpenWindow(values[window.field], now)
		}
	}
	return false
}

func freshOpenWindow(value *signal.Value, now time.Time) bool {
	if !freshObservation(value, now) {
		return false
	}
	state, ok := value.Raw.(string)
	return ok && (state == "Opened" || state == "PartiallyOpen")
}

func windowRainRisk(
	values map[string]*signal.Value, sameConfirmedOutdoorPark bool,
	forecast domain.RainForecast, now, parkExpiresAt time.Time,
) *domain.WindowRainRisk {
	if !sameConfirmedOutdoorPark || !parkExpiresAt.After(now) ||
		forecast.ReceivedAt.IsZero() || forecast.ReceivedAt.After(now) || now.Sub(forecast.ReceivedAt) > 15*time.Minute {
		return nil
	}
	window := observeOpenParkedWindow(values, now)
	if window == nil {
		return nil
	}
	stateExpires := minTime(window.ObservedAt, values["Gear"].Timestamp).Add(signal.LiveSignalFreshnessThreshold)
	var risk *domain.WindowRainRisk
	for _, hour := range forecast.Hours {
		// Open-Meteo's hourly rain and showers describe the preceding hour.
		start := hour.EndsAt.Add(-time.Hour)
		if !hour.EndsAt.After(now) || !start.Before(now.Add(windowRainLookahead)) || !start.Before(parkExpiresAt) ||
			!finiteBetween(hour.PrecipChancePct, 65, 100) || !finiteBetween(hour.RainAndShowersM, 0.0003, 0.5) {
			continue
		}
		if risk == nil || start.Before(risk.RiskStartAt) {
			expires := minTime(stateExpires, minTime(hour.EndsAt, parkExpiresAt))
			if !expires.After(now) {
				continue
			}
			risk = &domain.WindowRainRisk{Window: *window, ForecastAt: forecast.ReceivedAt,
				RiskStartAt: start, RiskEndAt: hour.EndsAt, ExpiresAt: expires}
		}
	}
	return risk
}
