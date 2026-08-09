package system

import (
	"fmt"
	"math"
	"strings"
)

const geofenceCircleSegments = 32

// CircleToPolygonWKT approximates a geodetic circle with a regular polygon
// and emits WKT longitude/latitude coordinates, closing the ring.
func CircleToPolygonWKT(latDeg, lonDeg, radiusMeters float64) string {
	const metersPerDegLat = 111_320.0
	latRad := latDeg * math.Pi / 180.0
	metersPerDegLon := metersPerDegLat * math.Cos(latRad)
	if metersPerDegLon < 1 {
		metersPerDegLon = 1
	}
	dLat := radiusMeters / metersPerDegLat
	dLon := radiusMeters / metersPerDegLon

	var b strings.Builder
	b.WriteString("POLYGON((")
	for i := 0; i < geofenceCircleSegments; i++ {
		theta := 2 * math.Pi * float64(i) / float64(geofenceCircleSegments)
		lon := lonDeg + dLon*math.Sin(theta)
		lat := latDeg + dLat*math.Cos(theta)
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%.7f %.7f", lon, lat)
	}
	fmt.Fprintf(&b, ",%.7f %.7f", lonDeg, latDeg+dLat)
	b.WriteString("))")
	return b.String()
}
