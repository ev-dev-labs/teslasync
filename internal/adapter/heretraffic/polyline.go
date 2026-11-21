package heretraffic

import (
	"math"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

const (
	flexiblePolylineAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	maxRouteGeometryPoints   = 12_000
)

func coveredRouteGeometry(raw []routingRoute, offered []routeEstimate, observedAt time.Time) []domain.TrafficRoute {
	if len(raw) != len(offered) || len(raw) < 2 {
		return nil
	}
	routes := make([]domain.TrafficRoute, 0, len(raw))
	for index, route := range raw {
		var geometry []domain.Point
		for _, section := range route.Sections {
			points, ok := decodeRouteGeometry(section.Polyline, maxRouteGeometryPoints-len(geometry))
			if !ok {
				return nil
			}
			if len(geometry) > 0 {
				end, start := geometry[len(geometry)-1], points[0]
				if math.Abs(end.Latitude-start.Latitude) > 0.00005 ||
					math.Abs(math.Remainder(end.Longitude-start.Longitude, 360)) > 0.00005 {
					return nil
				}
				points = points[1:]
			}
			geometry = append(geometry, points...)
		}
		routes = append(routes, domain.TrafficRoute{
			TrafficEstimate: domain.TrafficEstimate{DurationS: offered[index].durationS, FlowUpdatedAt: observedAt},
			Geometry:        geometry,
		})
	}
	return routes
}

// decodeRouteGeometry decodes the two-dimensional version 1 format returned
// by Routing v8 when asking for a polyline without elevation.
func decodeRouteGeometry(raw string, remaining int) ([]domain.Point, bool) {
	if remaining < 2 || remaining > maxRouteGeometryPoints || len(raw) > 20*remaining+8 {
		return nil, false
	}
	offset := 0
	next := func() (uint64, bool) {
		var number uint64
		for shift := range uint(13) {
			if offset == len(raw) {
				break
			}
			digit := strings.IndexByte(flexiblePolylineAlphabet, raw[offset])
			offset++
			if digit < 0 || (shift == 12 && digit > 15) {
				break
			}
			number |= uint64(digit&31) << (shift * 5)
			if digit&32 == 0 {
				return number, true
			}
		}
		return 0, false
	}
	version, ok := next()
	if !ok || version != 1 {
		return nil, false
	}
	header, ok := next()
	if !ok || header > 15 {
		return nil, false
	}
	scale := int64(math.Pow10(int(header)))
	delta := func(limit int64) (int64, bool) {
		value, ok := next()
		signed := int64(value>>1) ^ -int64(value&1)
		return signed, ok && signed >= -2*limit && signed <= 2*limit
	}
	var lat, lng int64
	points := make([]domain.Point, 0, min(len(raw)/2, remaining))
	for offset < len(raw) && len(points) < remaining {
		dLat, latOK := delta(90 * scale)
		dLng, lngOK := delta(180 * scale)
		lat += dLat
		lng += dLng
		if !latOK || !lngOK || lat < -90*scale || lat > 90*scale || lng < -180*scale || lng > 180*scale {
			return nil, false
		}
		points = append(points, domain.Point{Latitude: float64(lat) / float64(scale), Longitude: float64(lng) / float64(scale)})
	}
	if offset != len(raw) || len(points) < 2 {
		return nil, false
	}
	return points, true
}
