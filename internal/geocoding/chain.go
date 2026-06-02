package geocoding

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
)

// chainGeocoder tries each provider in order and falls back to the next when
// one returns an error. This keeps a single misconfigured provider — e.g. a
// Google key that returns REQUEST_DENIED, or an expired Azure key — from
// disabling reverse geocoding entirely. The chain always ends in Nominatim,
// which needs no API key, so geocoding degrades gracefully instead of failing.
type chainGeocoder struct {
	providers []namedGeocoder
}

type namedGeocoder struct {
	name string
	geo  Geocoder
}

// ReverseGeocode returns the first successful provider result. Providers are
// tried in priority order; an error from one provider is recorded and the next
// is attempted. Only when every provider fails does it return a joined error.
func (c *chainGeocoder) ReverseGeocode(ctx context.Context, lat, lon float64) (*GeoResult, error) {
	var errs error
	for _, p := range c.providers {
		res, err := p.geo.ReverseGeocode(ctx, lat, lon)
		if err == nil {
			return res, nil
		}
		errs = errors.Join(errs, fmt.Errorf("%s: %w", p.name, err))
		log.Warn().Err(err).
			Str("provider", p.name).
			Float64("lat", lat).
			Float64("lon", lon).
			Msg("geocoding: provider failed, trying next")
	}
	return nil, fmt.Errorf("all geocoders failed: %w", errs)
}
