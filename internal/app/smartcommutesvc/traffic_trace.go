package smartcommutesvc

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveevidence"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	maxTrafficDriveDuration = 3 * time.Hour
	maxTrafficTraceRows     = 10_000
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
			gapM := driveevidence.DistanceM(points[len(points)-1], point)
			if !row.Timestamp.After(lastAt) || gapM > driveevidence.MaxGapM {
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
	if len(points) < 3 || lengthM < driveevidence.MinPathM || lengthM > driveevidence.MaxPathM ||
		!near(routine.Origin, points[0]) || !near(routine.Destination, points[len(points)-1]) {
		return nil, false
	}
	trace := driveevidence.SimplifyPath(points)
	if len(trace) == 2 {
		trace = []domain.Point{trace[0], points[len(points)/2], trace[1]}
	}
	if len(trace) < 3 {
		return nil, false
	}
	return trace, true
}
