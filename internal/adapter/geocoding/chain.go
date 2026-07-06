package geocoding

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// ChainProvider implements provider fallback (Google → Azure → Nominatim).
type ChainProvider struct {
	providers []external.GeocodingProvider
}

// NewChainProvider creates a geocoding chain from a list of providers.
func NewChainProvider(providers ...external.GeocodingProvider) *ChainProvider {
	return &ChainProvider{providers: providers}
}

// ReverseGeocode returns the first successful provider result. Providers are
// tried in priority order; an error from one provider is recorded and the next
// is attempted, so a single misconfigured provider (e.g. a Google key that
// returns REQUEST_DENIED) does not disable geocoding entirely. Only when every
// configured provider fails does it return a joined error naming each failure.
func (c *ChainProvider) ReverseGeocode(ctx context.Context, lat, lon float64) (*external.Address, error) {
	var errs error
	attempted := 0
	for _, p := range c.providers {
		if p == nil {
			continue
		}
		attempted++
		addr, err := p.ReverseGeocode(ctx, lat, lon)
		if err == nil {
			return addr, nil
		}
		errs = errors.Join(errs, fmt.Errorf("%s: %w", p.Name(), err))
		log.Warn().Err(err).
			Str("provider", p.Name()).
			Float64("lat", lat).
			Float64("lon", lon).
			Msg("geocoding provider failed, trying next")
	}
	if attempted == 0 {
		return nil, errors.New("geocoding: no providers configured")
	}
	return nil, fmt.Errorf("all geocoding providers failed: %w", errs)
}

func (c *ChainProvider) Name() string {
	return "chain"
}
