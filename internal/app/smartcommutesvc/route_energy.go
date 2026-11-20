package smartcommutesvc

import (
	"math"
	"slices"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

const (
	routeEnergyMinDrives    = 4
	routeEnergyHistoryLimit = 56 * 24 * time.Hour
	routeEnergyToleranceM   = 45
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
		if !validEnergyTrace(route.trace) || route.etaS <= 0 || route.etaS > int64(maxTrafficDriveDuration/time.Second) {
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
			!validEnergyTrace(row.trace) {
			continue
		}
		driveIDs[row.driveID] = true
		match := -1
		for index, route := range routes {
			if routeMatchesEnergyTrace(route.trace, row.trace) {
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

func validEnergyTrace(trace []domain.Point) bool {
	if len(trace) < 3 || len(trace) > domain.MaxTrafficTracePoints {
		return false
	}
	var lengthM float64
	for index, point := range trace {
		if !validPoint(point) || (point.Latitude == 0 && point.Longitude == 0) {
			return false
		}
		if index > 0 {
			segmentM := trafficPointDistanceM(trace[index-1], point)
			if segmentM > maxTrafficGapM {
				return false
			}
			lengthM += segmentM
		}
	}
	return lengthM >= minTrafficTraceM && lengthM <= maxTrafficTraceM
}

func routeMatchesEnergyTrace(a, b []domain.Point) bool {
	if trafficPointDistanceM(a[0], b[0]) > routeEnergyToleranceM ||
		trafficPointDistanceM(a[len(a)-1], b[len(b)-1]) > routeEnergyToleranceM {
		return false
	}
	return energyTraceFollows(a, b) && energyTraceFollows(b, a)
}

func energyTraceFollows(trace, reference []domain.Point) bool {
	// Match samples in travel order and both directions to reject shortcuts
	// between sparse vertices and routes that visit the same roads out of order.
	cursor := 0
	for index := 1; index < len(trace); index++ {
		start, end := trace[index-1], trace[index]
		steps := max(1, int(math.Ceil(trafficPointDistanceM(start, end)/20)))
		if steps > 100 {
			return false
		}
		for step := 1; step <= steps; step++ {
			fraction := float64(step) / float64(steps)
			sample := domain.Point{
				Latitude:  start.Latitude + (end.Latitude-start.Latitude)*fraction,
				Longitude: math.Remainder(start.Longitude+math.Remainder(end.Longitude-start.Longitude, 360)*fraction, 360),
			}
			for cursor < len(reference)-1 && trafficCrossTrackM(sample, reference[cursor], reference[cursor+1]) > routeEnergyToleranceM {
				cursor++
			}
			if cursor == len(reference)-1 {
				return false
			}
		}
	}
	return true
}
