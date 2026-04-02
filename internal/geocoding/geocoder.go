package geocoding

import "context"

// Geocoder is the common interface for reverse-geocoding providers.
type Geocoder interface {
	ReverseGeocode(ctx context.Context, lat, lon float64) (*GeoResult, error)
}

// GeoResult is a provider-agnostic geocoding result.
type GeoResult struct {
	DisplayName string
	Road        string
	City        string
	State       string
	Country     string
	PostCode    string
}

// ShortName returns a short, human-readable location name.
func (r *GeoResult) ShortName() string {
	locality := r.City

	if r.Road != "" && locality != "" {
		return r.Road + ", " + locality
	}
	if locality != "" {
		return locality
	}
	if len(r.DisplayName) > 60 {
		return r.DisplayName[:60] + "..."
	}
	return r.DisplayName
}

// NewGeocoder returns a Google Maps geocoder when an API key is provided,
// otherwise falls back to the free Nominatim (OpenStreetMap) geocoder.
func NewGeocoder(googleAPIKey string) Geocoder {
	if googleAPIKey != "" {
		return NewGoogleClient(googleAPIKey)
	}
	return NewClient("TeslaSync/1.0")
}
