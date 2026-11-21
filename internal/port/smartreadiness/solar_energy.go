package smartreadiness

import (
	"context"
	"time"
)

type SolarEnergyAuthorization struct {
	ID      int64
	Subject string
	SiteID  int64
}

type SolarEnergyTokens struct {
	AccessToken  string `json:"-"`
	RefreshToken string `json:"-"`
	ExpiresAt    time.Time
}

type SolarEnergyConnectionRepository interface {
	BeginEnergyAuthorization(ctx context.Context, subject string, siteID int64, stateHash [32]byte, expiresAt time.Time) error
	ClaimEnergyAuthorization(ctx context.Context, subject string, stateHash [32]byte, now time.Time) (*SolarEnergyAuthorization, error)
	CompleteEnergyAuthorization(ctx context.Context, auth SolarEnergyAuthorization, stateHash [32]byte, tokens SolarEnergyTokens, now time.Time) error
	FindSolarEnergySite(ctx context.Context, subject string) (int64, error)
	DisconnectSolarEnergy(ctx context.Context, subject string) error
	FindSolarEnergyAccessToken(ctx context.Context, subject string, siteID int64, validUntil time.Time) (string, error)
	ClaimSolarEnergyRefresh(ctx context.Context, subject string, siteID int64, now, retryAfter time.Time) (int64, string, error)
	CompleteSolarEnergyRefresh(ctx context.Context, connectionID int64, retryAfter time.Time, tokens SolarEnergyTokens) error
	PruneEnergyAuthorizations(ctx context.Context, now time.Time) error
}
