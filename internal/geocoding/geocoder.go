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

// NewGeocoder returns a geocoder that tries the configured providers in
// priority order — Google Maps → Azure Maps → Nominatim — falling back to the
// next whenever one errors. Nominatim is always appended last as a key-free
// safety net, so a misconfigured Google/Azure key (e.g. REQUEST_DENIED) can no
// longer leave drives without a resolved place name.
func NewGeocoder(googleAPIKey, azureAPIKey string) Geocoder {
	providers := make([]namedGeocoder, 0, 3)
	if googleAPIKey != "" {
		providers = append(providers, namedGeocoder{name: "google", geo: NewGoogleClient(googleAPIKey)})
	}
	if azureAPIKey != "" {
		providers = append(providers, namedGeocoder{name: "azure", geo: NewAzureClient(azureAPIKey)})
	}
	providers = append(providers, namedGeocoder{name: "nominatim", geo: NewClient("TeslaSync/1.0")})

	if len(providers) == 1 {
		return providers[0].geo
	}
	return &chainGeocoder{providers: providers}
}
