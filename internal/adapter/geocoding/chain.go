package geocoding

import (
	"context"
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

func (c *ChainProvider) ReverseGeocode(ctx context.Context, lat, lon float64) (*external.Address, error) {
	var lastErr error
	for _, p := range c.providers {
		addr, err := p.ReverseGeocode(ctx, lat, lon)
		if err == nil {
			return addr, nil
		}
		log.Warn().Err(err).Str("provider", p.Name()).Msg("geocoding provider failed, trying next")
		lastErr = err
	}
	return nil, fmt.Errorf("all geocoding providers failed: %w", lastErr)
}

func (c *ChainProvider) Name() string {
	return "chain"
}
