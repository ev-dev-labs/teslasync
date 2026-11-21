// Package driveevidence qualifies recorded drives for like-for-like comparisons.
package driveevidence

import (
	"math"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	modeldrive "github.com/ev-dev-labs/teslasync/internal/models/drive"
)

const (
	MinPathM       = 1000
	MaxPathM       = 200_000
	MaxGapM        = 1500
	pathToleranceM = 45
)

func DistanceM(a, b domain.Point) float64 {
	return modeldrive.HaversineMeters(a.Latitude, a.Longitude, b.Latitude, b.Longitude)
}

func ValidPoint(p domain.Point) bool {
	return p.Latitude >= -90 && p.Latitude <= 90 && p.Longitude >= -180 && p.Longitude <= 180
}

func ValidPath(path []domain.Point) bool {
	if len(path) < 3 || len(path) > domain.MaxTrafficTracePoints {
		return false
	}
	var lengthM float64
	for index, point := range path {
		if !ValidPoint(point) || (point.Latitude == 0 && point.Longitude == 0) {
			return false
		}
		if index > 0 {
			segmentM := DistanceM(path[index-1], point)
			if segmentM > MaxGapM {
				return false
			}
			lengthM += segmentM
		}
	}
	return lengthM >= MinPathM && lengthM <= MaxPathM
}

func PathLengthM(path []domain.Point) float64 {
	var meters float64
	for i := 1; i < len(path); i++ {
		meters += DistanceM(path[i-1], path[i])
	}
	return meters
}

// PathsMatch compares already qualified paths in travel order, not just endpoints.
func PathsMatch(a, b []domain.Point) bool {
	if DistanceM(a[0], b[0]) > pathToleranceM || DistanceM(a[len(a)-1], b[len(b)-1]) > pathToleranceM {
		return false
	}
	return follows(a, b) && follows(b, a)
}

func follows(path, reference []domain.Point) bool {
	cursor := 0
	for index := 1; index < len(path); index++ {
		start, end := path[index-1], path[index]
		steps := max(1, int(math.Ceil(DistanceM(start, end)/20)))
		if steps > 100 {
			return false
		}
		for step := 1; step <= steps; step++ {
			fraction := float64(step) / float64(steps)
			sample := domain.Point{
				Latitude:  start.Latitude + (end.Latitude-start.Latitude)*fraction,
				Longitude: math.Remainder(start.Longitude+math.Remainder(end.Longitude-start.Longitude, 360)*fraction, 360),
			}
			for cursor < len(reference)-1 && crossTrackM(sample, reference[cursor], reference[cursor+1]) > pathToleranceM {
				cursor++
			}
			if cursor == len(reference)-1 {
				return false
			}
		}
	}
	return true
}

func crossTrackM(p, start, end domain.Point) float64 {
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

func SimplifyPath(points []domain.Point) []domain.Point {
	if len(points) < 3 {
		return points
	}
	type interval struct{ start, end int }
	work := []interval{{0, len(points) - 1}}
	keep := make([]bool, len(points))
	keep[0], keep[len(points)-1] = true, true
	count := 2
	for len(work) > 0 {
		item := work[len(work)-1]
		work = work[:len(work)-1]
		pivot, deviationM := -1, 18.0
		for i := item.start + 1; i < item.end; i++ {
			if offsetM := crossTrackM(points[i], points[item.start], points[item.end]); offsetM > deviationM {
				pivot, deviationM = i, offsetM
			}
		}
		if pivot < 0 && item.end-item.start > 1 && DistanceM(points[item.start], points[item.end]) > MaxGapM {
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
