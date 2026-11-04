package drive

import (
	"math"
	"strings"
)

// DuplicateEndAddressDistanceM is the endpoint separation above which an
// end label identical to the start label cannot describe both places.
// At or below it the drive is treated as a genuine round trip and its
// (correctly) identical labels are left alone.
const DuplicateEndAddressDistanceM = 500.0

// HaversineMeters returns the great-circle distance in meters between two
// WGS84 coordinates.
func HaversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadius = 6371000.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	return earthRadius * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

// EndpointDistanceM returns the distance between the drive's stored start
// and end coordinates, or false when any endpoint coordinate is missing.
func (d *Drive) EndpointDistanceM() (float64, bool) {
	if d == nil || d.StartLat == nil || d.StartLon == nil || d.EndLat == nil || d.EndLon == nil {
		return 0, false
	}
	return HaversineMeters(*d.StartLat, *d.StartLon, *d.EndLat, *d.EndLon), true
}

// HasDuplicateEndAddress reports whether the stored end label is the start
// label even though the endpoints are far apart — the signature of an end
// address that was resolved from the start coordinates (or copied from the
// start label) instead of from the end coordinates. Each endpoint's address
// must come from its own coordinates, so such a label is not trustworthy
// for the destination. A shared geofence explains an identical label and
// is not suspect.
func (d *Drive) HasDuplicateEndAddress() bool {
	if d == nil || d.StartAddress == nil || d.EndAddress == nil {
		return false
	}
	if strings.TrimSpace(*d.StartAddress) == "" ||
		strings.TrimSpace(*d.StartAddress) != strings.TrimSpace(*d.EndAddress) {
		return false
	}
	if d.StartGeofenceID != nil && d.EndGeofenceID != nil &&
		*d.StartGeofenceID == *d.EndGeofenceID {
		return false
	}
	dist, ok := d.EndpointDistanceM()
	return ok && dist > DuplicateEndAddressDistanceM
}

// ClearSuspectEndAddress drops a suspect duplicate end label so readers
// show the standard unavailable/pending state (and the end coordinates)
// instead of the start address as the destination. It reports whether it
// changed anything. Genuine round trips (endpoints near the start) keep
// their identical label.
func (d *Drive) ClearSuspectEndAddress() bool {
	if !d.HasDuplicateEndAddress() {
		return false
	}
	d.EndAddress = nil
	return true
}
