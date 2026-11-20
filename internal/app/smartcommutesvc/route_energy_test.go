package smartcommutesvc

import (
	"slices"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestCompareRouteEnergyRequiresDistinctCoveredComparableDrives(t *testing.T) {
	now := time.Date(2026, 4, 7, 7, 45, 0, 0, time.UTC)
	start := domain.Point{Latitude: 47.1, Longitude: -122.2}
	end := domain.Point{Latitude: 47.11, Longitude: -122.18}
	routes := []energyRoute{
		{trace: []domain.Point{start, {Latitude: 47.1, Longitude: -122.19}, end}, etaS: 720},
		{trace: []domain.Point{start, {Latitude: 47.11, Longitude: -122.19}, end}, etaS: 900},
	}

	var history []routeEnergyObservation
	for index, route := range routes {
		for i := range 4 {
			history = append(history, routeEnergyObservation{
				driveID: int64(index*4 + i + 1), trace: route.trace, endedAt: now.AddDate(0, 0, -i-1),
				elapsedS: float64(route.etaS), coveredS: float64(route.etaS),
				netEnergyWh: 3_900 - float64(index)*1_000 + float64(i)*25, temperatureC: 12,
			})
		}
	}
	want := routeEnergyTradeoff{
		fastestIndex: 0, savingIndex: 1,
		fastest: routeEnergyBand{count: 4, lowWh: 3900, medianWh: 3937.5, highWh: 3975},
		saving:  routeEnergyBand{count: 4, lowWh: 2900, medianWh: 2937.5, highWh: 2975},
	}
	if got, ok := compareRouteEnergy(routes, history, 11, now, time.UTC); !ok || got != want {
		t.Fatalf("expected qualified speed/energy tradeoff, got %+v (qualified %v)", got, ok)
	}
	for _, tt := range []struct {
		name   string
		change func([]energyRoute, []routeEnergyObservation)
	}{
		{"ambiguous route match", func(routes []energyRoute, _ []routeEnergyObservation) { routes[0].trace = routes[1].trace }},
		{"temperature mismatch", func(_ []energyRoute, history []routeEnergyObservation) { history[5].temperatureC = 20 }},
		{"incomplete metered drive", func(_ []energyRoute, history []routeEnergyObservation) { history[5].coveredS -= 120 }},
		{"distinct drive but repeated day", func(_ []energyRoute, history []routeEnergyObservation) {
			history[5].endedAt = history[4].endedAt.Add(time.Hour)
		}},
		{"wrong route in same place pair", func(_ []energyRoute, history []routeEnergyObservation) {
			history[5].trace = []domain.Point{start, {Latitude: 47.106, Longitude: -122.189}, end}
		}},
		{"consumption ranges overlap", func(_ []energyRoute, history []routeEnergyObservation) { history[5].netEnergyWh = 3_920 }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			localRoutes, localHistory := slices.Clone(routes), slices.Clone(history)
			tt.change(localRoutes, localHistory)
			if got, ok := compareRouteEnergy(localRoutes, localHistory, 11, now, time.UTC); ok {
				t.Fatalf("ambiguous or insufficient evidence produced a recommendation: %+v", got)
			}
		})
	}
}

func TestMeasuredRouteEnergyRequiresFreshNumericPairs(t *testing.T) {
	start := time.Date(2026, 4, 7, 7, 45, 0, 0, time.UTC)
	end := start.Add(30 * time.Second)
	pair := func(at, voltageAt time.Time, current signal.SignalValue) signal.TimelineRow {
		return signal.TimelineRow{
			Timestamp:  at,
			ObservedAt: map[string]time.Time{"voltage": voltageAt, "current": at},
			Fields:     map[string]signal.SignalValue{"voltage": 400, "current": current},
		}
	}
	middle := start.Add(15 * time.Second)
	rows := []signal.TimelineRow{pair(start, start, 30), pair(middle, middle, -15)}
	if got := measuredRouteEnergy(rows, start, end); got.CoveredS != 30 || got.DrawWh != 50 || got.RegenWh != 25 {
		t.Fatalf("complete pairs did not preserve draw and regen: %+v", got)
	}
	rows[1] = pair(middle, start, -15)
	if got := measuredRouteEnergy(rows, start, end); got.CoveredS != 20 {
		t.Fatalf("new current incorrectly extended stale voltage coverage: %+v", got)
	}
	rows[1] = pair(middle, middle, true)
	if got := measuredRouteEnergy(rows, start, end); got.CoveredS != 15 {
		t.Fatalf("invalid boolean counted as measured current: %+v", got)
	}
}
