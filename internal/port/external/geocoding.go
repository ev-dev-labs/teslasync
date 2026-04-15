package external

import "context"

// Address represents a geocoded address.
type Address struct {
	FormattedAddress string  `json:"formattedAddress"`
	City             string  `json:"city"`
	State            string  `json:"state"`
	Country          string  `json:"country"`
	PostalCode       string  `json:"postalCode"`
	Latitude         float64 `json:"latitude"`
	Longitude        float64 `json:"longitude"`
}

// GeocodingProvider defines the interface for reverse geocoding.
type GeocodingProvider interface {
	ReverseGeocode(ctx context.Context, lat, lon float64) (*Address, error)
	Name() string
}
