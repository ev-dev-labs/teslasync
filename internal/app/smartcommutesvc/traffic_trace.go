package smartcommutesvc

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	modeldrive "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	maxTrafficDriveDuration = 3 * time.Hour
	maxTrafficTraceRows     = 10_000
	minTrafficTraceM        = 1000
	maxTrafficTraceM        = 200_000
	maxTrafficGapM          = 1500
	traceToleranceM         = 18
)

func prepareTrafficTrace(rows []signal.TimelineRow, start, end time.Time, routine domain.Routine) ([]domain.Point, bool) {
	if !end.After(start) || end.Sub(start) > maxTrafficDriveDuration || len(rows) < 3 || len(rows) > maxTrafficTraceRows ||
		!validPoint(routine.Origin) || !validPoint(routine.Destination) {
		return nil, false
	}
	var lengthM float64
	var lastAt time.Time
	points := make([]domain.Point, 0, len(rows))
	for _, row := range rows {
		if row.Timestamp.Before(start) || row.Timestamp.After(end) ||
			!row.ObservedAt["latitude"].Equal(row.Timestamp) || !row.ObservedAt["longitude"].Equal(row.Timestamp) {
			continue
		}
		lat, hasLat := signal.Float64(row.Fields["latitude"])
		lon, hasLon := signal.Float64(row.Fields["longitude"])
		point := domain.Point{Latitude: lat, Longitude: lon}
		if !hasLat || !hasLon || !validPoint(point) || (lat == 0 && lon == 0) {
			continue
		}
		if len(points) > 0 {
			gapM := trafficPointDistanceM(points[len(points)-1], point)
			if !row.Timestamp.After(lastAt) || gapM > maxTrafficGapM {
				return nil, false
			}
			if gapM < 1 {
				continue
			}
			lengthM += gapM
		}
		lastAt = row.Timestamp
		points = append(points, point)
	}
	if len(points) < 3 || lengthM < minTrafficTraceM || lengthM > maxTrafficTraceM ||
		!near(routine.Origin, points[0]) || !near(routine.Destination, points[len(points)-1]) {
		return nil, false
	}
	trace := simplifyTrafficTrace(points)
	if len(trace) == 2 {
		trace = []domain.Point{trace[0], points[len(points)/2], trace[1]}
	}
	if len(trace) < 3 {
		return nil, false
	}
	return trace, true
}

func trafficPointDistanceM(a, b domain.Point) float64 {
	return modeldrive.HaversineMeters(a.Latitude, a.Longitude, b.Latitude, b.Longitude)
}

func simplifyTrafficTrace(points []domain.Point) []domain.Point {
	type interval struct{ start, end int }
	work := []interval{{0, len(points) - 1}}
	keep := make([]bool, len(points))
	keep[0], keep[len(points)-1] = true, true
	count := 2
	for len(work) > 0 {
		item := work[len(work)-1]
		work = work[:len(work)-1]
		pivot, deviationM := -1, float64(traceToleranceM)
		for i := item.start + 1; i < item.end; i++ {
			if offsetM := trafficCrossTrackM(points[i], points[item.start], points[item.end]); offsetM > deviationM {
				pivot, deviationM = i, offsetM
			}
		}
		if pivot < 0 && item.end-item.start > 1 && trafficPointDistanceM(points[item.start], points[item.end]) > maxTrafficGapM {
			pivot = item.start + (item.end-item.start)/2
		}
		if pivot >= 0 {
			keep[pivot] = true
			count++
			if count > domain.MaxTrafficTracePoints {
				return nil
			}
			work = append(work, interval{item.start, pivot}, interval{pivot, item.end})
		}
	}
	out := make([]domain.Point, 0, count)
	for i, point := range points {
		if keep[i] {
			out = append(out, point)
		}
	}
	return out
}

func trafficCrossTrackM(p, start, end domain.Point) float64 {
	const metersPerDegree = 111_195
	longitudeScale := metersPerDegree * math.Cos(start.Latitude*math.Pi/180)
	project := func(p domain.Point) (x, y float64) {
		return math.Remainder(p.Longitude-start.Longitude, 360) * longitudeScale, (p.Latitude - start.Latitude) * metersPerDegree
	}
	x, y := project(p)
	dx, dy := project(end)
	lengthSquared := dx*dx + dy*dy
	if lengthSquared == 0 {
		return math.Hypot(x, y)
	}
	fraction := min(1.0, max(0.0, (x*dx+y*dy)/lengthSquared))
	return math.Hypot(x-fraction*dx, y-fraction*dy)
}
