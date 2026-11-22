package smartcommutesvc

import (
	"math"
	"slices"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveevidence"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

const (
	routeEnergyMinDrives    = 4
	routeEnergyHistoryLimit = 56 * 24 * time.Hour
)

type energyRoute struct {
	trace []domain.Point
	etaS  int64
}

type routeEnergyObservation struct {
	driveID      int64
	trace        []domain.Point
	endedAt      time.Time
	elapsedS     float64
	coveredS     float64
	netEnergyWh  float64
	temperatureC float64
}

type routeEnergyBand struct {
	count           int
	lowWh, medianWh float64
	highWh          float64
}

type routeEnergyTradeoff struct {
	fastestIndex int
	savingIndex  int
	fastest      routeEnergyBand
	saving       routeEnergyBand
}

// compareRouteEnergy accepts only individually traffic-qualified route estimates.
// The energy band is observed consumption across comparable drives, not a forecast.
func compareRouteEnergy(routes []energyRoute, history []routeEnergyObservation, outsideC float64, now time.Time, loc *time.Location) (routeEnergyTradeoff, bool) {
	var zero routeEnergyTradeoff
	if len(routes) < 2 || len(routes) > 4 || !(outsideC >= -40 && outsideC <= 55) || loc == nil {
		return zero, false
	}
	fastest := 0
	for index, route := range routes {
		if !driveevidence.ValidPath(route.trace) || route.etaS <= 0 || route.etaS > int64(maxTrafficDriveDuration/time.Second) {
			return zero, false
		}
		if route.etaS < routes[fastest].etaS {
			fastest = index
		}
	}
	for index, route := range routes {
		if index != fastest && route.etaS == routes[fastest].etaS {
			return zero, false
		}
	}
	byRoute := make([]map[string]float64, len(routes))
	for index := range byRoute {
		byRoute[index] = make(map[string]float64)
	}
	driveIDs := make(map[int64]bool)
	for _, row := range history {
		if row.driveID <= 0 || driveIDs[row.driveID] || row.endedAt.After(now) ||
			row.endedAt.Before(now.Add(-routeEnergyHistoryLimit)) ||
			!(math.Abs(row.temperatureC-outsideC) <= 5 && row.temperatureC >= -40 && row.temperatureC <= 55) ||
			!(row.elapsedS > 0 && math.Abs(row.coveredS-row.elapsedS) < 1e-6) ||
			!(row.netEnergyWh > 0 && row.netEnergyWh <= 200_000) ||
			!driveevidence.ValidPath(row.trace) {
			continue
		}
		driveIDs[row.driveID] = true
		match := -1
		for index, route := range routes {
			if driveevidence.PathsMatch(route.trace, row.trace) {
				if match >= 0 {
					match = -1
					break
				}
				match = index
			}
		}
		if match < 0 || math.Abs(row.elapsedS/float64(routes[match].etaS)-1) > 0.30 {
			continue
		}
		day := row.endedAt.In(loc).Format(time.DateOnly)
		if previous, ok := byRoute[match][day]; ok && previous != row.netEnergyWh {
			// A repeated day cannot multiply the evidence or hide conflicting observations.
			byRoute[match][day] = 0
		} else {
			byRoute[match][day] = row.netEnergyWh
		}
	}
	bands := make([]routeEnergyBand, len(routes))
	for index, observations := range byRoute {
		values := make([]float64, 0, len(observations))
		for _, wh := range observations {
			if wh > 0 {
				values = append(values, wh)
			}
		}
		if len(values) < routeEnergyMinDrives {
			continue
		}
		slices.Sort(values)
		median := (values[(len(values)-1)/2] + values[len(values)/2]) / 2
		if values[len(values)-1]-values[0] <= 0.40*median {
			bands[index] = routeEnergyBand{len(values), values[0], median, values[len(values)-1]}
		}
	}
	fast := bands[fastest]
	if fast.count == 0 {
		return zero, false
	}
	best := -1
	for index, band := range bands {
		if index == fastest || band.count == 0 || fast.lowWh-band.highWh < max(500, 0.15*fast.lowWh) {
			continue
		}
		if best < 0 || band.highWh < bands[best].highWh ||
			(band.highWh == bands[best].highWh && routes[index].etaS < routes[best].etaS) {
			best = index
		}
	}
	if best < 0 {
		return zero, false
	}
	return routeEnergyTradeoff{fastestIndex: fastest, savingIndex: best, fastest: fast, saving: bands[best]}, true
}
