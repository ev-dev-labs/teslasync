package geocoding

import (
	"context"
	"strings"
)

// Geocoder is the common interface for reverse-geocoding providers.
type Geocoder interface {
	ReverseGeocode(ctx context.Context, lat, lon float64) (*GeoResult, error)
}

// GeoResult is a provider-agnostic geocoding result.
//
// Name/HouseNumber/Suburb exist because a road-only label is not specific
// enough to identify an endpoint. Every provider returns them (Nominatim
// name/amenity/house_number, Google point_of_interest/street_number,
// Azure poi/streetNumber) and all three used to discard them, which is what
// made a drive's Start and Destination render as the same string whenever
// both ends sat on one road.
type GeoResult struct {
	DisplayName string
	// Name is a point-of-interest / premise name such as "Costco Wholesale".
	Name string
	// HouseNumber is the street number, e.g. "19205".
	HouseNumber string
	Road        string
	// Suburb is a neighbourhood / district, finer-grained than City.
	Suburb   string
	City     string
	State    string
	Country  string
	PostCode string
}

// shortNameTruncateLen bounds the DisplayName fallback so a full multi-line
// postal address never lands in a table cell.
const shortNameTruncateLen = 60

// ShortName returns the most specific human-readable label available.
//
// Specificity order matters. Both endpoints of a drive very often sit on the
// same road — a commute up one highway is the common case — so a "Road, City"
// label makes Start and Destination read identically and tells the user
// nothing about where they actually went. Preferring a POI name, then a full
// street address, keeps the two ends distinguishable:
//
//	before: "Bothell Everett Highway, Bothell" -> "Bothell Everett Highway, Mill Creek"
//	after:  "19205 Bothell Everett Hwy, Bothell" -> "Costco Wholesale, Mill Creek"
func (r *GeoResult) ShortName() string {
	// A named place is the most useful label a human can be given, and it
	// stands on its own even when no locality resolved.
	if r.Name != "" {
		if area := r.area(); area != "" && !strings.EqualFold(r.Name, area) {
			return r.Name + ", " + area
		}
		return r.Name
	}

	// A street number is what separates two points on the same road.
	if r.Road != "" {
		if area := r.area(); area != "" {
			return r.street() + ", " + area
		}
		// With no locality to anchor it, a bare road is less informative than
		// the provider's own formatted address, so only use it when there is
		// no display name to fall back to.
		if r.DisplayName == "" {
			return r.street()
		}
	}

	if area := r.area(); area != "" {
		return area
	}
	if len(r.DisplayName) > shortNameTruncateLen {
		return r.DisplayName[:shortNameTruncateLen] + "..."
	}
	return r.DisplayName
}

// street renders the road prefixed by its house number when one is known.
func (r *GeoResult) street() string {
	if r.HouseNumber != "" {
		return r.HouseNumber + " " + r.Road
	}
	return r.Road
}

// area returns the locality qualifier appended after a road or place name.
//
// Suburb wins over City when both are known: two ends of a cross-town drive
// share a city but rarely a neighbourhood, so the finer value is what keeps
// the labels distinct. City is the fallback, which preserves the historical
// "Road, City" output wherever no neighbourhood is available.
func (r *GeoResult) area() string {
	if r.Suburb != "" {
		return r.Suburb
	}
	return r.City
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
