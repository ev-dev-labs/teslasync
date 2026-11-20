// Package smartreadiness adapts charging-place records for readiness decisions.
package smartreadiness

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type geofenceReader interface {
	GetByID(context.Context, int64) (*systemmodel.Geofence, error)
}

type Sites struct {
	reader geofenceReader
}

func NewSites(reader geofenceReader) *Sites {
	if reader == nil {
		panic("smartreadiness.NewSites: reader must not be nil")
	}
	return &Sites{reader: reader}
}

func (s *Sites) Contains(ctx context.Context, id int64, lat, lon float64) (bool, error) {
	place, err := s.reader.GetByID(ctx, id)
	if err != nil {
		return false, fmt.Errorf("read charging place: %w", err)
	}
	if place == nil || !place.Enabled || place.NeedsReview || place.ArchivedAt != nil || !place.IsChargingLocation {
		return false, nil
	}
	return containsSimplePolygon(place.PolygonWKT, lat, lon), nil
}

type point struct {
	x float64
	y float64
}

func containsSimplePolygon(wkt string, lat, lon float64) bool {
	if !inRange(lat, -90, 90) || !inRange(lon, -180, 180) || len(wkt) > 65536 {
		return false
	}
	wkt = strings.TrimSpace(wkt)
	if len(wkt) < 11 || !strings.EqualFold(wkt[:9], "POLYGON((") ||
		!strings.HasSuffix(wkt, "))") {
		return false
	}
	ring := wkt[9 : len(wkt)-2]
	if strings.ContainsAny(ring, "()") {
		return false
	}
	pairs := strings.Split(ring, ",")
	if len(pairs) < 4 || len(pairs) > 513 {
		return false
	}
	points := make([]point, 0, len(pairs))
	minLon, maxLon := 180.0, -180.0
	for _, pair := range pairs {
		fields := strings.Fields(pair)
		if len(fields) != 2 {
			return false
		}
		x, xErr := strconv.ParseFloat(fields[0], 64)
		y, yErr := strconv.ParseFloat(fields[1], 64)
		if xErr != nil || yErr != nil || !inRange(x, -180, 180) || !inRange(y, -90, 90) {
			return false
		}
		minLon, maxLon = math.Min(minLon, x), math.Max(maxLon, x)
		points = append(points, point{x: x, y: y})
	}
	if points[0] != points[len(points)-1] || maxLon-minLon > 180 {
		return false
	}
	points = points[:len(points)-1]
	if !simpleRing(points) {
		return false
	}
	target := point{x: lon, y: lat}
	inside := false
	for i, a := range points {
		b := points[(i+1)%len(points)]
		if onSegment(a, b, target) {
			return false
		}
		if (a.y > lat) != (b.y > lat) && lon < a.x+(b.x-a.x)*(lat-a.y)/(b.y-a.y) {
			inside = !inside
		}
	}
	return inside
}

func simpleRing(points []point) bool {
	var area float64
	for i, a := range points {
		b := points[(i+1)%len(points)]
		if a == b {
			return false
		}
		area += a.x*b.y - b.x*a.y
		for j := i + 1; j < len(points); j++ {
			if j == i+1 || (i == 0 && j == len(points)-1) {
				continue
			}
			c, d := points[j], points[(j+1)%len(points)]
			if intersects(a, b, c, d) {
				return false
			}
		}
	}
	return area != 0
}

func intersects(a, b, c, d point) bool {
	abC, abD := cross(a, b, c), cross(a, b, d)
	cdA, cdB := cross(c, d, a), cross(c, d, b)
	return (abC == 0 && onSegment(a, b, c)) ||
		(abD == 0 && onSegment(a, b, d)) ||
		(cdA == 0 && onSegment(c, d, a)) ||
		(cdB == 0 && onSegment(c, d, b)) ||
		((abC > 0) != (abD > 0) && (cdA > 0) != (cdB > 0))
}

func cross(a, b, c point) float64 {
	return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x)
}

func onSegment(a, b, p point) bool {
	return cross(a, b, p) == 0 &&
		p.x >= math.Min(a.x, b.x) && p.x <= math.Max(a.x, b.x) &&
		p.y >= math.Min(a.y, b.y) && p.y <= math.Max(a.y, b.y)
}

func inRange(value, minValue, maxValue float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= minValue && value <= maxValue
}
