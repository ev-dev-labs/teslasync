package driveevidence

import (
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const PackObservationFreshness = 20 * time.Second

func RecordedPath(rows []signal.TimelineRow, start, end time.Time) ([]domain.Point, bool) {
	var lastAt time.Time
	var points []domain.Point
	for _, row := range rows {
		if row.Timestamp.Before(start) || row.Timestamp.After(end) ||
			!row.ObservedAt["latitude"].Equal(row.Timestamp) || !row.ObservedAt["longitude"].Equal(row.Timestamp) {
			continue
		}
		lat, latOK := Number(row.Fields["latitude"])
		lon, lonOK := Number(row.Fields["longitude"])
		point := domain.Point{Latitude: lat, Longitude: lon}
		if !latOK || !lonOK || !ValidPoint(point) || lat == 0 && lon == 0 {
			return nil, false
		}
		switch {
		case len(points) == 0:
			if row.Timestamp.Sub(start) > 30*time.Second {
				return nil, false
			}
		case !row.Timestamp.After(lastAt) || row.Timestamp.Sub(lastAt) > time.Minute || DistanceM(points[len(points)-1], point) > MaxGapM:
			return nil, false
		}
		lastAt = row.Timestamp
		if len(points) == 0 || DistanceM(points[len(points)-1], point) >= 1 {
			points = append(points, point)
		}
	}
	if len(points) < 3 || end.Sub(lastAt) > 30*time.Second {
		return nil, false
	}
	path := SimplifyPath(points)
	if len(path) == 2 {
		path = []domain.Point{path[0], points[len(points)/2], path[1]}
	}
	return path, ValidPath(path)
}

func IntegratePackEnergy(rows []signal.TimelineRow, start, end time.Time) signal.PowerIntegral {
	var out signal.PowerIntegral
	for i, row := range rows {
		voltageAt, currentAt := row.ObservedAt["voltage"], row.ObservedAt["current"]
		if voltageAt.IsZero() || currentAt.IsZero() || row.Timestamp.After(end) {
			continue
		}
		voltage, vOK := Number(row.Fields["voltage"])
		current, cOK := Number(row.Fields["current"])
		if !vOK || !cOK || !(voltage >= 100 && voltage <= 1000 && math.Abs(current) <= 1200) {
			continue
		}
		until := earlier(end, earlier(voltageAt.Add(PackObservationFreshness), currentAt.Add(PackObservationFreshness)))
		if i+1 < len(rows) {
			until = earlier(until, rows[i+1].Timestamp)
		}
		since := row.Timestamp
		if start.After(since) {
			since = start
		}
		coveredS := until.Sub(since).Seconds()
		if coveredS <= 0 {
			continue
		}
		energyWh := voltage * current * coveredS / 3600
		out.CoveredS += coveredS
		out.DrawWh += max(0, energyWh)
		out.RegenWh += max(0, -energyWh)
	}
	return out
}

func earlier(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func Number(value any) (float64, bool) {
	switch value.(type) {
	case bool, map[string]any:
		return 0, false
	default:
		return signal.Float64(value)
	}
}

func OutsideTemperature(rows []signal.TimelineRow, start, end time.Time) (float64, bool) {
	var firstAt, lastAt time.Time
	var sumS, previous, minC, maxC float64
	const maxGap = 10 * time.Minute
	for _, row := range rows {
		if row.Timestamp.Before(start) || row.Timestamp.After(end) ||
			!row.ObservedAt["outside_c"].Equal(row.Timestamp) {
			continue
		}
		temp, ok := Number(row.Fields["outside_c"])
		if !ok || !(temp >= -40 && temp <= 55) {
			return 0, false
		}
		if firstAt.IsZero() {
			if row.Timestamp.Sub(start) > 2*time.Minute {
				return 0, false
			}
			firstAt, minC, maxC = row.Timestamp, temp, temp
		} else {
			gap := row.Timestamp.Sub(lastAt)
			if gap <= 0 || gap > maxGap {
				return 0, false
			}
			sumS += previous * gap.Seconds()
			minC, maxC = math.Min(minC, temp), math.Max(maxC, temp)
		}
		lastAt, previous = row.Timestamp, temp
	}
	if firstAt.IsZero() || !lastAt.After(firstAt) || end.Sub(lastAt) > 2*time.Minute || maxC-minC > 5 {
		return 0, false
	}
	return sumS / lastAt.Sub(firstAt).Seconds(), true
}
